#!/usr/bin/env python3
"""Generate an ed25519 SSH signing keypair in OpenSSH format (ssh-keygen
isn't installed in this sandbox; cryptography writes the same on-disk format).

Outputs (never printed): /home/z/my-project/.secrets/claude_signing_ed25519
Prints: public key + SHA256 fingerprint (GitHub UI format) only.
"""
import os
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization, hashes

PRIV = "/home/z/my-project/.secrets/claude_signing_ed25519"
PUB = PRIV + ".pub"

key = Ed25519PrivateKey.generate()

priv_pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.OpenSSH,
    serialization.NoEncryption(),
)
pub_line = key.public_key().public_bytes(
    serialization.Encoding.OpenSSH,
    serialization.PublicFormat.OpenSSH,
).decode() + " claude\n"

os.makedirs(os.path.dirname(PRIV), exist_ok=True)
with open(PRIV, "wb") as f:
    f.write(priv_pem)
os.chmod(PRIV, 0o600)
with open(PUB, "w") as f:
    f.write(pub_line)
os.chmod(PUB, 0o644)

# fingerprint in GitHub's format: SHA256:base64 (no trailing padding)
key_type, b64, _ = pub_line.split()
digest = hashes.Hash(hashes.SHA256())
digest.update(bytes.fromhex(key.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()))
fpr = digest.finalize().hex()
import base64
print("fingerprint: SHA256:" + base64.b64encode(bytes.fromhex(fpr)).decode().rstrip("="))
print("public key :", b64[:20] + "...")
