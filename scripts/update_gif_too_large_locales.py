#!/usr/bin/env python3
"""Update settings.profile.avatar_gif_too_large in all 12 locale JSONs.

New copy: the oversized-animated-GIF error now points at the Liner Pro perk
(animated avatars up to 30 MB) instead of only quoting the ~290 KB cap.
"""
import json
import re
from pathlib import Path

LOCALES = Path("/home/z/my-project/liner-app/src/languages/locales")

TEXTS = {
    "de": "Dieses animierte GIF ist zu gro\u00df. Liner Pro erm\u00f6glicht animierte Avatare bis 30 MB.",
    "en": "This animated GIF is too large. Liner Pro unlocks animated avatars up to 30 MB.",
    "es": "Este GIF animado es demasiado grande. Liner Pro permite avatares animados de hasta 30 MB.",
    "fr": "Ce GIF anim\u00e9 est trop lourd. Liner Pro permet des avatars anim\u00e9s jusqu\u2019\u00e0 30 Mo.",
    "id": "GIF animasi ini terlalu besar. Liner Pro membuka avatar animasi hingga 30 MB.",
    "it": "Questo GIF animato \u00e8 troppo grande. Liner Pro consente avatar animati fino a 30 MB.",
    "pl": "Ten animowany GIF jest za du\u017cy. Liner Pro odblokowuje animowane awatary do 30 MB.",
    "pt": "Este GIF animado \u00e9 grande demais. O Liner Pro libera avatares animados de at\u00e9 30 MB.",
    "ru": "\u042d\u0442\u043e\u0442 \u0430\u043d\u0438\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 GIF \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0432\u0435\u043b\u0438\u043a. Liner Pro \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u0430\u043d\u0438\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0435 \u0430\u0432\u0430\u0442\u0430\u0440\u044b \u0434\u043e 30 \u041c\u0411.",
    "tl": "Masyadong malaki ang animated GIF na ito. Binubuksan ng Liner Pro ang mga animated avatar hanggang 30 MB.",
    "tr": "Bu animasyonlu GIF \u00e7ok b\u00fcy\u00fck. Liner Pro, 30 MB'a kadar animasyonlu avatarlar\u0131 a\u00e7ar.",
    "uk": "\u0426\u0435 \u0430\u043d\u0456\u043c\u043e\u0432\u0430\u043d\u0435 GIF \u0437\u0430\u0432\u0435\u043b\u0438\u043a\u0435. Liner Pro \u0432\u0456\u0434\u043a\u0440\u0438\u0432\u0430\u0454 \u0430\u043d\u0456\u043c\u043e\u0432\u0430\u043d\u0456 \u0430\u0432\u0430\u0442\u0430\u0440\u0438 \u0434\u043e 30 \u041c\u0411.",
}

for code, text in TEXTS.items():
    path = LOCALES / f"{code}.json"
    raw = path.read_text(encoding="utf-8")
    m = re.search(r'([ \t]*"avatar_gif_too_large":\s*)"[^"]*"', raw)
    if not m:
        print(f"{code}: KEY MISSING — unexpected"); continue
    raw = raw[: m.start()] + m.group(1) + json.dumps(text, ensure_ascii=False) + raw[m.end():]
    json.loads(raw)  # must still parse
    path.write_text(raw, encoding="utf-8")
    print(f"{code}: updated")

print("done")
