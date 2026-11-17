#!/usr/bin/env bash
# Re-arm the z.ai platform deploy gate on 2026-11-17 — ADAPTED from
# rearm_deploy_chain.sh (2026-11-13) WITHOUT its step-3 DB purge: db/custom.db
# now holds real data that was just shipped to running.sh and must be kept.
# The DB is already in the reset-recovery shape (SystemKey empty, 0 accounts),
# so only these steps are needed:
#   1/4 rewrite .env with the required non-secret keys (values never printed)
#   2/4 bootstrap website_session_secret via the real runtime (:3000)
#   3/4 regenerate the production-mirror seed (chmod 600)
#   4/4 dry-run the REAL platform gate (.zscripts/database-runtime-build.sh)
set -euo pipefail
cd /home/z/my-project

echo "== 1/4 rebuild .env (values never printed) =="
umask 077
DBURL=$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)
MKEY=$(openssl rand -hex 32)
cat > .env <<EOF
DATABASE_URL=${DBURL}
DISCORD_CLIENT_ID=1552617559675633664
DISCORD_PUBLIC_BASE=https://liner-music.space-z.ai
DISCORD_REDIRECT_URI=https://liner-music.space-z.ai/api/auth/discord/callback
DB_MIRROR_EXPORT_KEY=${MKEY}
EOF
chmod 600 .env
echo ".env key names: $(cut -d= -f1 .env | tr '\n' ' ')"

echo "== 2/4 bootstrap website_session_secret via the real runtime =="
CODE=$(curl -s -o /tmp/guest_bootstrap.json -w "%{http_code}" --max-time 40 \
  -X POST http://localhost:3000/api/auth/guest \
  -H 'content-type: application/json' -d '{}' || true)
echo "guest login -> HTTP $CODE"
if [ "$CODE" != "200" ]; then echo "guest bootstrap failed"; cat /tmp/guest_bootstrap.json; exit 1; fi
rm -f /tmp/guest_bootstrap.json
python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
rows = con.execute('SELECT key FROM \"SystemKey\"').fetchall()
print('SystemKey rows now:', [r[0] for r in rows])
assert 'website_session_secret' in [r[0] for r in rows], 'session secret missing'
"

echo "== 3/4 export the production-mirror cache =="
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
node scripts/gen_db_mirror_seed.mjs --out db/production-mirror-latest.json
chmod 600 db/production-mirror-latest.json
python3 -c "
import json
d = json.load(open('db/production-mirror-latest.json'))
t = d['tables']
keys = [r.get('key') for r in t.get('systemKey', [])]
print('mirror seed: accounts=%d systemKeys=%s' % (len(t.get('account') or []), keys))
assert 'website_session_secret' in keys, 'seed must carry the session secret'
"

echo "== 4/4 dry-run the REAL deploy gate =="
rm -rf /tmp/gate_test && mkdir -p /tmp/gate_test
if PROJECT_DIR=/home/z/my-project BUILD_DIR=/tmp/gate_test bash .zscripts/database-runtime-build.sh; then
  python3 -c "
import json
d = json.load(open('/tmp/gate_test/db/db-mirror-seed.json'))
keys = [r.get('key') for r in d['tables'].get('systemKey', [])]
print('packaged seed systemKeys:', keys)
assert 'website_session_secret' in keys
"
  echo "DEPLOY GATE READY"
else
  echo "GATE DRY-RUN FAILED"; exit 1
fi
rm -rf /tmp/gate_test

echo "== bonus: refresh standalone .env + verify (matches build script behavior) =="
cp .env .next/standalone/.env
python3 scripts/verify_standalone_env.py
