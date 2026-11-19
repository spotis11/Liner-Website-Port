#!/usr/bin/env python3
"""Structurally compare my SSHSIG blob vs the known-good one from upstream
commit 50e9cea2 (GitHub-verified). Walks the wire format field by field."""
import base64
import re
import subprocess
import sys

def get_sig(sha):
    obj = subprocess.run(["git", "cat-file", "commit", sha],
                         capture_output=True, text=True, check=True).stdout
    m = re.search(r"gpgsig(?:-1)? -----BEGIN SSH SIGNATURE-----\n(.*?)-----END SSH SIGNATURE-----",
                  obj, re.S)
    if not m:
        sys.exit(f"no sshsig in {sha[:8]}")
    return base64.b64decode("".join(m.group(1).split()))

def u32(b, o):
    return int.from_bytes(b[o:o+4], "big"), o + 4

def sstr(b, o):
    n, o = u32(b, o)
    return b[o:o+n], o + n

def walk(b, label):
    print(f"== {label} (total {len(b)} bytes)")
    print("magic:", b[:6])
    ver, o = u32(b, 6)
    print("version:", ver)
    pub, o = sstr(b, o)
    algo, p2 = sstr(pub, 0)
    keydata, p3 = sstr(pub, p2)
    print(f"pubkey algo: {algo.decode()} | keydata {len(keydata)} bytes")
    ns, o = sstr(b, o)
    print("namespace:", ns.decode())
    res, o = sstr(b, o)
    print("reserved:", len(res), "bytes")
    ha, o = sstr(b, o)
    print("hash_algorithm:", ha.decode())
    sig, o = sstr(b, o)
    sig_algo, s2 = sstr(sig, 0)
    sig_data, s3 = sstr(sig, s2)
    print(f"sig algo: {sig_algo.decode()} | sig data {len(sig_data)} bytes")
    print("trailing bytes:", len(b) - o)

walk(get_sig("50e9cea2099ece3ea86de3c75bee0abcfdbe3d5a"), "UPSTREAM (verified)")
walk(get_sig("HEAD"), "MINE")
