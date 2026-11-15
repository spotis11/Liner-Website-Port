#!/usr/bin/env bash
# REALISTIC deploy round-trip for the UpstreamProfile mirror fix.
#
# The FC deploy chain: (1) build fetches GET /api/db-mirror/latest from the
# running old container, (2) packages it as db-mirror-seed.json in the tarball,
# (3) the new container comes up with a fresh db and restores from the seed
# (runtime db-mirror.json dies with the old container's filesystem).
#
# This script simulates exactly that with a REAL 8MB GIF upload in step 0:
#   0. clean boot (kill everything on :3000, fresh db)
#   1. login + PATCH 8MB GIF avatar -> 200
#   2. wait for the 2s-debounced mirror flush; verify db-mirror.json carries
#      the upstreamProfile row
#   3. fetch GET /api/db-mirror/latest (deploy-time export) -> verify the
#      upstreamProfile table is present with the row
#   4. simulate new container: stop server, rm db + runtime mirror, write the
#      export as db-mirror-seed.json, boot fresh
#   5. login + GET /v1/me -> avatarUrl must be /api/avatar/<same id>
#   6. GET /api/avatar/<id> -> 200 image/gif, 8388608 bytes
set -u
cd /home/z/my-project

die() { echo "FAIL: $1"; exit 1; }

restart_server() {
  pkill -f 'standalone/server.js' 2>/dev/null || true
  sleep 2
  nohup node .next/standalone/server.js > /tmp/liner-prod.log 2>&1 &
  echo $! > /tmp/liner-prod.pid
  sleep 4
  curl -s -o /dev/null -m 5 -w "boot -> HTTP %{http_code}\n" http://localhost:3001 || die "boot failed"
}

echo "=== 0. clean boot: kill zombies, wipe db + mirrors ==="
restart_server
# (db intentionally kept for step 1 login; wiped in step 4 like a new container)

echo ""
echo "=== 1. upload 8MB GIF avatar ==="
TEST_PASSWORD='Yourgy88' python3 scripts/e2e_avatar_serve_cycle.py > /tmp/rt-upload.log 2>&1 \
  || { cat /tmp/rt-upload.log; die "upload e2e failed"; }
cat /tmp/rt-upload.log | grep -E "login OK|PATCH /v1/users/me|avatarUrl ->|GET /api/avatar"
grep -q "GET /api/avatar/.*/ -> HTTP 200" /tmp/rt-upload.log || die "upload step did not serve 200"

echo ""
echo "=== 2. mirror flush (2s debounce) carries upstreamProfile? ==="
sleep 4
python3 - << 'PY' || die "runtime mirror missing upstreamProfile row"
import json
m = json.load(open('db/db-mirror.json'))
rows = m.get('tables', {}).get('upstreamProfile', [])
print(f"savedAt: {m.get('savedAt')}  upstreamProfile rows: {len(rows)}")
assert rows, "no upstreamProfile row in runtime mirror"
av = rows[0].get('avatarUrl') or ''
print(f"row id: {rows[0]['id']}  avatarUrl: {'data:image/gif...' if av.startswith('data:') else av!r} ({len(av):,} chars)")
PY

echo ""
echo "=== 3. deploy-time export (GET /api/db-mirror/latest) carries it? ==="
KEY=$(grep -E '^DB_MIRROR_EXPORT_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' ')
[ -n "$KEY" ] || die "DB_MIRROR_EXPORT_KEY not in .env"
curl -s -m 20 -H "x-db-mirror-key: $KEY" http://localhost:3001/api/db-mirror/latest -o /tmp/rt-export.json \
  || die "export fetch failed"
python3 - << 'PY' || die "export missing upstreamProfile row"
import json
m = json.load(open('/tmp/rt-export.json'))
tables = m.get('tables', {})
rows = tables.get('upstreamProfile', [])
print(f"export savedAt: {m.get('savedAt')}")
print(f"export tables ({len(tables)}): {', '.join(sorted(tables))}")
assert rows, "no upstreamProfile row in export"
print(f"upstreamProfile rows in export: {len(rows)} (id {rows[0]['id']})")
PY

echo ""
echo "=== 4. simulate NEW CONTAINER: fresh db, seed = export ==="
pkill -f 'standalone/server.js' 2>/dev/null || true
sleep 2
rm -f db/custom.db db/custom.db-journal db/db-mirror.json
cp /tmp/rt-export.json db/db-mirror-seed.json
restart_server

echo ""
echo "=== 5+6. after restore: /v1/me avatar + GET /api/avatar/:id ==="
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
