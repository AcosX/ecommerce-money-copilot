# shellcheck shell=bash
# Shared helpers for the ecommerce-money-copilot ops scripts (sourced, not executed).
# Holds no credentials; secrets are read at runtime from /etc/ecommerce-money-copilot/*.env.

EMC_BASE=${EMC_BASE:-/srv/ecommerce-money-copilot}
EMC_ETC=${EMC_ETC:-/etc/ecommerce-money-copilot}
EMC_DB_NAME=${EMC_DB_NAME:-ecommerce_money_copilot}
EMC_SERVICE=${EMC_SERVICE:-ecommerce-money-copilot-api.service}
EMC_REVIEW_SERVICE=${EMC_REVIEW_SERVICE:-ecommerce-money-copilot-review.service}
EMC_HEALTH_TIMER=${EMC_HEALTH_TIMER:-ecommerce-money-copilot-health.timer}
EMC_API_HEALTH_URL=${EMC_API_HEALTH_URL:-http://127.0.0.1:8790/api/health}
EMC_PUBLIC_HOST=${EMC_PUBLIC_HOST:-money.acosx.top}
EMC_STATIC_HEALTH_URL=${EMC_STATIC_HEALTH_URL:-http://127.0.0.1/}
EMC_BACKUP_DIR=${EMC_BACKUP_DIR:-/var/backups/ecommerce-money-copilot}
EMC_UPLOAD_ROOT=${EMC_UPLOAD_ROOT:-/var/lib/ecommerce-money-copilot}
EMC_REPO_URL=${EMC_REPO_URL:-https://github.com/AcosX/ecommerce-money-copilot.git}
EMC_ENABLE_UNITS=${EMC_ENABLE_UNITS:-1}
EMC_HISTORY=${EMC_HISTORY:-$EMC_BASE/deploy-history.log}

emc_log() { printf '%s [%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${0##*/}" "$*" >&2; }
emc_die() { emc_log "ERROR: $*"; exit 1; }

# Export KEY=VALUE lines from a systemd-style env file without evaluating
# them (values may contain shell metacharacters).
emc_load_env() {
  local file=$1 line key val
  [[ -r $file ]] || emc_die "env file not readable: $file"
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z $line || $line == '#'* || $line == ';'* ]] && continue
    [[ $line == *=* ]] || continue
    key=${line%%=*}
    val=${line#*=}
    key=${key//[[:space:]]/}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ ${#val} -ge 2 && ( ( $val == \"*\" ) || ( $val == \'*\' ) ) ]]; then
      val=${val:1:${#val}-2}
    fi
    export "$key=$val"
  done < "$file"
}

emc_has_backend() { [[ -f $1/backend/pyproject.toml ]]; }

# Point $EMC_BASE/$2 (default: current) at a release path relative to $EMC_BASE (atomic rename).
emc_set_symlink() {
  local target=$1 name=${2:-current}
  ln -sfn -- "$target" "$EMC_BASE/.$name.tmp"
  # SELinux: systemd-executor (init_t) cannot read httpd_sys_content_t symlinks,
  # while both init_t and httpd_t can traverse usr_t symlinks.
  if [[ -x /usr/bin/chcon ]]; then
    /usr/bin/chcon -h -t usr_t "$EMC_BASE/.$name.tmp" 2> /dev/null || true
  fi
  mv -Tf -- "$EMC_BASE/.$name.tmp" "$EMC_BASE/$name"
}

# Point $EMC_BASE/current at a release path relative to $EMC_BASE (atomic rename).
emc_activate() {
  local target=$1
  [[ -f $EMC_BASE/$target/.release ]] || emc_die "not a complete release: $target"
  emc_set_symlink "$target" current
}

emc_wait_url() { # $1=url $2=attempts [$3=Host header]
  local url=$1 n=${2:-30} host=${3:-} i
  local -a hdr=()
  [[ -n $host ]] && hdr=(-H "Host: $host")
  for ((i = 1; i <= n; i++)); do
    if curl -fsS -o /dev/null --max-time 5 "${hdr[@]}" "$url" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# (Re)start whatever the given release needs and verify it is healthy.
emc_start_and_check() {
  local rel=$1
  # Stop before switching process code. An in-flight call keeps its bounded lease;
  # the new worker recovers it, while rollback to old code leaves the queue intact.
  if systemctl is-active --quiet "$EMC_REVIEW_SERVICE"; then
    systemctl stop "$EMC_REVIEW_SERVICE" || return 1
  fi
  if [[ -f $EMC_BASE/$rel/backend/emc_api/services/review_queue.py ]]; then
    systemctl cat "$EMC_REVIEW_SERVICE" > /dev/null 2>&1 || { emc_log "review unit missing; run install-host.sh first"; return 1; }
    if [[ $EMC_ENABLE_UNITS == 1 ]]; then systemctl enable --quiet "$EMC_REVIEW_SERVICE" || return 1; fi
    systemctl restart "$EMC_REVIEW_SERVICE" || return 1
    systemctl is-active --quiet "$EMC_REVIEW_SERVICE" || return 1
  elif systemctl is-enabled --quiet "$EMC_REVIEW_SERVICE" 2> /dev/null; then
    systemctl disable --quiet "$EMC_REVIEW_SERVICE" || return 1
  fi
  if emc_has_backend "$EMC_BASE/$rel"; then
    if [[ $EMC_ENABLE_UNITS == 1 ]]; then
      systemctl enable --quiet "$EMC_SERVICE"
    fi
    systemctl restart "$EMC_SERVICE"
    emc_wait_url "$EMC_API_HEALTH_URL" 30 || return 1
  else
    # Static-only release (no backend/): API must not keep serving old code,
    # nor be started at boot against a release without a backend.
    if systemctl is-active --quiet "$EMC_SERVICE"; then
      systemctl stop "$EMC_SERVICE"
    fi
    if [[ $EMC_ENABLE_UNITS == 1 ]] && systemctl is-enabled --quiet "$EMC_SERVICE" 2> /dev/null; then
      systemctl disable --quiet "$EMC_SERVICE"
    fi
    emc_wait_url "$EMC_STATIC_HEALTH_URL" 5 "$EMC_PUBLIC_HOST" || return 1
  fi
}

emc_record() { # $1=action $2=release $3=commit $4=result
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" "$2" "${3:--}" "$4" >> "$EMC_HISTORY"
}
