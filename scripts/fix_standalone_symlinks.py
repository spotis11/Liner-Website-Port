#!/usr/bin/env python3
"""Replace all symlinks inside .next/standalone with real copies.

Why: the platform packages the standalone into a tar and extracts it at
container boot over whatever stale state exists in the function image.
Symlink-vs-dir type conflicts across deploy versions trigger GNU tar's
"Directory renamed before its status could be extracted" cascade, which
kills the boot (start.sh runs with set -e). Real dirs/files are immune.
"""
import os, shutil

ROOT = "/home/z/my-project/.next/standalone"

def collect_links(root):
    links = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            p = os.path.join(dirpath, name)
            if os.path.islink(p):
                links.append(p)
    return links

def main():
    links = collect_links(ROOT)
    if not links:
        print("no symlinks found — already clean")
        return
    for p in links:
        target = os.path.realpath(p)
        if not os.path.exists(target):
            print(f"SKIP dangling: {p} -> {target}")
            continue
        tmp = p + ".real"
        if os.path.exists(tmp):
            shutil.rmtree(tmp, ignore_errors=True)
        if os.path.isdir(target):
            shutil.copytree(target, tmp, symlinks=False)
        else:
            shutil.copy2(target, tmp)
        os.remove(p)
        os.rename(tmp, p)
        print(f"DEREFERENCED: {p} (was -> {os.readlink(p) if os.path.islink(p) else target})")
    remaining = collect_links(ROOT)
    print(f"remaining symlinks: {len(remaining)}")

if __name__ == "__main__":
    main()
