#!/usr/bin/env bash
# Switch back to an earlier release.
#
#   rollback.sh            -> the release `previous` points to
#   rollback.sh <release>  -> releases/<release>
#
# Code only: database migrations are not reverted (see docs/operations.md).
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LIBDIR=$(dirname -- "$(readlink -f -- "$0")")
# shellcheck source=lib.sh
. "$LIBDIR/lib.sh"

[[ $EUID -eq 0 ]] || emc_die "must run as root"
install -d -m 0755 /run/lock
exec 9> /run/lock/ecommerce-money-copilot-deploy.lock
flock -n 9 || emc_die "another deploy/rollback is running"

if [[ $# -ge 1 ]]; then
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ && $1 != *..* ]] || emc_die "invalid release name: $1"
  TARGET=releases/$1
else
  TARGET=$(readlink -- "$EMC_BASE/previous" 2> /dev/null) || emc_die "no previous release recorded; pass a release name"
fi
[[ -f $EMC_BASE/$TARGET/.release ]] || emc_die "not a complete release: $TARGET"

CUR=$(readlink -- "$EMC_BASE/current" 2> /dev/null || true)
[[ $CUR != "$TARGET" ]] || emc_die "$TARGET is already current"
COMMIT=$(sed -n 's/^commit=//p' "$EMC_BASE/$TARGET/.release")

emc_log "rolling back ${CUR:-none} -> $TARGET"
emc_activate "$TARGET"
if ! emc_start_and_check "$TARGET"; then
  emc_log "$TARGET unhealthy after rollback; restoring ${CUR:-none}"
  if [[ -n $CUR && -f $EMC_BASE/$CUR/.release ]]; then
    emc_activate "$CUR"
    emc_start_and_check "$CUR" || emc_log "restored $CUR is unhealthy too - manual intervention needed"
  fi
  emc_record rollback "${TARGET#releases/}" "$COMMIT" failed
  exit 1
fi
if [[ -n $CUR ]]; then
  emc_set_symlink "$CUR" previous
fi
emc_record rollback "${TARGET#releases/}" "$COMMIT" ok
emc_log "now serving $TARGET"
