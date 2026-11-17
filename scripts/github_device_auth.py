#!/usr/bin/env python3
"""GitHub OAuth device flow — headless auth for pushing from this sandbox.

Usage:
  github_device_auth.py get    # step 1: request a user code, print it
  github_device_auth.py poll   # step 2: poll until authorized, store token

Security:
  - the device_code and access_token are written ONLY to gitignored files
    (.secrets/device_flow.json, .git-credentials — both chmod 600)
  - tokens are never printed, never logged; stdout shows statuses only
  - scope requested: repo (push access to the user's repositories)
  - client_id is GitHub CLI's public OAuth app id (same one `gh auth login`
    uses for its device flow)
"""
import json, os, sys, time, urllib.parse, urllib.request, pathlib

CLIENT_ID = "178c6fc778ccc68e1d6a"  # GitHub CLI's public OAuth app (device flow)
SCOPE = "repo"
STATE = pathlib.Path("/home/z/my-project/.secrets/device_flow.json")
CREDS = pathlib.Path("/home/z/my-project/.git-credentials")
API = "https://github.com"


def _post(url, data):
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(data).encode(),
        headers={"Accept": "application/json", "User-Agent": "liner-sandbox"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def get_code():
    d = _post(f"{API}/login/device/code", {
        "client_id": CLIENT_ID, "scope": SCOPE,
    })
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({
        "device_code": d["device_code"],
        "interval": d.get("interval", 5),
        "expires_in": d.get("expires_in", 900),
    }), encoding="utf-8")
    os.chmod(STATE, 0o600)
    print(f"USER_CODE={d['user_code']}")
    print(f"VERIFY_URL={d['verification_uri']}")
    print(f"(valid ~{d.get('expires_in', 900)//60} min)")


def poll():
    st = json.loads(STATE.read_text())
    deadline = time.time() + min(st["expires_in"], 9 * 60)
    interval = max(st["interval"], 5)
    tok = None
    while time.time() < deadline:
        time.sleep(interval)
        r = _post(f"{API}/login/oauth/access_token", {
            "client_id": CLIENT_ID,
            "device_code": st["device_code"],
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        })
        if r.get("access_token"):
            tok = r["access_token"]
            break
        err = r.get("error")
        if err == "authorization_pending":
            print("waiting for authorization ...", flush=True)
        elif err == "slow_down":
            interval += 5
        elif err in ("expired_token", "unsupported_grant_type",
                     "incorrect_client_credentials", "access_denied"):
            print(f"FAILED: {err}")
            return 1
        else:
            print(f"note: {err or 'no field'}", flush=True)
    if not tok:
        print("TIMED OUT waiting for authorization — run 'poll' again or 'get' for a fresh code")
        return 1
    # confirm identity + scopes (prints only the login name, never the token)
    # non-fatal: some proxied responses come back non-JSON — the token must be
    # stored regardless; identity is a nice-to-have
    login = "oauth2"  # GitHub accepts any username when the password is a PAT
    try:
        req = urllib.request.Request(f"{API}/user", headers={
            "Authorization": f"Bearer {tok}", "User-Agent": "liner-sandbox"})
        with urllib.request.urlopen(req, timeout=30) as r:
            login = json.loads(r.read().decode())["login"]
            scopes = r.headers.get("X-OAuth-Scopes", "?")
        print(f"AUTHORIZED as {login} (scopes: {scopes})")
    except Exception as e:
        print(f"note: identity check skipped ({type(e).__name__}) — token still stored")
    # store in the git credential-store file the configured helper reads
    line = f"https://{login}:{tok}@github.com\n"
    existing = CREDS.read_text().splitlines() if CREDS.exists() else []
    existing = [l for l in existing if "@github.com" not in l]
    CREDS.write_text("\n".join(existing + [line]) + "\n", encoding="utf-8")
    os.chmod(CREDS, 0o600)
    STATE.unlink()  # device code no longer needed
    print("token stored to .git-credentials (0600, gitignored) — ready to push")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("get", "poll"):
        print(__doc__)
        sys.exit(2)
    sys.exit(get_code() if sys.argv[1] == "get" else poll())
