#!/usr/bin/env bash
# Public health probe for money.acosx.top, run by a systemd timer every 5 min.
#
# Probes /api/health once the API service is enabled (after the first backend
# deploy), otherwise the static front page. Uses the same state machine and
# line format as the host's existing site patrol, appending to its relay log:
#   <ISO8601>|<site>|ALERT|<n>|<detail>    after 3 consecutive failures
#   <ISO8601>|<site>|RECOVER|<n>|<detail>  after 3 consecutive successes
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SITE=${EMC_PUBLIC_HOST:-money.acosx.top}
SERVICE=${EMC_SERVICE:-ecommerce-money-copilot-api.service}
ALERT_LOG=${EMC_ALERT_LOG:-/var/lib/acosx-monitor/pending-alerts.log}
STATE_FILE=${STATE_DIRECTORY:-/var/lib/ecommerce-money-copilot-monitor}/state
THRESHOLD_FAIL=3
THRESHOLD_RECOVER=3
MAX_TIME=15

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }

if systemctl is-enabled --quiet "$SERVICE" 2> /dev/null; then
  URL=https://$SITE/api/health
  ok_codes='^2'          # health endpoint must answer 2xx
else
  URL=https://$SITE/
  ok_codes='^[234]'      # static page: anything but 5xx
fi

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$MAX_TIME" "$URL" 2> /dev/null)
rc=$?
if [[ $rc -ne 0 ]]; then
  case $rc in
    6) detail=DNS_FAIL ;;
    7) detail=CONN_REFUSED ;;
    28) detail=TIMEOUT ;;
    35) detail=TLS_HANDSHAKE_FAIL ;;
    56) detail=RECV_ERROR ;;
    60) detail=CERT_VERIFY_FAIL ;;
    *) detail=CURL_ERR_$rc ;;
  esac
  st=FAIL
elif [[ $code =~ $ok_codes ]]; then
  st=OK detail=HTTP_$code
else
  st=FAIL detail=HTTP_$code
fi

fails=0 alerting=false recovers=0
if [[ -r $STATE_FILE ]]; then read -r fails alerting recovers < "$STATE_FILE" || true; fi
[[ $fails =~ ^[0-9]+$ ]] || fails=0
[[ $recovers =~ ^[0-9]+$ ]] || recovers=0
[[ $alerting == true ]] || alerting=false

if [[ $st == FAIL ]]; then
  fails=$((fails + 1)) recovers=0
  if [[ $alerting == false && $fails -ge $THRESHOLD_FAIL ]]; then
    alerting=true
    printf '%s|%s|ALERT|%d|%s\n' "$(ts)" "$SITE" "$fails" "$detail" >> "$ALERT_LOG"
  fi
else
  fails=0
  if [[ $alerting == true ]]; then
    recovers=$((recovers + 1))
    if [[ $recovers -ge $THRESHOLD_RECOVER ]]; then
      printf '%s|%s|RECOVER|%d|%s\n' "$(ts)" "$SITE" "$recovers" "$detail" >> "$ALERT_LOG"
      alerting=false recovers=0
    fi
  fi
fi
printf '%s %s %s\n' "$fails" "$alerting" "$recovers" > "$STATE_FILE.tmp" && mv -f "$STATE_FILE.tmp" "$STATE_FILE"
echo "$st $URL $detail fails=$fails alerting=$alerting recovers=$recovers"
