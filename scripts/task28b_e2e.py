#!/usr/bin/env python3
"""Task 28-b E2E: the website admin gate (cookie trust anchor) against the
locally running standalone server on :3000, using the REAL owner account.

Matrix:
  1. fresh owner token  -> GET bans 200 + Set-Cookie liner_web_admin
  2. cookie only        -> GET bans 200 (cookie vouches, no Bearer)
  3. cookie only        -> POST/DELETE ban round-trip 200
  4. no token + no cookie       -> 401
  5. garbage token, no cookie   -> 401 invalid_token (fail-closed unchanged)
  6. garbage token + tampered cookie -> 401
  7. check probe with owner token -> 200 + cookie re-issued (sliding renewal)
  8. announcements POST cookie-only -> 201 (sandbox db only)
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
UPSTREAM = "https://api.tryliner.fun"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
EMAIL = "seekfromohio@gmail.com"
PASSWORD = "Yourgy88"

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))


def call(method, path, body=None, token=None, cookie=None, base=BASE, raw_headers=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("user-agent", UA)
    req.add_header("accept", "application/json")
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    if cookie:
        req.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except Exception:
            return e.code, raw[:300], dict(e.headers)


print("=== 0. login (real owner account) ===", flush=True)
s, login, _ = call("POST", "/v1/auth/login", {"email": EMAIL, "password": PASSWORD}, base=UPSTREAM)
assert s == 200, f"login failed: {s}"
token = login["accessToken"]
print(f"  login ok, token head={token[:20]}...")

print("=== 1. GET bans with fresh token -> 200 + cookie issued ===", flush=True)
s, bans, hdrs = call("GET", "/api/moderation/bans", token=token)
set_cookie = hdrs.get("set-cookie", "")
check("bans GET 200 with fresh owner token", s == 200, f"status={s} body={bans}")
check("Set-Cookie liner_web_admin present", "liner_web_admin=" in set_cookie, f"set-cookie={set_cookie[:120]}")
check("cookie is HttpOnly+Secure+SameSite=Lax+Path=/api",
      all(p in set_cookie.lower() for p in ("httponly", "secure", "samesite=lax", "path=/api")),
      f"set-cookie={set_cookie[:200]}")
cookie_value = set_cookie.split("liner_web_admin=")[1].split(";")[0] if "liner_web_admin=" in set_cookie else ""

print("=== 2. GET bans cookie-only (no Authorization) ===", flush=True)
s, bans2, _ = call("GET", "/api/moderation/bans", cookie=f"liner_web_admin={cookie_value}")
check("bans GET 200 with cookie only", s == 200, f"status={s} body={bans2}")

print("=== 3. cookie-only ban round-trip (scratch user) ===", flush=True)
scratch = f"t28b{int(time.time()) % 100000}"
s, created, _ = call("POST", "/api/moderation/bans",
                     {"username": scratch, "type": "normal", "durationHours": 2, "reason": "t28b cookie gate test"},
                     cookie=f"liner_web_admin={cookie_value}")
check("ban POST 200 with cookie only", s == 200 and created.get("ban", {}).get("username") == scratch,
      f"status={s} body={created}")
s, listing, _ = call("GET", "/api/moderation/bans", cookie=f"liner_web_admin={cookie_value}")
check("scratch ban visible in list", any(b.get("username") == scratch for b in listing.get("bans", [])),
      f"bans={json.dumps(listing)[:200]}")
s, removed, _ = call("DELETE", "/api/moderation/bans", {"username": scratch},
                     cookie=f"liner_web_admin={cookie_value}")
check("ban DELETE 200 with cookie only", s == 200, f"status={s} body={removed}")

print("=== 4. no token, no cookie -> 401 ===", flush=True)
s, body, _ = call("GET", "/api/moderation/bans")
check("bans GET 401 unauthenticated", s == 401, f"status={s} body={body}")

print("=== 5. garbage token, no cookie -> 401 fail-closed ===", flush=True)
s, body, _ = call("GET", "/api/moderation/bans", token="garbage.token.test")
check("bans GET 401 with garbage token", s == 401 and body.get("error") == "invalid_token",
      f"status={s} body={body}")

print("=== 6. garbage token + TAMPERED cookie -> 401 ===", flush=True)
if cookie_value:
    tampered = cookie_value[:-6] + ("AAAAAA" if not cookie_value.endswith("AAAAAA") else "BBBBBB")
    s, body, _ = call("GET", "/api/moderation/bans", token="garbage.token.test",
                      cookie=f"liner_web_admin={tampered}")
    check("bans GET 401 with tampered cookie", s == 401, f"status={s} body={body}")
else:
    check("tampered cookie test", False, "no cookie was issued in step 1")

print("=== 7. check probe with owner username+token -> cookie re-issued ===", flush=True)
s, body, hdrs = call("POST", "/api/moderation/check", {"username": "jayzeyluna", "accessToken": token})
sc = hdrs.get("set-cookie", "")
check("check probe 200", s == 200 and body.get("banned") is False, f"status={s} body={body}")
check("check probe re-issues admin cookie", "liner_web_admin=" in sc, f"set-cookie={sc[:120]}")

print("=== 8. announcements POST cookie-only -> 201 (sandbox db) ===", flush=True)
s, body, _ = call("POST", "/api/announcements",
                  {"message": "t28b cookie gate probe"}, cookie=f"liner_web_admin={cookie_value}")
check("announcement POST 201 with cookie only", s == 201, f"status={s} body={body}")
if s == 201:
    check("announcement sender is the owner", body.get("announcement", {}).get("senderUsername") == "jayzeyluna",
          f"body={json.dumps(body)[:200]}")

print(f"\n=== RESULT: {len(PASS)} pass / {len(FAIL)} fail ===", flush=True)
if FAIL:
    print("FAILED:", FAIL, flush=True)
    sys.exit(1)
print("ALL GREEN", flush=True)
