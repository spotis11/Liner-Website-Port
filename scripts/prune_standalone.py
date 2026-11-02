#!/usr/bin/env python3
"""Post-build prune of .next/standalone (deployment size guard).

Why this exists: the Aliyun FC deploy rejects packages over ~100MB. The
workspace (skills/, docs/, scripts/, liner-app/...) and the unused Prisma
wasm engines keep getting swept back into .next/standalone whenever
`bun install` restores node_modules — outputFileTracingExcludes in
next.config.ts has proven unreliable across builds (it held in some builds
and not in others). This script is the deterministic last line of defense:
run after every `next build`, BEFORE build.sh packs the tarball.

Everything removed here is dead weight at FC runtime:
  - workspace dirs that only exist for development (skills/docs/scripts/
    liner-app/upload/download/discord-bot/mini-services/examples/agent-ctx)
  - @prisma/client/runtime/*wasm-base64.* — engines for postgres/mysql/
    mssql/cockroachdb/sqlite-as-wasm; the site uses the native sqlite
    library engine (libquery_engine-*.so.node), which is kept
  - node_modules/.prisma/client/query_engine_bg.wasm (edge wasm engine)
  - lockfiles / logs that NFT copied to the standalone root

The script is idempotent, never fails the build (best-effort, like the
other packaging steps), and prints what it freed.
"""
import glob
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STANDALONE = os.path.join(ROOT, ".next", "standalone")

# Workspace directories that must never ship to FC.
WORKSPACE_DIRS = [
    "skills", "docs", "scripts", "liner-app", "upload", "download",
    "discord-bot", "mini-services", "examples", "agent-ctx", "liner-ref",
]

# Root-level junk NFT sometimes copies into the standalone dir.
ROOT_JUNK = [
    "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "dev.log", "server.log", "next.config.ts.zbak", "nohup.out",
]

KEEP = (".next", "node_modules", "public", "db", ".env", "server.js",
        "package.json", "LICENSE", "README.md")


def du(path: str) -> int:
    total = 0
    for base, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return total


def rm(path: str, freed: list) -> None:
    if not os.path.lexists(path):
        return
    try:
        size = du(path) if os.path.isdir(path) and not os.path.islink(path) else os.lstat(path).st_size
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        freed.append((path, size))
    except OSError as err:
        print(f"[prune] warn: could not remove {path}: {err}", file=sys.stderr)


def main() -> None:
    if not os.path.isdir(STANDALONE):
        print(f"[prune] {STANDALONE} not found — nothing to do")
        return

    freed: list = []

    # 1. workspace dirs swept in by the tracer
    for name in WORKSPACE_DIRS:
        rm(os.path.join(STANDALONE, name), freed)

    # 2. root junk
    for name in ROOT_JUNK:
        rm(os.path.join(STANDALONE, name), freed)

    # 3. unused prisma wasm engines (native sqlite engine is kept)
    for pattern in (
        os.path.join(STANDALONE, "node_modules", "@prisma", "client", "runtime", "*wasm-base64.*"),
        os.path.join(STANDALONE, "node_modules", ".prisma", "client", "query_engine_bg*.wasm*"),
    ):
        for path in glob.glob(pattern):
            rm(path, freed)

    # 4. native engines: keep ONLY the debian-openssl-3.0.x one (FC runtime),
    #    drop other platforms (darwin, musl, rhel, intel/arm variants)
    for path in glob.glob(os.path.join(
            STANDALONE, "node_modules", ".prisma", "client", "libquery_engine-*")):
        if "debian-openssl-3.0.x" not in os.path.basename(path):
            rm(path, freed)
    for path in glob.glob(os.path.join(
            STANDALONE, "node_modules", "@prisma", "client", "runtime", "libquery_engine-*")):
        if "debian-openssl-3.0.x" not in os.path.basename(path):
            rm(path, freed)

    total = sum(size for _p, size in freed)
    mb = total / (1024 * 1024)
    print(f"[prune] removed {len(freed)} item(s), freed {mb:.1f} MB (uncompressed)")
    if os.environ.get("PRUNE_VERBOSE"):
        for path, size in sorted(freed, key=lambda x: -x[1])[:25]:
            print(f"[prune]   {size / (1024 * 1024):7.1f} MB  {os.path.relpath(path, STANDALONE)}")


if __name__ == "__main__":
    main()
