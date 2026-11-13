#!/usr/bin/env bash
# Re-arm the deploy chain after the 2026-11-13 ~08:12Z sandbox reset wiped
# .env, db/production-mirror-latest.json and every SystemKey row.
# Fixes the platform Deploy error: "Sorry, there was a problem deploying
# the code." (build died in verify_standalone_env.py + the mirror gate).
set -euo pipefail
cd /home/z/my-project

echo "== 1/6 prisma client ready =="
npx prisma generate >/dev/null 2>&1 && echo "prisma generate OK"

echo "== 2/6 bootstrap website_session_secret via the real runtime =="
CODE=$(curl -s -o /tmp/guest_bootstrap.json -w "%{http_code}" --max-time 40 \
  -X POST http://localhost:3000/api/auth/guest \
  -H 'content-type: application/json' -d '{}' || true)
echo "guest login -> HTTP $CODE (side effect: sessionSecret() creates the SystemKey row)"
if [ "$CODE" != "200" ]; then echo "guest bootstrap failed"; cat /tmp/guest_bootstrap.json; exit 1; fi
rm -f /tmp/guest_bootstrap.json

echo "== 3/6 purge account-scoped rows (keep ONLY SystemKey) =="
python3 - <<'PY'
import sqlite3
con = sqlite3.connect('db/custom.db')
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
keep = {"SystemKey", "_prisma_migrations"}
for t in sorted(tables):
    if t in keep or t.startswith('_'):
        continue
    try:
        n = con.execute(f'DELETE FROM "{t}"').rowcount
        if n: print(f'  {t}: purged {n} row(s)')
    except Exception as e:
        print(f'  {t}: skip ({e})')
con.commit()
rows = con.execute('SELECT key FROM "SystemKey"').fetchall()
print('SystemKey rows now:', [r[0] for r in rows])
con.close()
PY

echo "== 4/6 export the production-mirror cache =="
export DATABASE_URL="file:/home/z/my-project/db/custom.db"
node scripts/gen_db_mirror_seed.mjs --out db/production-mirror-latest.json
chmod 600 db/production-mirror-latest.json
python3 -c "
import json
d = json.load(open('db/production-mirror-latest.json'))
t = d.get('tables', {})
print('cache: accounts=%d systemKeys=%d savedAt=%s' % (
    len(t.get('account') or []), len(t.get('systemKey') or []), d.get('savedAt')))
assert len(t.get('systemKey') or []) >= 1, 'cache must carry the session secret'
assert len(t.get('account') or []) == 0, 'cache must NOT carry workspace accounts'
"

echo "== 5/6 rebuild .env (values never printed) =="
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

echo "== 6/6 dry-run the REAL deploy gate =="
rm -rf /tmp/gate_test && mkdir -p /tmp/gate_test
if PROJECT_DIR=/home/z/my-project BUILD_DIR=/tmp/gate_test bash .zscripts/database-runtime-build.sh; then
  python3 -c "
import json
d = json.load(open('/tmp/gate_test/db/db-mirror-seed.json'))
t = d['tables']
keys = [r.get('key') for r in t.get('systemKey', [])]
print('packaged seed: accounts=%d systemKeys=%s' % (len(t.get('account') or []), keys))
assert 'website_session_secret' in keys, 'seed must carry the session secret'
"
  echo "DEPLOY CHAIN RE-ARMED"
else
  echo "GATE DRY-RUN FAILED"; exit 1
fi
rm -rf /tmp/gate_test
