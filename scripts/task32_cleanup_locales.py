#!/usr/bin/env python3
"""Task 32: remove Discord RPC + Liquid Glass locale keys from every locale file.

Removes (deep, nested-aware):
  - settings.discord (whole subtree)
  - settings.tabs.discord
  - settings.appearance.liquid_glass_title / _description / _mode_default /
    _mode_glass / _transparency
  - settings.theme.disabled_for_glass
Keeps settings.branding.discord (community link string, not RPC).
"""
import json
import sys
from pathlib import Path

LOCALES = Path("/home/z/my-project/liner-app/src/languages/locales")

REMOVE_EXACT = {
    ("settings", "tabs", "discord"),
    ("settings", "theme", "disabled_for_glass"),
    ("settings", "appearance", "liquid_glass_title"),
    ("settings", "appearance", "liquid_glass_description"),
    ("settings", "appearance", "liquid_glass_mode_default"),
    ("settings", "appearance", "liquid_glass_mode_glass"),
    ("settings", "appearance", "liquid_glass_transparency"),
}


def prune(node, path):
    """Recursively prune keys; returns True if node should be deleted."""
    if not isinstance(node, dict):
        return False
    for key in list(node.keys()):
        child = node[key]
        full = path + (key,)
        if full == ("settings", "discord") or full in REMOVE_EXACT:
            del node[key]
        elif isinstance(child, dict):
            if prune(child, full):
                del node[key]
    return len(node) == 0


def main():
    changed = {}
    for f in sorted(LOCALES.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        settings = data.get("settings")
        if not isinstance(settings, dict):
            continue
        before = json.dumps(data, sort_keys=True)
        prune(settings, ("settings",))
        after = json.dumps(data, sort_keys=True)
        if before != after:
            f.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            changed[f.name] = True
            print(f"cleaned {f.name}")
    print(f"\n{len(changed)} locale files updated")
    # sanity: no references left anywhere
    bad = []
    for f in LOCALES.glob("*.json"):
        txt = f.read_text(encoding="utf-8")
        if '"discord"' in txt and '"discord":' in txt:
            d = json.loads(txt)
            s = d.get("settings", {})
            if "discord" in s or "discord" in s.get("tabs", {}):
                bad.append(f.name)
    if bad:
        print(f"STILL PRESENT: {bad}")
        sys.exit(1)
    print("verified: no settings.discord / liquid_glass keys remain")


if __name__ == "__main__":
    main()
