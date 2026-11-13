#!/usr/bin/env python3
"""
E2E: PATCH /api/auth/profile honors every shape the settings UI sends.

Regression cover for "updating profile isn't working":
  1. null bio          -> bio actually cleared (used to be silently ignored)
  2. null displayName  -> display name falls back to the username
  3. null avatarUrl    -> avatar actually removed ("Remove avatar" button)
  4. 3-30 char usernames accepted (client + upstream rule; server used to cap 24)
  5. 500-char bio kept whole (server used to silently truncate at 300)
  6. plain string updates still work (no regression)
  7. privacy toggles still work (no regression)
  8. invalid username still rejected with INVALID_USERNAME
Run: python3 scripts/e2e_profile_update.py [base_url]
"""
import json
import sys
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
FAILURES = []


def call(method, path, token=None, payload=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        body = err.read().decode()
        try:
            return err.code, json.loads(body or "{}")
        except json.JSONDecodeError:
            return err.code, {"raw": body}


def check(name, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


def main():
    # fresh guest session
    status, auth = call("POST", "/api/auth/guest", payload={})
    check("guest session minted", status == 200 and "accessToken" in auth)
    token = auth["accessToken"]
    username = auth["user"]["username"]

    # 6. plain string updates (regression guard)
    status, user = call("PATCH", "/api/auth/profile", token,
                        {"displayName": "E2E Profile", "bio": "hello world"})
    check("string displayName+bio applied",
          status == 200 and user.get("displayName") == "E2E Profile"
          and user.get("bio") == "hello world")

    # 2. null displayName -> username fallback
    status, user = call("PATCH", "/api/auth/profile", token, {"displayName": None})
    check("null displayName falls back to username",
          status == 200 and user.get("displayName") == username)

    # 5. 500-char bio kept whole
    long_bio = "x" * 500
    status, user = call("PATCH", "/api/auth/profile", token, {"bio": long_bio})
    check("500-char bio kept whole", status == 200 and user.get("bio") == long_bio)

    # 1. null bio cleared
    status, user = call("PATCH", "/api/auth/profile", token, {"bio": None})
    check("null bio clears the bio", status == 200 and user.get("bio") is None)

    # 3. avatar set then null-removed
    status, user = call("PATCH", "/api/auth/profile", token,
                        {"avatarUrl": "data:image/png;base64,iVBORw0KGgo="})
    check("avatar set", status == 200 and user.get("avatarUrl"))
    status, user = call("PATCH", "/api/auth/profile", token, {"avatarUrl": None})
    check("null avatarUrl removes the avatar",
          status == 200 and user.get("avatarUrl") is None)

    # 4. 28-char username accepted (used to fail: server cap was 24)
    long_name = (username[:14] + "longusername28chr").lower()[:28]
    status, user = call("PATCH", "/api/auth/profile", token, {"username": long_name})
    check("28-char username accepted",
          status == 200 and user.get("username") == long_name)

    # 2b. cleared name now falls back to the NEW username
    status, user = call("PATCH", "/api/auth/profile", token, {"displayName": None})
    check("clear after username change falls back to new username",
          status == 200 and user.get("displayName") == long_name)

    # 7. privacy toggles
    status, user = call("PATCH", "/api/auth/profile", token,
                        {"showActivity": False, "participateLeaderboards": False})
    check("privacy toggles applied",
          status == 200 and user.get("showActivity") is False
          and user.get("participateLeaderboards") is False)
    status, user = call("PATCH", "/api/auth/profile", token,
                        {"showActivity": True, "participateLeaderboards": True})

    # 8. invalid username still rejected
    status, err = call("PATCH", "/api/auth/profile", token, {"username": "ab"})
    check("2-char username rejected as INVALID_USERNAME",
          status == 400 and err.get("code") == "INVALID_USERNAME")

    # cleanup: guest account cannot be deleted via api — leave it, it rides
    # the same lifecycle as every other probe account (excluded from mirrors
    # by the production seed policy)
    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}): " + ", ".join(FAILURES))
        sys.exit(1)
    print("ALL PROFILE UPDATE CHECKS PASSED")


if __name__ == "__main__":
    main()
