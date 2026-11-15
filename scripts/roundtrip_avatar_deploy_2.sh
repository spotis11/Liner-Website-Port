#!/usr/bin/env bash
# Round-trip steps 2-6 (avatar already uploaded on :3001 fresh db):
#   2. mirror flush carries the upstreamProfile row
#   3. deploy-time export carries it
#   4. new container: wipe db + runtime mirror, seed = export, boot
#   5+6. after restore: /v1/me -> /api/avatar/<id>, GET -> 200 8MB gif
set -u
cd /home/z/my-project
die() { echo "FAIL: $1"; exit 1; }

echo "=== 2. mirror flush (2s debounce) carries upstreamProfile? ==="
sleep 4
python3 - << 'PY' || die "runtime mirror missing upstreamProfile row"
import json
m = json.load(open('db/db-mirror.json'))
rows = m.get('tables', {}).get('upstreamProfile', [])
print(f"savedAt: {m.get('savedAt')}  upstreamProfile rows: {len(rows)}")
assert rows, "no upstreamProfile row in runtime mirror"
av = rows[0].get('avatarUrl') or ''
print(f"row id: {rows[0]['id']}  avatarUrl: data:image/gif... ({len(av):,} chars)")
PY

echo ""
echo "=== 3. deploy-time export (GET /api/db-mirror/latest) ==="
KEY=$(grep -E '^DB_MIRROR_EXPORT_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' ')
[ -n "$KEY" ] || die "DB_MIRROR_EXPORT_KEY not in .env"
curl -s -m 20 -H "x-db-mirror-key: $KEY" http://localhost:3001/api/db-mirror/latest -o /tmp/rt-export.json \
  || die "export fetch failed"
python3 - << 'PY' || die "export missing upstreamProfile row"
import json
m = json.load(open('/tmp/rt-export.json'))
tables = m.get('tables', {})
rows = tables.get('upstreamProfile', [])
print(f"export savedAt: {m.get('savedAt')}  tables ({len(tables)}): {', '.join(sorted(tables))}")
assert rows, "no upstreamProfile row in export"
print(f"upstreamProfile rows in export: {len(rows)} (id {rows[0]['id']})")
PY

echo ""
echo "=== 4. simulate NEW CONTAINER: fresh db, seed = export ==="
pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 2
rm -f db/custom.db db/custom.db-journal db/db-mirror.json
cp /tmp/rt-export.json db/db-mirror-seed.json
nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
echo $! > /tmp/liner-prod.pid
sleep 5
curl -s -o /dev/null -m 5 -w "boot -> HTTP %{http_code}\n" http://localhost:3001 || die "boot failed"

echo ""
echo "=== 5+6. after restore: /v1/me avatar + GET /api/avatar/:id ==="
sleep 3
TEST_PASSWORD='Yourgy88' python3 - << 'PY' || die "post-restore verification failed"
import json, os, urllib.request, urllib.error
BASE = "http://localhost:3001"
def call(method, path, body=None, token=None):
    h = {"content-type": "application/json"}
    if token: h["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE}{path}", data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=45) as r: return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e: return e.code, e.headers, e.read()

s, _, b = call("POST", "/v1/auth/login", json.dumps({"email": "seekfromohio@gmail.com", "password": os.environ["TEST_PASSWORD"]}).encode())
assert s == 200, f"login {s}"
tok = json.loads(b)["accessToken"]
s, _, b = call("GET", "/v1/me", None, tok)
assert s == 200, f"/v1/me {s}"
u = json.loads(b).get("user", json.loads(b))
av = u.get("avatarUrl")
print(f"GET /v1/me -> HTTP {s}  avatarUrl -> {av}")
assert isinstance(av, str) and av.startswith("/api/avatar/"), f"avatarUrl not the byte-serving URL: {av!r}"
s, h, b = call("GET", av)
print(f"GET {av} -> HTTP {s}  type={h.get('content-type')}  len={h.get('content-length')}")
assert s == 200 and h.get('content-type') == 'image/gif' and len(b) == 8388608, "avatar bytes not served after restore"
print("PASS: avatar survived the deploy round-trip")
PY

echo ""
echo "=== cleanup: clear test avatar ==="
TEST_PASSWORD='Yourgy88' python3 scripts/cleanup_test_avatar.py
