"""3-way locale merge for the redesign: base = upstream 0.2.12 wording (the
redesign side), overlay = keys that exist ONLY in our website fork (announcements,
userfinder, pro, ui_style, changelog, discord-tab additions...). Where both
sides define a key, upstream wins (their redesign rewrote the wording); our
website-only branches survive untouched. Reports per-file counts.
"""

import json
import subprocess
import sys

FILES = [
    "en", "ru", "fr", "pt", "es", "pl", "it", "de", "id", "tr", "uk",
]
PATH = "liner-app/src/languages/locales/{}.json"


def show(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


def merge(theirs, ours):
    """theirs wins on conflicts; ours-only branches are carried over."""
    if isinstance(theirs, dict) and isinstance(ours, dict):
        out = dict(theirs)
        for k, v in ours.items():
            if k not in theirs:
                out[k] = v
            elif isinstance(theirs[k], dict) and isinstance(v, dict):
                out[k] = merge(theirs[k], v)
            # else: keep theirs
        return out
    return theirs


total_added = 0
for loc in FILES:
    path = PATH.format(loc)
    theirs = show("upstream-0212", path)
    ours = show("86f528e7", path)
    assert theirs is not None and ours is not None, path

    def count_added(theirs, ours):
        n = 0
        if isinstance(theirs, dict) and isinstance(ours, dict):
            for k, v in ours.items():
                if k not in theirs:
                    n += 1
                elif isinstance(theirs[k], dict) and isinstance(v, dict):
                    n += count_added(theirs[k], v)
        return n

    added = count_added(theirs, ours)
    merged = merge(theirs, ours)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{loc}: carried over {added} website-only keys")
    total_added += added

# sanity: website-critical keys present in every locale
for loc in FILES:
    data = json.load(open(PATH.format(loc), encoding="utf-8"))
    settings = data.get("settings", {})
    missing = [k for k in ("ui_style_title", "ui_style_refresh_body") if k not in settings.get("appearance", {})]
    if missing:
        print(f"  WARN {loc}: missing {missing}")
print(f"TOTAL website-only keys carried: {total_added}")
