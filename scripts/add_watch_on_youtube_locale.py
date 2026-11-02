#!/usr/bin/env python3
"""Insert player.watch_on_youtube next to player.video_unavailable in every locale."""
import glob
import json
import re

TRANSLATIONS = {
    "en": "Watch on YouTube",
    "de": "Auf YouTube ansehen",
    "es": "Ver en YouTube",
    "fr": "Regarder sur YouTube",
    "id": "Tonton di YouTube",
    "it": "Guarda su YouTube",
    "pl": "Obejrzyj na YouTube",
    "pt": "Assistir no YouTube",
    "ru": "Смотреть на YouTube",
    "tl": "Manood sa YouTube",
    "tr": "YouTube'da izle",
    "uk": "Дивитися на YouTube",
}

PATTERN = re.compile(
    r'^(?P<indent>\s*)"video_unavailable":\s*"(?P<value>(?:[^"\\]|\\.)*)"(?P<comma>,?)[ \t]*$',
    re.MULTILINE,
)

for path in sorted(glob.glob("/home/z/my-project/liner-app/src/languages/locales/*.json")):
    lang = path.rsplit("/", 1)[-1][:-5]
    text = open(path, encoding="utf-8").read()
    if "watch_on_youtube" in text:
        print(f"{lang}: already present")
        continue
    translation = TRANSLATIONS[lang]
    match = PATTERN.search(text)
    if not match:
        print(f"{lang}: NO video_unavailable key found!")
        continue
    original = match.group(0)
    indent = match.group("indent")
    if match.group("comma"):
        # mid-section key: original keeps its comma, new key gets one too
        replacement = f'{original}\n{indent}"watch_on_youtube": "{translation}",'
    else:
        # section's last key: hand the no-comma role to the new key
        replacement = f'{original},\n{indent}"watch_on_youtube": "{translation}"'
    text = text.replace(original, replacement, 1)
    open(path, "w", encoding="utf-8").write(text)
    json.load(open(path, encoding="utf-8"))  # validate JSON
    print(f"{lang}: ok -> {translation}")
