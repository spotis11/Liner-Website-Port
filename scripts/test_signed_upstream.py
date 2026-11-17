"""Replicate the relay's signed upstream calls (same scheme as upstreamSigner.ts)."""
import hashlib, hmac, base64, json, time, os, urllib.request, urllib.error

OBF_API_SEED = bytes([0x55, 0xc3, 0x5c, 0xaa, 0x3f, 0x3c, 0x32, 0x6d, 0xaa, 0x63, 0x0f, 0x90,
                      0x39, 0x5d, 0x66, 0x36])
OBF_API_KEY = bytes([0x24, 0x99, 0x56, 0x2b, 0x80, 0x20, 0xc1, 0xb7, 0xf6, 0x7d, 0x74, 0x91,
                     0xe4, 0xc3, 0x7f, 0x67, 0x1a, 0x0e, 0x8a, 0xf3, 0x7f, 0x50, 0xaf, 0x2e,
                     0x05, 0xd5, 0xa7, 0xb0, 0xbe, 0x6e, 0x31, 0x11, 0x40, 0xf3, 0x42, 0xad,
                     0x31, 0xf6, 0xcb, 0xea, 0xb5, 0xba, 0xdd, 0xd0, 0x8e, 0x56, 0x55, 0x8c,
                     0xb4, 0xe5, 0x1d, 0x82, 0x69, 0x0c, 0x3f, 0xb2, 0x30, 0x82, 0xa7, 0xf4,
                     0x9b, 0xba, 0x9b, 0x70])
API_KEY_CHECKSUM = bytes([0xe2, 0x09, 0x02, 0x55, 0x83, 0xee, 0xf0, 0x07])


def derive_key():
    ks = b""
    for i in range(256):
        if len(ks) >= 64:
            break
        ks += hashlib.sha256(OBF_API_SEED + bytes([i])).digest()
    key = bytes(a ^ b for a, b in zip(OBF_API_KEY, ks))
    digest = hashlib.sha256(key).digest()
    assert digest[:8] == API_KEY_CHECKSUM, "key derivation failed"
    return key


KEY = derive_key()


def sign(method, path, body=""):
    ts = str(int(time.time()))
    nonce = base64.urlsafe_b64encode(os.urandom(8)).decode().rstrip("=")
    body_sha = hashlib.sha256(body.encode()).hexdigest()
    canonical = f"{method.upper()}\n{path.split('?')[0]}\n{ts}\n{nonce}\n{body_sha}"
    mac = hmac.new(KEY, canonical.encode(), hashlib.sha256).digest()
    sig = base64.urlsafe_b64encode(mac).decode().rstrip("=")
    return {"x-liner-signature": sig, "x-liner-timestamp": ts, "x-liner-nonce": nonce}


UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "liner-desktop/0.2.12 Chrome/134.0.0.0 Electron/44.0.0 Safari/537.36")


def call(path, token):
    url = f"https://api.tryliner.fun{path}"
    req = urllib.request.Request(url, headers={
        "authorization": f"Bearer {token}",
        "accept": "application/json",
        "user-agent": UA,
        **sign("GET", path),
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(300)
            print(f"{path} -> {r.status} ct={r.headers.get('content-type','')[:30]}")
            print("  ", body[:220])
    except urllib.error.HTTPError as e:
        body = e.read(200)
        print(f"{path} -> HTTP {e.code} ct={e.headers.get('content-type','')[:30]}")
        print("  ", body[:200])
    except Exception as e:
        print(f"{path} -> transport: {type(e).__name__}: {str(e)[:120]}")


if __name__ == "__main__":
    tok = json.load(open("/tmp/login2.json"))["accessToken"]
    call("/v1/me", tok)                       # control (known working)
    call("/v1/users/jayzeyluna", tok)         # directory exact
    call("/v1/users/search?q=jayzeyluna", tok)  # directory search
    call("/v1/users/jayzeyluna/history?limit=3", tok)  # history
