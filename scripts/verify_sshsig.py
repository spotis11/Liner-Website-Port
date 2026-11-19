#!/usr/bin/env python3
"""Independent SSHSIG verifier for git commits.

Method: strip the gpgsig header from the commit object to get the signed
payload, reconstruct OpenSSH's signed message from the signature blob's
fields, and verify the ed25519 signature with the key embedded in the blob.

First run it on upstream commit 50e9cea2 (signed by real ssh-keygen,
verified on GitHub) to pin down the exact framing git/OpenSSH use, then
on our own commits. Prints the verdict per commit.
"""
import base64
import hashlib
import re
import subprocess
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature


def commit_payload(sha: str) -> str:
    obj = subprocess.run(["git", "cat-file", "commit", sha],
                         capture_output=True, text=True, check=True).stdout
    lines = obj.splitlines(keepends=True)
    out, in_sig = [], False
    for line in lines:
        if line.startswith("gpgsig"):
            in_sig = True
            continue
        if in_sig:
            if line.startswith(" ") or line.startswith("\t"):
                continue
            in_sig = False
        out.append(line)
    return "".join(out)


def get_blob(sha: str) -> bytes:
    obj = subprocess.run(["git", "cat-file", "commit", sha],
                         capture_output=True, text=True, check=True).stdout
    m = re.search(r"-----BEGIN SSH SIGNATURE-----\n(.*?)-----END SSH SIGNATURE-----",
                  obj, re.S)
    return base64.b64decode("".join(m.group(1).split()))


def u32(b, o):
    return int.from_bytes(b[o:o+4], "big"), o + 4


def sstr(b, o):
    n, o = u32(b, o)
    return b[o:o+n], o + n


def verify(sha: str) -> None:
    blob = get_blob(sha)
    o = 6
    ver, o = u32(blob, o)
    pub, o = sstr(blob, o)
    ns, o = sstr(blob, o)
    res, o = sstr(blob, o)
    ha, o = sstr(blob, o)
    sig, o = sstr(blob, o)
    algo, s2 = sstr(sig, 0)
    sigdata, s3 = sstr(sig, s2)

    payload = commit_payload(sha).encode()
    H = hashlib.sha512(payload).digest() if ha == b"sha512" \
        else hashlib.sha256(payload).digest()

    header = blob[:o]  # magic..hash_algorithm, before the signature string
    pub_key = Ed25519PublicKey.from_public_bytes(pub[-32:])  # last 32 bytes = raw key

    # PROTOCOL.sshsig section 3: signed data has NO version/pubkey
    ns_b, res_b = ns, res
    msg = (b"SSHSIG" + sstr_bytes(ns_b) + sstr_bytes(res_b)
           + sstr_bytes(ha) + sstr_bytes(H))
    verdict = "INVALID"
    for label, msg in (("spec", msg),):
        try:
            pub_key.verify(sigdata, msg)
            verdict = f"VALID  (framing: {label.strip()})"
            break
        except InvalidSignature:
            pass
    print(f"{sha[:8]}  {verdict}")


def sstr_bytes(b: bytes) -> bytes:
    return len(b).to_bytes(4, "big") + b


if __name__ == "__main__":
    for sha in sys.argv[1:]:
        verify(sha)
