#!/usr/bin/env python3
"""Remove E2E test accounts from the workspace db (and mirror file).

These accounts were created by local E2E scripts hitting the shared :3000
server (workspace db). When a deploy-time production fetch once failed, the
build fell back to the workspace mirror and shipped them to production.
This script removes them at the source so no future fallback can re-ship
them. Guests are NEVER touched — they may be real users.

Removes: e2e_discord_user, mirror_e2e_user (+ their sessions + email logs).
Also rewrites db/db-mirror.json in place (same filtering) so the cleaned
state is effective immediately instead of waiting for the server's 60s
mirror interval.
"""
import json
import sqlite3
import sys
import time

DB = '/home/z/my-project/db/custom.db'
MIRROR = '/home/z/my-project/db/db-mirror.json'
JUNK = ('e2e_discord_user', 'mirror_e2e_user')

def open_db():
    for attempt in range(20):
        try:
            c = sqlite3.connect(DB, timeout=5)
            c.execute('SELECT 1')
            return c
        except sqlite3.OperationalError as e:
            print(f'  db busy (attempt {attempt + 1}): {e}')
            time.sleep(0.5)
    raise SystemExit('could not acquire the workspace db')

c = open_db()
ids = [r[0] for r in c.execute(
    'SELECT id FROM Account WHERE username IN (?, ?)', JUNK).fetchall()]
if not ids:
    print('no junk accounts found — nothing to do')
else:
    print(f'junk accounts: {ids}')
    for aid in ids:
        n = c.execute('DELETE FROM Session WHERE accountId = ?', (aid,)).rowcount
        print(f'  sessions deleted for {aid}: {n}')
        n = c.execute('DELETE FROM EmailLog WHERE username IN (?, ?)', JUNK).rowcount
    n = c.execute('DELETE FROM AccountTrack WHERE accountId IN (?, ?)', tuple(ids)).rowcount if len(ids) == 2 else 0
    print(f'  account tracks deleted: {n}')
    n = c.execute('DELETE FROM AccountPlaylist WHERE accountId IN (?, ?)', tuple(ids)).rowcount if len(ids) == 2 else 0
    print(f'  account playlists deleted: {n}')
    for aid in ids:
        c.execute('DELETE FROM AccountPlaylistItem WHERE playlistId NOT IN (SELECT id FROM AccountPlaylist)')
    n = c.execute('DELETE FROM Account WHERE id IN (?, ?)', tuple(ids)).rowcount if len(ids) == 2 else 0
    print(f'  accounts deleted: {n}')
    c.commit()
    print('workspace db cleaned')

left = c.execute('SELECT username FROM Account ORDER BY createdAt').fetchall()
print(f'remaining accounts ({len(left)}):', [r[0] for r in left])
c.close()

# Rewrite the runtime mirror with the same filter so the cleaned state is
# effective immediately (the running server would also rewrite it within 60s,
# but deterministic is better than eventual).
try:
    m = json.load(open(MIRROR))
    before = len(m['tables'].get('account', []))
    m['tables']['account'] = [a for a in m['tables'].get('account', [])
                              if a.get('username') not in JUNK]
    keep = {a['id'] for a in m['tables']['account']}
    m['tables']['session'] = [s for s in m['tables'].get('session', [])
                              if s.get('accountId') in keep]
    tmp = MIRROR + '.tmp'
    json.dump(m, open(tmp, 'w'), indent=2)
    import os
    os.replace(tmp, MIRROR)
    print(f'mirror cleaned: {before} -> {len(m["tables"]["account"])} accounts, '
          f'{len(m["tables"]["session"])} sessions')
except FileNotFoundError:
    print('no workspace mirror file — skipped')
