#!/usr/bin/env bash
# Logical backup of the application database plus a tarball of the evidence
# uploads directory.
#
#   backup-db.sh [--label <name>]
#
# Output: $EMC_BACKUP_DIR/emc-<UTC>-<label>.{sql.gz,uploads.tar.gz,sha256} (0600)
# Retention: files older than EMC_BACKUP_RETENTION_DAYS (default 14) are removed.
# Prints the dump path on stdout.
set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LIBDIR=$(dirname -- "$(readlink -f -- "$0")")
# shellcheck source=lib.sh
. "$LIBDIR/lib.sh"

LABEL=daily
if [[ ${1:-} == --label ]]; then
  LABEL=${2:-}
fi
[[ $LABEL =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]] || emc_die "invalid label"
RETENTION_DAYS=${EMC_BACKUP_RETENTION_DAYS:-14}
[[ $RETENTION_DAYS =~ ^[1-9][0-9]*$ ]] || emc_die "invalid retention"

install -d -m 0700 "$EMC_BACKUP_DIR"
ts=$(date -u +%Y%m%dT%H%M%SZ)
base=$EMC_BACKUP_DIR/emc-$ts-$LABEL
tmpfiles=()
cleanup() { local f; for f in "${tmpfiles[@]}"; do rm -f -- "$f"; done; }
trap cleanup EXIT

mariadb --protocol=socket -N -B \
  -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$EMC_DB_NAME'" \
  | grep -qx "$EMC_DB_NAME" || emc_die "database $EMC_DB_NAME not found"

# Galera: InnoDB consistent snapshot only. No LOCK TABLES / FLUSH TABLES WITH
# READ LOCK, which would stall replication for the whole cluster.
# No --databases: the dump restores into any schema name (restore drill).
tmpfiles+=("$base.sql.gz.tmp" "$base.dump.err")
mariadb-dump --protocol=socket --single-transaction --skip-lock-tables --quick \
  --routines --events --triggers --hex-blob --default-character-set=utf8mb4 \
  "$EMC_DB_NAME" 2> "$base.dump.err" | gzip -n > "$base.sql.gz.tmp" \
  || { cat "$base.dump.err" >&2; emc_die "mariadb-dump failed"; }
gzip -t "$base.sql.gz.tmp" || emc_die "dump gzip validation failed"
zcat "$base.sql.gz.tmp" | tail -n 1 | grep -q '^-- Dump completed' || emc_die "dump is incomplete"
mv -f -- "$base.sql.gz.tmp" "$base.sql.gz"

if [[ -d $EMC_UPLOAD_ROOT/uploads ]]; then
  tmpfiles+=("$base.uploads.tar.gz.tmp")
  tar -C "$EMC_UPLOAD_ROOT" -czf "$base.uploads.tar.gz.tmp" uploads
  mv -f -- "$base.uploads.tar.gz.tmp" "$base.uploads.tar.gz"
fi

(cd "$EMC_BACKUP_DIR" && sha256sum -- "${base##*/}".sql.gz $([[ -f $base.uploads.tar.gz ]] && echo "${base##*/}.uploads.tar.gz")) > "$base.sha256"
chmod 0600 -- "$base".*

# Retention: only our own files, never anything else in the directory.
find "$EMC_BACKUP_DIR" -maxdepth 1 -type f -name 'emc-*' -mtime +"$((RETENTION_DAYS - 1))" -print -delete \
  | sed 's/^/pruned /' >&2

emc_log "backup ok: ${base##*/} ($(du -h "$base.sql.gz" | cut -f1) dump)"
printf '%s\n' "$base.sql.gz"
