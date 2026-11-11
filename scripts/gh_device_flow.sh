#!/usr/bin/env bash
# GitHub OAuth Device Flow: authorize pushes with the user's own account.
#   gh_device_flow.sh start    -> request a user_code, show it for github.com/login/device
#   gh_device_flow.sh poll     -> check if the user entered the code (never prints the token)
#   gh_device_flow.sh finalize -> store the fresh token in .git-credentials as spotis11
set -euo pipefail

CLIENT_ID="178c6fc778ccc68e1d6a" # GitHub CLI's public first-party client id
STATE=/tmp/gh-device-flow.json
RESP=/tmp/gh-token-resp.json

mode="${1:-start}"
case "$mode" in
start)
  curl -s -X POST https://github.com/login/device/code \
    -H "Accept: application/json" \
    -d "client_id=$CLIENT_ID&scope=repo" > "$STATE"
  python3 - <<'EOF'
import json
d = json.load(open("/tmp/gh-device-flow.json"))
print("USER_CODE:", d["user_code"])
print("URL:", d.get("verification_uri", "https://github.com/login/device"))
if d.get("verification_uri_complete"):
    print("DIRECT:", d["verification_uri_complete"])
print("EXPIRES_IN:", d.get("expires_in"), "s  INTERVAL:", d.get("interval"), "s")
EOF
  ;;
poll)
  DEVICE_CODE=$(python3 -c 'import json;print(json.load(open("'"$STATE"'"))["device_code"])')
  curl -s -X POST https://github.com/login/oauth/access_token \
    -H "Accept: application/json" \
    -d "client_id=$CLIENT_ID&device_code=$DEVICE_CODE&grant_type=urn:ietf:params:oauth:grant-type:device_code" > "$RESP"
  python3 - <<'EOF'
import json
d = json.load(open("/tmp/gh-token-resp.json"))
if "access_token" in d:
    print("TOKEN_OK")
elif d.get("error") == "authorization_pending":
    print("PENDING")
elif d.get("error") == "slow_down":
    print("SLOW_DOWN")
else:
    print("ERROR:", d.get("error"), d.get("error_description", ""))
EOF
  ;;
finalize)
  python3 - <<'EOF'
import json, os
d = json.load(open("/tmp/gh-token-resp.json"))
tok = d.get("access_token")
if not tok:
    raise SystemExit("no token yet")
cred = "/home/z/my-project/.git-credentials"
lines = [l for l in open(cred) if "github.com" not in l]
lines.append(f"https://spotis11:{tok}@github.com\n")
open(cred, "w").writelines(lines)
os.remove("/tmp/gh-token-resp.json")
print("credential stored for spotis11")
EOF
  ;;
*)
  echo "usage: $0 start|poll|finalize" >&2; exit 2;;
esac
