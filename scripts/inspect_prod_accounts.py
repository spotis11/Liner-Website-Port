#!/usr/bin/env python3
"""Inspect LIVE production accounts: usernames, emails, password presence,
Discord linkage, session counts. Read-only — no restore POST."""
import json
import sys
import urllib.request

PROD = 'https://liner-music.space-z.ai'

key = ''
for line in open('/home/z/my-project/.env'):
    if line.startswith('DB_MIRROR_EXPORT_KEY='):
        key = line.split('=', 1)[1].strip().strip('"').strip(' ')
if not key:
    sys.exit('DB_MIRROR_EXPORT_KEY not found in .env')

req = urllib.request.Request(
    f'{PROD}/api/db-mirror/latest',
    headers={'authorization': f'Bearer {key}'},
)
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

tables = data['tables']
accounts = tables.get('account', [])
sessions = tables.get('session', [])
print(f"accounts: {len(accounts)}   sessions: {len(sessions)}")
print('-' * 100)
sess_by_acct = {}
for s in sessions:
    sess_by_acct[s.get('accountId')] = sess_by_acct.get(s.get('accountId'), 0) + 1

for a in sorted(accounts, key=lambda x: str(x.get('createdAt', ''))):
    has_pw = bool(a.get('passwordHash'))
    disc = a.get('discordId') or a.get('discord_id') or ''
    email = a.get('email') or ''
    n_sess = sess_by_acct.get(a.get('id'), 0)
    print(f"user={a.get('username','?'):<22} email={email:<32} pw={'YES' if has_pw else 'no '} discord={disc or '-':<20} sessions={n_sess} created={a.get('createdAt','?')}")

# extra tables of interest
print('-' * 100)
print("other mirrored tables:", [k for k in tables.keys() if k not in ('account', 'session')])
