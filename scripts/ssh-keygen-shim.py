#!/usr/bin/env python3
"""Minimal ssh-keygen replacement for git's SSH commit signing.

This sandbox has no OpenSSH binary, and git shells out to:
    ssh-keygen -Y sign -f <keyfile> -n <namespace> <file>
This shim implements exactly that (SSHSIG per OpenSSH PROTOCOL.sshsig),
writing the armored signature to stdout and to <file>.sig.

Verification (-Y verify) is intentionally unimplemented: the authoritative
verifier is GitHub itself, which holds the registered public signing key.
"""
import base64
import hashlib
import sys
import os

from cryptography.hazmat.primitives.serialization import (
    load_ssh_private_key,
    load_pem_private_key,
)


def load_private(path: str):
    with open(path, "rb") as f:
        data = f.read()
    try:
        return load_ssh_private_key(data, password=None)
    except ValueError:
        return load_pem_private_key(data, password=None)


def ssh_string(data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + data


def ed25519_public_blob(priv) -> bytes:
    raw = priv.public_key().public_bytes(
        __import__("cryptography").hazmat.primitives.serialization.Encoding.Raw,
        __import__("cryptography").hazmat.primitives.serialization.PublicFormat.Raw,
    )
    return ssh_string(b"ssh-ed25519") + ssh_string(raw)


def sign(namespace: str, file_path: str) -> None:
    keyfile = sys.argv[sys.argv.index("-f") + 1]
    priv = load_private(keyfile)

    with open(file_path, "rb") as f:
        payload = f.read()

    pub_blob = ed25519_public_blob(priv)
    hash_alg = b"sha512"          # OpenSSH sshsig default
    reserved = b""

    # PROTOCOL.sshsig section 3 — signed data (no version, no public key):
    #   "SSHSIG" || string(namespace) || string(reserved)
    #            || string(hash_algorithm) || string(H(contents))
    # The stored blob (section 2) carries the header fields + the signature;
    # verifiers recompute H themselves.
    H = hashlib.sha512(payload).digest()
    msg = (b"SSHSIG" + ssh_string(namespace.encode()) + ssh_string(reserved)
           + ssh_string(hash_alg) + ssh_string(H))
    sig = priv.sign(msg)

    blob = (b"SSHSIG" + (1).to_bytes(4, "big") + ssh_string(pub_blob)
            + ssh_string(namespace.encode()) + ssh_string(reserved)
            + ssh_string(hash_alg)
            + ssh_string(ssh_string(b"ssh-ed25519") + ssh_string(sig)))

    armor = "-----BEGIN SSH SIGNATURE-----\n" \
        + base64.b64encode(blob).decode() \
        + "\n-----END SSH SIGNATURE-----\n"
    sys.stdout.write(armor)
    with open(file_path + ".sig", "w") as f:
        f.write(armor)


def main() -> int:
    argv = sys.argv[1:]
    if "-Y" in argv and argv[argv.index("-Y") + 1] == "sign":
        namespace = argv[argv.index("-n") + 1]
        file_path = argv[-1]
        sign(namespace, file_path)
        return 0
    sys.stderr.write("shim supports only: -Y sign -f <key> -n <ns> <file>\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
