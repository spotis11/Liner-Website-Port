#!/usr/bin/env python3
"""Prune Local Music locale keys from every liner-app locale file.

Removes (feature fully excised from the app):
  - library.local              (whole subtree)
  - settings.storage.categories.local
  - settings.storage.local_desc / local_empty
  - settings.storage.local_confirm_button / _desc / _title
  - settings.storage.removed_local_subtitle
  - settings.storage.removing_local_title
Keeps settings.cache.local_cache (web-cache error copy, unrelated).
"""
import json
import sys
from pathlib import Path

LOCALES = Path("/home/z/my-project/liner-app/src/languages/locales")

STORAGE_LOCAL_KEYS = [
    "local_desc",
    "local_empty",
    "local_confirm_button",
    "local_confirm_desc",
    "local_confirm_title",
    "removed_local_subtitle",
    "removing_local_title",
]


def prune(node, path=()):
    removed = []
    if isinstance(node, dict):
        for key in list(node):
            p = path + (key,)
            joined = ".".join(p)
            if joined == "library.local":
                del node[key]
                removed.append(joined)
            elif len(p) == 3 and p[:2] == ("settings", "storage") and key in (
                ["categories"] + STORAGE_LOCAL_KEYS
            ):
                if key == "categories":
                    # drop only the "local" child inside categories
                    if isinstance(node[key], dict) and "local" in node[key]:
                        del node[key]["local"]
                        removed.append(joined + ".local")
                else:
                    del node[key]
                    removed.append(joined)
            else:
                removed += prune(node[key], p)
    return removed


def main():
    total_removed = []
    for f in sorted(LOCALES.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        removed = prune(data)
        if removed:
            f.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            total_removed += [(f.name, r) for r in removed]
    for name, key in total_removed:
        print(f"  {name}: -{key}")
    print(f"done: {len(total_removed)} keys removed across locales")


if __name__ == "__main__":
    sys.exit(main())
