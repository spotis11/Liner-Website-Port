#!/usr/bin/env python3
"""Brute-force the exact sshsig signed-message construction by trying to
validate the KNOWN-GOOD upstream commit (signed by real ssh-keygen and
GitHub-verified). Once one combination validates there, the same combo is
the ground truth for checking our own commits."""
import base64
import hashlib
import re
import subprocess

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature


def raw_commit(sha):
    return subprocess.run(["git", "cat-file", "commit", sha],
                          capture_output=True, text=True, check=True).stdout


def strip_sig(obj):
    lines = obj.splitlines(keepends=True)
    out, in_sig = [], False
    for line in lines:
        if line.startswith("gpgsig"):
            in_sig = True
            continue
        if in_sig:
            if line.startswith((" ", "\t")):
                continue
            in_sig = False
        out.append(line)
    return "".join(out)


def parse(blob):
    o = 6
    ver, o = int.from_bytes(blob[o:o+4], "big"), o + 4
    def sstr(b, o):
        n = int.from_bytes(b[o:o+4], "big")
        return b[o+4:o+4+n], o + 4 + n
    pub, o = sstr(blob, o)
    ns, o = sstr(blob, o)
    res, o = sstr(blob, o)
    ha, o = sstr(blob, o)
    sig, o = sstr(blob, o)
    sigdata = sig[8 + 11:]  # skip string header + "ssh-ed25519" + its len
    header = blob[:o]
    return header, pub, ns, res, ha, sigdata


def try_verify(sha):
    blob = base64.b64decode("".join(re.search(
        r"BEGIN SSH SIGNATURE-----\n(.*?)-----END",
        raw_commit(sha), re.S).group(1).split()))
    header, pub, ns, res, ha, sigdata = parse(blob)
    key = Ed25519PublicKey.from_public_bytes(pub[-32:])
    obj = raw_commit(sha)

    payloads = {
        "stripped": strip_sig(obj).encode(),
        "stripped+nl": (strip_sig(obj).rstrip("\n") + "\n").encode(),
        "stripped-nonl": strip_sig(obj).rstrip("\n").encode(),
    }
    hashes = {"sha512": hashlib.sha512, "sha256": hashlib.sha256}

    for pname, payload in payloads.items():
        for hname, hf in hashes.items():
            H = hf(payload).digest()
            hb = len(H).to_bytes(4, "big") + H
            # spec section 3: signed data = MAGIC || string(namespace) ||
            # string(reserved) || string(hash_algorithm) || string(H)
            for fname, msg in (
                ("spec: no ver/pubkey, string(H)",
                 b"SSHSIG" + len(ns).to_bytes(4, "big") + ns
                 + len(res).to_bytes(4, "big") + res
                 + len(ha).to_bytes(4, "big") + ha + hb),
            ):
                try:
                    key.verify(sigdata, msg)
                    print(f"{sha[:8]} VALID: payload={pname} hash={hname} framing={fname}")
                    return
                except InvalidSignature:
                    pass
    print(f"{sha[:8]} still invalid")


try_verify("50e9cea2099ece3ea86de3c75bee0abcfdbe3d5a")
