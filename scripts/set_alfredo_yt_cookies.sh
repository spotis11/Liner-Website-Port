#!/bin/bash
# Set the YT_COOKIES service variable for the Alfredo bot (base64 Netscape
# cookie jar). The cookie VALUES are never printed — output shows names only.
set -euo pipefail

API="${RUNNING_API_URL:-https://running.sh}/api/v1"
TOKEN=$(cat /home/z/my-project/.secrets/running_token)
S=svc_3euskcktn5cb64lhb3wx
E=env_zw22hwmnsgk42ukvscmn
COOKIE_FILE=/home/z/my-project/.secrets/youtube_cookies.txt

[ -f "$COOKIE_FILE" ] || { echo "ERROR: $COOKIE_FILE missing" >&2; exit 1; }
B64=$(base64 -w0 "$COOKIE_FILE")

jq -n --arg yt "$B64" '{set:{YT_COOKIES: $yt}}' > /tmp/alfredo_yt_vars.json
curl -sS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -X PATCH "$API/services/$S/variables?environmentId=$E" \
  --data-binary @/tmp/alfredo_yt_vars.json | jq -r '(.data[]?.name) // .'
rm -f /tmp/alfredo_yt_vars.json
echo "YT_COOKIES set on service (value not shown)"
