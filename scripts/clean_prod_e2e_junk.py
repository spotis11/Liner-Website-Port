#!/usr/bin/env python3
"""Clean E2E junk accounts off PRODUCTION via the restore endpoint.

Fetches the live production mirror, removes the two leaked test accounts
(e2e_discord_user, mirror_e2e_user) plus their sessions, and POSTs the
cleaned mirror back through POST /api/db-mirror/restore (DB_MIRROR_EXPORT_KEY
gated). Everything else — guests, the owner's Discord account, system keys —
is preserved untouched.

Usage: python3 scripts/clean_prod_e2e_junk.py
"""
import json
import sys
import urllib.request

PROD = 'https://liner-music.space-z.ai'
JUNK = {'e2e_discord_user', 'mirror_e2e_user'}

key = ''
for line in open('/home/z/my-project/.env'):
    if line.startswith('DB_MIRROR_EXPORT_KEY='):
        key = line.split('=', 1)[1].strip().strip('"').strip(' ')
if not key:
    sys.exit('DB_MIRROR_EXPORT_KEY not found in .env')

def fetch_latest():
    req = urllib.request.Request(
        f'{PROD}/api/db-mirror/latest',
        headers={'authorization': f'Bearer {key}'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def post_restore(payload: dict) -> dict:
    req = urllib.request.Request(
        f'{PROD}/api/db-mirror/restore',
        data=json.dumps(payload).encode(),
        headers={
            'authorization': f'Bearer {key}',
            'content-type': 'application/json',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

before = fetch_latest()
tables = before['tables']
names = [a['username'] for a in tables['account']]
junk_found = [n for n in names if n in JUNK]
print(f'fetched production state: {len(names)} accounts, junk present: {junk_found}')
if not junk_found:
    print('production is already clean — nothing to do')
    sys.exit(0)

keep_ids = {a['id'] for a in tables['account'] if a['username'] not in JUNK}
removed_sessions = 0
for s in list(tables['session']):
    if s.get('accountId') not in keep_ids:
        tables['session'].remove(s)
        removed_sessions += 1
tables['account'] = [a for a in tables['account'] if a['username'] not in JUNK]

print(f'cleaned mirror: {len(tables["account"])} accounts kept, '
      f'{removed_sessions} orphaned session(s) dropped')

result = post_restore({'savedAt': before['savedAt'], 'tables': tables})
print(f"restore result: ok={result.get('ok')} deleted={result.get('deleted')} "
      f"restored={result.get('restored')}")
print('accounts now:', result.get('tables', {}).get('account'))

after = fetch_latest()
final_names = [a['username'] for a in after['tables']['account']]
leak = [n for n in final_names if n in JUNK]
print(f'verification: {len(final_names)} accounts, junk remaining: {leak or "NONE"}')
sys.exit(1 if leak else 0)
