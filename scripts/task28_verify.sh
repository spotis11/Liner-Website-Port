#!/bin/bash
# Task 28 E2E verification: session-expired fix (server + probes in one call)
cd /home/z/my-project

# start server if nothing is listening
if ! curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  setsid nohup node .next/standalone/server.js > server.log 2>&1 < /dev/null &
  disown
  for i in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://localhost:3000/ && break
    sleep 0.5
  done
fi

echo "=== 1. SPA serves with the new bundle ==="
HTML=$(curl -s http://localhost:3000/)
ENTRY=$(echo "$HTML" | grep -oE '/liner/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "entry ref: $ENTRY"
curl -s -o /dev/null -w "entry fetch: HTTP %{http_code}\n" "http://localhost:3000$ENTRY"
APP=$(curl -s "http://localhost:3000$ENTRY" | grep -oE '[^A-Za-z]App-[A-Za-z0-9_-]+\.js' | head -1 | tr -d '"'"'"'(/)')
echo "app chunk: $APP"
curl -s -o /dev/null -w "app fetch: HTTP %{http_code}\n" "http://localhost:3000/liner/assets/$APP"

echo "=== 2. moderation bans route (garbage token -> 401 invalid_token, unchanged) ==="
curl -s -w "\nHTTP %{http_code}\n" -H "authorization: Bearer garbage.token" http://localhost:3000/api/moderation/bans

echo "=== 3. announcements route (garbage token -> 401) + current probe ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{"message":"probe","accessToken":"garbage.token"}' http://localhost:3000/api/announcements
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/announcements/current

echo "=== 4. ban check probe (public, always 200) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{"username":"jayzeyluna"}' http://localhost:3000/api/moderation/check

echo "=== 5. upstream reachability from this server (context for verify path) ==="
curl -s -o /dev/null -w "upstream /v1/me garbage: HTTP %{http_code} in %{time_total}s\n" \
  --max-time 10 -H "authorization: Bearer garbage" -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  https://api.tryliner.fun/v1/me

echo "=== done ==="
