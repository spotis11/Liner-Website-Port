#!/usr/bin/env python3
"""
E2E: Liner Pro big animated-GIF avatar pipeline on the v1.26 tree.

  1. mint a guest account, flag it isPro in the dev db (mirrors the owner overlay)
  2. build a REAL multi-frame animated GIF (~6 MB) -> data URL
  3. PATCH /api/auth/profile {avatarUrl} -> 200, response avatarUrl rewritten to /api/avatar/<id>
  4. GET /api/avatar/<id> (public, unauthenticated) -> 200 image/gif, byte-identical
  5. negative: a non-Pro account with the same GIF -> 413 AVATAR_TOO_LARGE (Pro upsell text)
  6. cleanup: delete the test accounts
Run: python3 scripts/e2e_gif_avatar_pro.py [base_url]
"""
import base64
import io
import json
import sqlite3
import sys
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
FAILURES = []


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


def call(method, path, token=None, payload=None, raw_body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("authorization", f"Bearer {token}")
    body = raw_body if raw_body is not None else (json.dumps(payload).encode() if payload is not None else None)
    if body:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, body, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def mint_guest():
    st, body = call("POST", "/api/auth/guest", payload={})
    d = json.loads(body)
    return st, d


def make_big_gif_data_url(target_bytes=6 * 1024 * 1024):
    from PIL import Image
    import random
    frames = []
    random.seed(7)
    n = 0
    while True:
        im = Image.effect_noise((256, 256), 50).convert("L").convert("P", palette=Image.ADAPTIVE, colors=16)
        frames.append(im)
        n += 1
        buf = io.BytesIO()
        frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)
        if buf.tell() >= target_bytes or n >= 400:
            break
    data = buf.getvalue()
    return "data:image/gif;base64," + base64.b64encode(data).decode(), len(data)


# ---- 1. pro test account ----
st, pro = mint_guest()
check("guest minted (pro candidate)", st == 200, str(st))
pro_token, pro_id = pro["accessToken"], pro["user"]["id"]
con = sqlite3.connect("/home/z/my-project/db/custom.db")
con.execute("UPDATE Account SET isPro=1 WHERE id=?", (pro_id,))
con.commit()
con.close()
print(f"[setup] pro test account {pro['user']['username']} ({pro_id}) flagged isPro")

# ---- 2. big animated gif ----
gif_url, gif_len = make_big_gif_data_url()
print(f"[setup] animated GIF built: {gif_len/1e6:.1f} MB raw, data URL {len(gif_url)/1e6:.1f}M chars")

# ---- 3. PATCH avatar as Pro ----
st, body = call("PATCH", "/api/auth/profile", pro_token, {"avatarUrl": gif_url})
resp = json.loads(body) if st == 200 else {}
avatar = resp.get("avatarUrl", "")
check("Pro accepts ~6MB animated GIF", st == 200, f"status={st} body={body[:160]}")
check("response avatarUrl rewritten to /api/avatar/<id>",
      avatar.startswith("/api/avatar/"), avatar[:80])

# ---- 4. public avatar route serves it byte-identical ----
st2, raw = call("GET", avatar)
check("GET /api/avatar/<id> (no auth) -> 200", st2 == 200, str(st2))
orig = base64.b64decode(gif_url.split(",", 1)[1])
check("served bytes identical to uploaded GIF", raw == orig,
      f"len served={len(raw)} len orig={len(orig)}")
ct_ok = raw[:6] in (b"GIF87a", b"GIF89a")
check("payload is a real GIF header", ct_ok, str(raw[:6]))

# ---- 5. negative: non-Pro gets 413 ----
st, other = mint_guest()
oth_token, oth_id = other["accessToken"], other["user"]["id"]
st3, body3 = call("PATCH", "/api/auth/profile", oth_token, {"avatarUrl": gif_url})
err = json.loads(body3) if body3 else {}
check("non-Pro rejected 413 AVATAR_TOO_LARGE", st3 == 413 and err.get("code") == "AVATAR_TOO_LARGE",
      f"status={st3} code={err.get('code')} msg={err.get('error','')[:90]}")
check("rejection message mentions Liner Pro", "Liner Pro" in err.get("error", ""), "")

# ---- 6. cleanup test accounts ----
con = sqlite3.connect("/home/z/my-project/db/custom.db")
for uid in (pro_id, oth_id):
    con.execute("DELETE FROM AccountPlaylistItem WHERE playlistId IN (SELECT id FROM AccountPlaylist WHERE accountId=?)", (uid,))
    for tbl in ("Session", "AccountTrack", "AccountPlaylist"):
        con.execute(f"DELETE FROM {tbl} WHERE accountId=?", (uid,))
    con.execute("DELETE FROM Account WHERE id=?", (uid,))
con.commit()
left = con.execute("SELECT COUNT(*) FROM Account").fetchone()[0]
con.close()
print(f"[cleanup] test accounts deleted; accounts left in dev db: {left}")

print()
print("ALL GIF AVATAR CHECKS PASSED" if not FAILURES else f"FAILED: {FAILURES}")
sys.exit(1 if FAILURES else 0)
