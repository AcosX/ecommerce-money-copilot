#!/usr/bin/env bash
# Install / update the host-side pieces from a checkout of this repository:
# ops scripts, systemd units and the Apache vhost. Idempotent. Never enables
# or starts the API service (deploy.sh does that on the first backend release).
#
#   install-host.sh [--enable-timers]
#
#   --enable-timers   enable + start the backup and health timers
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SRC=$(cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)
# shellcheck source=lib.sh
. "$SRC/scripts/lib.sh"

[[ $EUID -eq 0 ]] || emc_die "must run as root"
ENABLE_TIMERS=0
[[ ${1:-} == --enable-timers ]] && ENABLE_TIMERS=1

LIBEXEC=/usr/local/libexec/ecommerce-money-copilot
UNIT_DIR=/etc/systemd/system
VHOST=/etc/httpd/conf.d/money-acosx.conf
API_PORT=${EMC_API_PORT:-8790}
STAMP=$(date +%Y%m%d-%H%M%S)

# ---- prerequisites (created once, never modified if present) ----
getent group emc > /dev/null || groupadd --system emc
getent passwd emc > /dev/null || useradd --system --gid emc --home-dir "$EMC_UPLOAD_ROOT" \
  --no-create-home --shell /sbin/nologin emc
install -d -o root -g emc -m 0750 "$EMC_ETC"
install -d -o root -g root -m 0755 "$EMC_BASE" "$EMC_BASE/releases"
install -d -o emc -g emc -m 0700 "$EMC_UPLOAD_ROOT" "$EMC_UPLOAD_ROOT/uploads"
install -d -o root -g root -m 0700 "$EMC_BACKUP_DIR"
for f in app.env oauth.env db.env; do
  [[ -f $EMC_ETC/$f ]] || emc_log "warn: $EMC_ETC/$f missing (see docs/operations.md)"
done

if command -v semanage > /dev/null; then
  fctx() { semanage fcontext -a -t "$1" "$2" 2> /dev/null || semanage fcontext -m -t "$1" "$2"; }
  fctx httpd_sys_content_t "$EMC_BASE(/.*)?"
  fctx bin_t "$EMC_BASE/releases/[^/]+/backend(/.*)?"
  fctx bin_t "$EMC_BASE/python(/.*)?"
  fctx bin_t "$LIBEXEC(/.*)?"
  fctx var_lib_t "$EMC_UPLOAD_ROOT(/.*)?"
fi

# ---- ops scripts ----
install -d -m 0755 "$LIBEXEC"
for s in lib.sh deploy.sh rollback.sh backup-db.sh restore-drill.sh health-check.sh; do
  install -m 0755 "$SRC/scripts/$s" "$LIBEXEC/$s"
done
chmod 0644 "$LIBEXEC/lib.sh"
for s in deploy rollback backup-db restore-drill; do
  ln -sfn "$LIBEXEC/$s.sh" "/usr/local/sbin/emc-$s"
done

# ---- systemd units (API unit installed, not enabled) ----
changed=0
for u in "$SRC"/systemd/*.service "$SRC"/systemd/*.timer; do
  dst=$UNIT_DIR/$(basename -- "$u")
  if ! cmp -s "$u" "$dst"; then
    [[ -f $dst ]] && cp -p -- "$dst" "$dst.bak-$STAMP"
    install -m 0644 "$u" "$dst"
    changed=1
  fi
done
[[ $changed == 1 ]] && systemctl daemon-reload

# ---- Apache vhost ----
tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
sed -e "s|@SERVER_NAME@|$EMC_PUBLIC_HOST|g" -e "s|@BASE_DIR@|$EMC_BASE|g" -e "s|@API_PORT@|$API_PORT|g" \
  "$SRC/apache/money-acosx.conf.template" > "$tmp"
if ! cmp -s "$tmp" "$VHOST"; then
  backup=
  if [[ -f $VHOST ]]; then
    backup=$VHOST.bak-$STAMP
    cp -p -- "$VHOST" "$backup"
  fi
  install -m 0644 "$tmp" "$VHOST"
  if apachectl configtest; then
    systemctl reload httpd
    emc_log "vhost installed and httpd reloaded"
  else
    if [[ -n $backup ]]; then mv -f -- "$backup" "$VHOST"; else rm -f -- "$VHOST"; fi
    emc_die "apachectl configtest failed; vhost change reverted"
  fi
fi

if command -v restorecon > /dev/null; then
  restorecon -R "$EMC_BASE" "$EMC_UPLOAD_ROOT" "$LIBEXEC" 2> /dev/null || true
fi

if [[ $ENABLE_TIMERS == 1 ]]; then
  systemctl enable --now ecommerce-money-copilot-backup.timer ecommerce-money-copilot-health.timer
fi
emc_log "host install complete (API unit: $(systemctl is-enabled "$EMC_SERVICE" 2> /dev/null || true))"
