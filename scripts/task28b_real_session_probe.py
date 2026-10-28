#!/usr/bin/env python3
"""Task 28-b: reproduce the owner's EXACT session lifecycle with the real E2E
account. Read-only: login, /v1/me, refresh (once), production bans GET.
No writes, no profile changes."""
import json
import time
import base64
import urllib.request
import urllib.error

BASE = "https://api.tryliner.fun"
PROD = "https://liner-music.space-z.ai"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
EMAIL = "seekfromohio@gmail.com"
PASSWORD = "Yourgy88"


def call(base, method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("user-agent", UA)
    req.add_header("accept", "application/json")
    req.add_header("origin", PROD)
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]


def jwt_claims(tok):
    parts = tok.split(".") if tok else []
    if len(parts) != 3:
        return None
    pad = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(pad))
    except Exception:
        return None


def show(tag, tok):
    if not isinstance(tok, dict):
        print(f"  [{tag}] {tok}")
        return
    print(f"  [{tag}] keys: {sorted(tok.keys())}")
    for k in ("accessTokenExpiresAt", "expiresAt", "refreshTokenExpiresAt"):
        if tok.get(k) is not None:
            print(f"  [{tag}] {k} = {tok[k]!r}")
    at, rt = tok.get("accessToken") or "", tok.get("refreshToken") or ""
    ac, rc = jwt_claims(at), jwt_claims(rt)
    now = time.time()
    if ac:
        exp = ac.get("exp")
        print(f"  [{tag}] access JWT: exp={exp} ttl_left={((exp-now)/3600 if exp else None):.2f}h iat={ac.get('iat')} sub={ac.get('sub')}")
    else:
        print(f"  [{tag}] access token NOT a JWT (len={len(at)}, head={at[:20]})")
    if rc:
        exp = rc.get("exp")
        print(f"  [{tag}] refresh JWT: exp={exp} ttl_left={((exp-now)/86400 if exp else None):.2f}d")
    else:
        print(f"  [{tag}] refresh token NOT a JWT (len={len(rt)})")


print("=== 1. login (same contract the browser uses) ===", flush=True)
s, login = call(BASE, "POST", "/v1/auth/login", {"email": EMAIL, "password": PASSWORD})
print(f"  HTTP {s}", flush=True)
show("login", login if isinstance(login, dict) else None)
if s >= 400 or not isinstance(login, dict):
    raise SystemExit("login failed")
access, refresh = login.get("accessToken", ""), login.get("refreshToken", "")

print("=== 2. /v1/me (who is this?) ===", flush=True)
s, me = call(BASE, "GET", "/v1/me", token=access)
print(f"  HTTP {s}: {json.dumps(me)[:300] if isinstance(me, dict) else me}", flush=True)

print("=== 3. PROD /api/moderation/bans with the fresh token (admin-tab call) ===", flush=True)
s, bans = call(PROD, "GET", "/api/moderation/bans", token=access)
print(f"  HTTP {s}: {json.dumps(bans)[:300] if isinstance(bans, dict) else bans}", flush=True)

print("=== 4. refresh (the self-heal path) ===", flush=True)
s, r1 = call(BASE, "POST", "/v1/auth/refresh", {"refreshToken": refresh})
print(f"  HTTP {s}", flush=True)
show("refresh#1", r1 if isinstance(r1, dict) else r1)
if isinstance(r1, dict) and r1.get("accessToken"):
    print("=== 5. PROD bans with the REFRESHED token ===", flush=True)
    s, bans2 = call(PROD, "GET", "/api/moderation/bans", token=r1["accessToken"])
    print(f"  HTTP {s}: {json.dumps(bans2)[:300] if isinstance(bans2, dict) else bans2}", flush=True)
    old = r1.get("refreshToken")
    if old and old != refresh:
        print("=== 6. rotation: reuse the OLD refresh token ===", flush=True)
        s, r2 = call(BASE, "POST", "/v1/auth/refresh", {"refreshToken": refresh})
        print(f"  HTTP {s}: {json.dumps(r2)[:200] if isinstance(r2, dict) else r2}", flush=True)

print("=== done ===", flush=True)
