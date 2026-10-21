#!/usr/bin/env bash
# Deploy a tagged release on the test/demo host.
#
#   deploy.sh <git-tag>
#
# 1. fetch the tag into releases/<tag> (git archive, no .git in the release)
# 2. uv sync --frozen in backend/ (if the release has a backend)
# 3. pre-deploy database dump, then alembic upgrade head with the migrate user
# 4. switch `current` atomically, restart the API, health check
# 5. on failure switch back to the previous release automatically
#
# Only tags are deployable, so the demo never runs an untested branch head.
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LIBDIR=$(dirname -- "$(readlink -f -- "$0")")
# shellcheck source=lib.sh
. "$LIBDIR/lib.sh"

[[ $EUID -eq 0 ]] || emc_die "must run as root"
[[ $# -eq 1 ]] || emc_die "usage: ${0##*/} <git-tag>"
TAG=$1
[[ $TAG =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ && $TAG != *..* ]] || emc_die "invalid tag name: $TAG"

install -d -m 0755 /run/lock
exec 9> /run/lock/ecommerce-money-copilot-deploy.lock
flock -n 9 || emc_die "another deploy/rollback is running"

REPO=$EMC_BASE/repo.git
REL_DIR=$EMC_BASE/releases
REL=$REL_DIR/$TAG
UV=${UV:-$(command -v uv || true)}
[[ -n $UV ]] || UV=/root/.local/bin/uv
[[ -x $UV ]] || emc_die "uv not found (set UV=/path/to/uv)"
# Python installs and the uv cache live outside /root so the service user can
# read the interpreter the venv links to.
export UV_PYTHON_INSTALL_DIR=$EMC_BASE/python
export UV_CACHE_DIR=${UV_CACHE_DIR:-/var/cache/ecommerce-money-copilot/uv}
export UV_LINK_MODE=copy UV_NO_PROGRESS=1

install -d -m 0755 "$REL_DIR" "$UV_CACHE_DIR"

# ---- 1. fetch ----
if [[ ! -d $REPO ]]; then
  git clone --quiet --mirror "$EMC_REPO_URL" "$REPO"
fi
git -C "$REPO" fetch --quiet --prune origin
COMMIT=$(git -C "$REPO" rev-parse --verify --quiet "refs/tags/$TAG^{commit}") \
  || emc_die "tag not found: $TAG"
emc_log "deploying $TAG ($COMMIT)"

# ---- 2. build ----
build_release() {
  if [[ -f $REL/.release ]]; then
    grep -qx "commit=$COMMIT" "$REL/.release" \
      || emc_die "releases/$TAG exists with a different commit; refusing to overwrite"
    emc_log "releases/$TAG already built; reusing"
    return 0
  fi
  # NOTE: called from an `if`, where `set -e` is inactive - check every step.
  rm -rf -- "$REL" || return 1 # leftover from an interrupted build (no .release marker)
  mkdir -p -- "$REL" || return 1
  git -C "$REPO" archive "$COMMIT" | tar -x --no-same-owner --no-same-permissions -C "$REL" || return 1
  if emc_has_backend "$REL"; then
    # Built in its final path: venv entry points embed absolute paths.
    (cd "$REL/backend" && "$UV" sync --frozen --no-dev) || return 1
    [[ -x $REL/backend/.venv/bin/uvicorn ]] || { emc_log "uvicorn missing from venv"; return 1; }
  fi
  if command -v restorecon > /dev/null; then
    # uv-managed interpreters must be executable by systemd (bin_t), not httpd content.
    restorecon -R "$REL" || return 1
    if [[ -d $UV_PYTHON_INSTALL_DIR ]]; then restorecon -R "$UV_PYTHON_INSTALL_DIR" || return 1; fi
  fi
  printf 'release=%s\ncommit=%s\nbuilt_at=%s\n' "$TAG" "$COMMIT" "$(date -u +%FT%TZ)" > "$REL/.release" || return 1
}
if ! build_release; then
  [[ -f $REL/.release ]] || rm -rf -- "$REL"
  emc_record deploy "$TAG" "$COMMIT" build-failed
  emc_die "build failed; current release unchanged"
fi

# ---- 3. migrate ----
run_migrations() {
  [[ -f $REL/backend/alembic.ini ]] || { emc_log "no backend/alembic.ini; skipping migrations"; return 0; }
  # NOTE: called from an `if`, where `set -e` is inactive - check every step.
  "$LIBDIR/backup-db.sh" --label "predeploy-$TAG" > /dev/null || { emc_log "pre-deploy backup failed"; return 1; }
  (
    # emc_load_env / emc_die exit this subshell on error.
    emc_load_env "$EMC_ETC/app.env"
    emc_load_env "$EMC_ETC/oauth.env"
    emc_load_env "$EMC_ETC/db.env"
    [[ -n ${EMC_MIGRATE_DATABASE_URL:-} ]] || emc_die "EMC_MIGRATE_DATABASE_URL missing in db.env"
    # The migrate user owns DDL; the runtime user cannot alter the schema.
    export EMC_DATABASE_URL=$EMC_MIGRATE_DATABASE_URL
    cd "$REL/backend" || exit 1
    exec setpriv --reuid=emc --regid=emc --init-groups --no-new-privs \
      env HOME="$EMC_UPLOAD_ROOT" "$REL/backend/.venv/bin/alembic" upgrade head
  )
}
if ! run_migrations; then
  emc_record deploy "$TAG" "$COMMIT" migrate-failed
  emc_die "migration failed; current release unchanged (check alembic state before retrying)"
fi

# ---- 4. switch + health ----
PREV=$(readlink -- "$EMC_BASE/current" 2> /dev/null || true)
NEW=releases/$TAG
emc_activate "$NEW"
if ! emc_start_and_check "$NEW"; then
  emc_log "health check failed for $TAG"
  journalctl -u "$EMC_SERVICE" -n 40 --no-pager >&2 2> /dev/null || true
  # ---- 5. automatic rollback ----
  if [[ -n $PREV && $PREV != "$NEW" && -f $EMC_BASE/$PREV/.release ]]; then
    emc_log "rolling back to $PREV"
    emc_activate "$PREV"
    if emc_start_and_check "$PREV"; then
      emc_log "rollback to $PREV healthy"
      emc_record deploy "$TAG" "$COMMIT" "failed-rolled-back-to-${PREV#releases/}"
    else
      emc_log "rollback to $PREV ALSO unhealthy - manual intervention needed"
      emc_record deploy "$TAG" "$COMMIT" failed-rollback-unhealthy
    fi
  else
    emc_record deploy "$TAG" "$COMMIT" failed-no-previous
  fi
  emc_log "note: database migrations are not reverted automatically (see docs/operations.md)"
  exit 1
fi

if [[ -n $PREV && $PREV != "$NEW" ]]; then
  ln -sfn -- "$PREV" "$EMC_BASE/.previous.tmp"
  mv -Tf -- "$EMC_BASE/.previous.tmp" "$EMC_BASE/previous"
fi
emc_record deploy "$TAG" "$COMMIT" ok
if [[ $EMC_ENABLE_UNITS == 1 ]] && emc_has_backend "$EMC_BASE/$NEW"; then
  systemctl enable --now --quiet "$EMC_HEALTH_TIMER" 2> /dev/null || emc_log "warn: could not enable $EMC_HEALTH_TIMER"
fi

# ---- prune old releases (keep newest N plus current/previous) ----
KEEP=${EMC_KEEP_RELEASES:-5}
cur=$(readlink -f -- "$EMC_BASE/current")
prev=$(readlink -f -- "$EMC_BASE/previous" 2> /dev/null || true)
n=0
while IFS= read -r d; do
  n=$((n + 1))
  [[ $n -le $KEEP || $d == "$cur" || $d == "$prev" ]] && continue
  case $d in
    "$REL_DIR"/*) rm -rf -- "$d" && emc_log "pruned $d" ;;
  esac
done < <(find "$REL_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)

emc_log "deployed $TAG"
