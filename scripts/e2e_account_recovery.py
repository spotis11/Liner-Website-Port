#!/usr/bin/env python3
"""E2E — the permanent logout fix: POST /api/auth/recover.

Validates the server half of the account-recovery protocol against the dev
server (:3000):

  1. register -> response carries a recoveryToken
  2. like a track via snapshot PUT
  3. SIMULATE THE WIPE: delete the account + sessions rows from the dev db
     (exactly what an empty-seed deploy does to production)
  4. /api/auth/me with the old token -> 401 (the old world is really gone)
  5. POST /api/auth/recover with the client bundle -> 200 recovered=true,
     same account id, profile rebuilt (username/displayName/email preserved)
  6. /api/auth/me with the NEW token -> 200
  7. re-push the liked snapshot -> GET shows it (the client's re-push path)
  8. token determinism: re-login returns the SAME recoveryToken
  9. negatives: wrong token 401, garbage body 400, foreign token 401
 10. cleanup: remove the test account everywhere (db + mirror file)
"""
import json
import sqlite3
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
MIRROR = "/home/z/my-project/db/db-mirror.json"
SUFFIX = str(int(time.time()))
USERNAME = f"rcv_e2e_{SUFFIX}"
EMAIL = f"{USERNAME}@e2e.local"


def req(method, path, body=None, token=None, ok=(200,)):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            status = resp.status
            payload = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            payload = json.loads(e.read().decode() or "{}")
        except Exception:
            payload = {}
    if status not in ok:
        print(f"FAIL {method} {path} -> {status} {payload}")
        sys.exit(1)
    return status, payload


def db_exec(query, args=()):
    c = sqlite3.connect(DB, timeout=10)
    c.execute("SELECT 1")
    cur = c.execute(query, args)
    rows = cur.fetchall()
    c.commit()
    c.close()
    return rows


def wipe_account(account_id):
    """Kill the account + every session row — the deploy-wipe simulation."""
    db_exec("DELETE FROM \"Session\" WHERE \"accountId\" = ?", (account_id,))
    db_exec("DELETE FROM \"AccountTrack\" WHERE \"accountId\" = ?", (account_id,))
    db_exec("DELETE FROM \"Account\" WHERE \"id\" = ?", (account_id,))


def cleanup(account_id=None):
    if account_id is None:
        rows = db_exec("SELECT id FROM \"Account\" WHERE username = ?", (USERNAME,))
        account_id = rows[0][0] if rows else None
    if account_id:
        wipe_account(account_id)
        # scrub the runtime mirror so the junk can never ride a deploy
        try:
            m = json.load(open(MIRROR))
            for table, pk in (("account", "id"), ("session", "id")):
                rows = m.get("tables", {}).get(table, [])
                if table == "account":
                    m["tables"][table] = [
                        r for r in rows if r.get("id") != account_id
                    ]
                else:
                    m["tables"][table] = [
                        r for r in rows if r.get("accountId") != account_id
                    ]
            m["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            json.dump(m, open(MIRROR, "w"))
        except Exception as exc:
            print(f"mirror scrub skipped: {exc}")


def main():
    # 0. dev server alive
    req("GET", "/api/health")

    # 1. register — recoveryToken must ship with the very first session
    _, reg = req("POST", "/api/auth/register", {
        "email": EMAIL,
        "password": "recover-e2e-pass",
        "username": USERNAME,
        "displayName": "Recovery E2E",
    })
    token = reg["recoveryToken"]
    user = reg["user"]
    account_id = user["id"]
    assert token.startswith("wrc2_"), f"no recoveryToken issued: {token}"
    assert user["username"] == USERNAME
    print(f"1. register ok — recoveryToken {token[:12]}… issued")

    # 2. token determinism BEFORE the wipe: login + refresh re-issue the
    #    SAME token (HMAC over the account id with the stable secret)
    _, login = req("POST", "/api/auth/login", {
        "email": EMAIL, "password": "recover-e2e-pass",
    })
    assert login["recoveryToken"] == token, "recovery token drifted at login!"
    _, refresh = req("POST", "/api/auth/refresh", {"refreshToken": login["refreshToken"]})
    assert refresh["recoveryToken"] == token, "refresh lost the recovery token!"
    print("2. recoveryToken stable across login + refresh")

    # 3. like a track via snapshot
    track = {
        "id": "rcv_e2e_track_1",
        "title": "Recovery Probe Song",
        "artists": "E2E Artist",
        "coverUrl": "",
        "durationMs": 123000,
        "source": "youtube",
    }
    req("PUT", "/api/library/tracks", {"track": track, "trackSnapshot": track},
        token=reg["accessToken"])
    print("3. liked-track snapshot stored")

    # 4. THE WIPE
    wipe_account(account_id)
    print("3. account + sessions wiped from the db (deploy-wipe simulation)")

    # 5. the old token is now dead — /me 401
    req("GET", "/api/auth/me", token=reg["accessToken"], ok=(401,))
    print("5. old session confirmed dead (me -> 401)")

    # 6. recovery from the client bundle
    status, rec = req("POST", "/api/auth/recover", {
        "accountId": account_id,
        "recoveryToken": token,
        "user": user,
    })
    assert status == 200 and rec.get("recovered") is True, rec
    assert rec["user"]["id"] == account_id, "account id must survive the rebuild"
    assert rec["user"]["username"] == USERNAME, "username must survive the rebuild"
    assert rec["user"]["displayName"] == "Recovery E2E"
    assert rec["user"]["email"] == EMAIL
    new_access = rec["accessToken"]
    assert rec["recoveryToken"] == token, "recovery re-issue drifted from S1!"
    print(f"6. recovered=true — account rebuilt in place ({rec['user']['username']}), token re-signed with the same secret")

    # 7. the new session works
    req("GET", "/api/auth/me", token=new_access, ok=(200,))
    print("7. /me with the new token -> 200")

    # 8. re-push the liked library (what repushLikedLibrary does client-side)
    req("PUT", "/api/library/tracks", {"track": track, "trackSnapshot": track},
        token=new_access)
    _, lib = req("GET", "/api/library/tracks?limit=10", token=new_access)
    titles = [i["track"]["id"] for i in lib.get("items", [])]
    assert "rcv_e2e_track_1" in titles, f"liked track missing after re-push: {titles}"
    print("8. liked library re-pushed and readable (recovery -> library closed)")

    # 9. negatives
    req("POST", "/api/auth/recover", {
        "accountId": account_id, "recoveryToken": "wrc2_" + "0" * 64, "user": user,
    }, ok=(401,))
    req("POST", "/api/auth/recover", {"accountId": account_id}, ok=(400,))
    req("POST", "/api/auth/recover", {
        "accountId": account_id, "recoveryToken": "wrc2_deadbeef", "user": user,
    }, ok=(401,))
    print("9. wrong/garbage/malformed bundles all rejected")

    # 10. cleanup
    cleanup(account_id)
    print("10. test account scrubbed from db + mirror")


if __name__ == "__main__":
    try:
        main()
        print("\nE2E PASS — recovery protocol verified end to end")
    except Exception as exc:
        print(f"\nE2E FAIL: {exc}")
        cleanup()
        sys.exit(1)
