#!/usr/bin/env python3
"""Deep-merge upstream v0.2.11 locale JSONs over the port's versions.

theirs (v0.2.11) wins for existing keys; port-only keys (downloads,
changelog, aiTranslate, local, moderation, ...) are preserved. Reported
differences only for transparency.
"""
import json, sys, os

BASE = "/tmp/lr10/src/languages/locales"
THEIRS = "/tmp/lr11/src/languages/locales"
OURS = "/home/z/my-project/liner-app/src/languages/locales"

def deep_merge(base, ours, theirs, path=""):
    """proper 3-way: port-intentional changes (ours!=base) win; upstream
    changes (theirs!=base) apply otherwise; port-only keys kept."""
    out = {}
    keys = sorted(set(ours) | set(theirs))
    for k in keys:
        p = f"{path}.{k}" if path else k
        o, t, b = ours.get(k), theirs.get(k), base.get(k)
        if isinstance(o, dict) and isinstance(t, dict):
            out[k] = deep_merge(b if isinstance(b, dict) else {}, o, t, p)
        elif isinstance(o, dict) and not isinstance(t, dict):
            # upstream flattened/renamed this subtree; the port still uses the
            # nested keys — keep ours, theirs' new key shape lands elsewhere
            out[k] = o
        elif o is not None and o != b and k in base:
            # port deliberately changed this value -> ours wins
            if t is not None and t != o:
                print(f"  ours-wins {p}: {t!r} -> {o!r}")
            out[k] = o
        elif k in theirs:
            if o is not None and o != t and not isinstance(o, dict):
                print(f"  theirs-wins {p}: {o!r} -> {t!r}")
            out[k] = t
        else:
            out[k] = o
    return out

for name in sorted(set(os.listdir(THEIRS)) | set(os.listdir(OURS))):
    if not name.endswith(".json"):
        continue
    with open(f"{THEIRS}/{name}", encoding="utf-8") as f:
        theirs = json.load(f)
    our_path = f"{OURS}/{name}"
    if not os.path.exists(our_path):
        with open(our_path, "w", encoding="utf-8") as f:
            json.dump(theirs, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"{name}: port lacked it, copied upstream")
        continue
    with open(our_path, encoding="utf-8") as f:
        ours = json.load(f)
    base = {}
    base_path = f"{BASE}/{name}"
    if os.path.exists(base_path):
        with open(base_path, encoding="utf-8") as f:
            base = json.load(f)
    print(f"== {name} ==")
    merged = deep_merge(base, ours, theirs)
    with open(our_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
print("done")
