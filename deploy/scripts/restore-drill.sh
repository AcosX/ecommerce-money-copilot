#!/usr/bin/env bash
# Restore drill: load the latest dump (or the given one) into a scratch
# database, compare per-table row counts with the live database, then drop
# the scratch database. Exit status: 0 match, 2 mismatch, 1 error.
#
#   restore-drill.sh [dump.sql.gz]
#
# Run at low traffic: rows written after the dump legitimately differ.
set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LIBDIR=$(dirname -- "$(readlink -f -- "$0")")
# shellcheck source=lib.sh
. "$LIBDIR/lib.sh"

SCRATCH=${EMC_DRILL_DB:-emc_restore_drill}
[[ $SCRATCH =~ ^emc_[a-z0-9_]+$ && $SCRATCH != "$EMC_DB_NAME" ]] || emc_die "unsafe scratch db name"
DRILL_LOG=$EMC_BACKUP_DIR/restore-drill.log

DUMP=${1:-}
if [[ -z $DUMP ]]; then
  DUMP=$(find "$EMC_BACKUP_DIR" -maxdepth 1 -type f -name 'emc-*.sql.gz' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)
fi
[[ -n $DUMP && -f $DUMP ]] || emc_die "no dump found in $EMC_BACKUP_DIR"
gzip -t "$DUMP" || emc_die "dump is corrupt: $DUMP"
sums=${DUMP%.sql.gz}.sha256
if [[ -f $sums ]]; then
  (cd "$(dirname -- "$DUMP")" && grep -F "$(basename -- "$DUMP")" "$sums" | sha256sum -c --quiet -) \
    || emc_die "checksum mismatch: $DUMP"
fi

sql() { mariadb --protocol=socket -N -B "$@"; }
drop_scratch() { sql -e "DROP DATABASE IF EXISTS \`$SCRATCH\`" || emc_log "warn: could not drop $SCRATCH"; }
trap drop_scratch EXIT

emc_log "restoring $(basename -- "$DUMP") into $SCRATCH"
drop_scratch
sql -e "CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
zcat -- "$DUMP" | mariadb --protocol=socket --default-character-set=utf8mb4 "$SCRATCH"

counts() { # exact COUNT(*) per base table: "<table>\t<rows>"
  local db=$1 t
  sql -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$db' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME" \
    | while IFS= read -r t; do
      printf '%s\t%s\n' "$t" "$(sql -e "SELECT COUNT(*) FROM \`$db\`.\`${t//\`/\`\`}\`")"
    done
}
src=$(counts "$EMC_DB_NAME")
dst=$(counts "$SCRATCH")
tables=$(printf '%s' "$src" | grep -c . || true)
rows=$(printf '%s\n' "$src" | awk -F'\t' '{s+=$2} END {print s+0}')

uploads_note=none
up=${DUMP%.sql.gz}.uploads.tar.gz
if [[ -f $up ]]; then
  if entries=$(tar -tzf "$up" | grep -vc '/$'); then :; fi
  uploads_note="tar-ok files=${entries:-0}"
fi

if [[ $src == "$dst" ]]; then
  result=OK
  status=0
else
  result=MISMATCH
  status=2
  diff <(printf '%s\n' "$src") <(printf '%s\n' "$dst") >&2 || true
fi
line=$(printf '%s\tdump=%s\ttables=%s\trows=%s\tuploads=%s\tresult=%s' \
  "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$(basename -- "$DUMP")" "$tables" "$rows" "$uploads_note" "$result")
printf '%s\n' "$line" >> "$DRILL_LOG"
chmod 0600 "$DRILL_LOG"
printf '%s\n' "$src" | sed 's/^/  /' >&2
emc_log "$line"
exit "$status"
