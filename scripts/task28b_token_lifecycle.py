#!/usr/bin/env python3
"""Task 28-b: probe the REAL upstream token lifecycle with a throwaway account.

Answers:
1. What does /v1/auth/register return (token metadata shape, TTLs)?
2. Does /v1/auth/refresh work with the contract {refreshToken}?
3. Does refresh ROTATE the refresh token (old one invalidated)?
4. What is the access token TTL / refresh token TTL?
5. Does /v1/me accept the refreshed access token?
"""
import json
import time
import urllib.request
import urllib.error

BASE = "https://api.tryliner.fun"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

STAMP = str(int(time.time()))
EMAIL = f"task28b{STAMP}@example.com"
USERNAME = f"t28b{STAMP[-6:]}"  # <= lowercase alnum/underscore 3-30
PASSWORD = "T28b!probe" + STAMP[-4:]


def call(method, path, body=None, token=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("user-agent", UA)
    req.add_header("accept", "application/json")
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]


def summarize(tag, tokens):
    if not isinstance(tokens, dict):
        print(f"  [{tag}] (not a dict) {tokens}")
        return
    print(f"  [{tag}] keys: {sorted(tokens.keys())}")
    for k in ("accessTokenExpiresAt", "expiresAt", "refreshTokenExpiresAt"):
        v = tokens.get(k)
        if v is not None:
            print(f"  [{tag}] {k} = {v!r}")
    at = tokens.get("accessToken") or ""
    rt = tokens.get("refreshToken") or ""
    print(f"  [{tag}] accessToken len={len(at)} head={at[:24]}...")
    print(f"  [{tag}] refreshToken len={len(rt)} head={rt[:24]}...")
    # try to decode JWT payload for exp/iat claims
    for name, tok in (("access", at), ("refresh", rt)):
        parts = tok.split(".") if tok else []
        if len(parts) == 3:
            import base64
            pad = parts[1] + "=" * (-len(parts[1]) % 4)
            try:
                payload = json.loads(base64.urlsafe_b64decode(pad))
                print(f"  [{tag}] {name} JWT claims: {payload}")
            except Exception as e:
                print(f"  [{tag}] {name} JWT decode failed: {e}")


print("=== 1. register ===", flush=True)
status, reg = call("POST", "/v1/auth/register", {
    "email": EMAIL, "password": PASSWORD,
    "username": USERNAME, "displayName": "Task28b Probe",
})
print(f"  HTTP {status}", flush=True)
print(f"  body: {json.dumps(reg)[:400] if isinstance(reg, dict) else reg}", flush=True)
summarize("register", reg if isinstance(reg, dict) else None)
if status >= 400:
    raise SystemExit(f"register failed — {EMAIL} / {USERNAME}")

tok = reg or {}
access1 = tok.get("accessToken", "")
refresh1 = tok.get("refreshToken", "")

print("=== 2. /v1/me with register access token ===")
s, me = call("GET", "/v1/me", token=access1)
print(f"  HTTP {s}: {json.dumps(me)[:200] if isinstance(me, dict) else me}")

print("=== 3. refresh with refreshToken (contract check) ===")
s, r1 = call("POST", "/v1/auth/refresh", {"refreshToken": refresh1})
print(f"  HTTP {s}")
summarize("refresh#1", r1 if isinstance(r1, dict) else r1)

if isinstance(r1, dict) and r1.get("refreshToken"):
    refresh2 = r1["refreshToken"]
    access2 = r1.get("accessToken", "")
    print("=== 4. rotation test: reuse OLD refresh token ===")
    s, r2 = call("POST", "/v1/auth/refresh", {"refreshToken": refresh1})
    print(f"  HTTP {s}: {json.dumps(r2)[:200] if isinstance(r2, dict) else r2}")
    print("=== 5. old access token after rotation? ===")
    s, _ = call("GET", "/v1/me", token=access1)
    print(f"  old access token /v1/me -> HTTP {s}")
    print("=== 6. new access token /v1/me ===")
    s, _ = call("GET", "/v1/me", token=access2)
    print(f"  new access token /v1/me -> HTTP {s}")
    print("=== 7. refresh AGAIN with newest refresh token ===")
    s, r3 = call("POST", "/v1/auth/refresh", {"refreshToken": refresh2})
    print(f"  HTTP {s}: keys={sorted(r3.keys()) if isinstance(r3, dict) else r3}")

print("=== done ===")
