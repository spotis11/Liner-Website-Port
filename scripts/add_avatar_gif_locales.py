#!/usr/bin/env python3
"""Insert settings.profile.avatar_gif_too_large into all 12 locale JSONs.

Regex-inserts one key after "avatar_failed" so surrounding formatting is
touched as little as possible (json.dump would reflow whole files).
"""
import json
import re
from pathlib import Path

LOCALES = Path("/home/z/my-project/liner-app/src/languages/locales")

TEXTS = {
    "de": "Dieses animierte GIF ist zu gro\u00df, um die Animation zu erhalten. Bitte w\u00e4hle eines unter 290 KB.",
    "en": "This animated GIF is too large to keep it moving. Please choose one under 290 KB.",
    "es": "Este GIF animado es demasiado grande para conservar la animaci\u00f3n. Elige uno de menos de 290 KB.",
    "fr": "Ce GIF anim\u00e9 est trop lourd pour conserver son animation. Choisissez-en un de moins de 290 Ko.",
    "id": "GIF animasi ini terlalu besar untuk mempertahankan animasinya. Pilih yang di bawah 290 KB.",
    "it": "Questo GIF animato \u00e8 troppo grande per mantenere l\u2019animazione. Scegline uno sotto i 290 KB.",
    "pl": "Ten animowany GIF jest za du\u017cy, aby zachowa\u0107 animacj\u0119. Wybierz jeden poni\u017cej 290 KB.",
    "pt": "Este GIF animado \u00e9 grande demais para manter a anima\u00e7\u00e3o. Escolha um com menos de 290 KB.",
    "ru": "\u042d\u0442\u043e\u0442 \u0430\u043d\u0438\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 GIF \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0432\u0435\u043b\u0438\u043a \u0434\u043b\u044f \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f \u0430\u043d\u0438\u043c\u0430\u0446\u0438\u0438. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0430\u0439\u043b \u043c\u0435\u043d\u044c\u0448\u0435 290 \u041a\u0411.",
    "tl": "Masyadong malaki ang animated GIF na ito para mapanatili ang animation. Pumili ng laging mas maliit kaysa 290 KB.",
    "tr": "Bu animasyonlu GIF, animasyonu korumak i\u00e7in \u00e7ok b\u00fcy\u00fck. L\u00fctfen 290 KB alt\u0131nda bir tane se\u00e7in.",
    "uk": "\u0426\u0435 \u0430\u043d\u0456\u043c\u043e\u0432\u0430\u043d\u0435 GIF \u043d\u0430\u0434\u0442\u043e \u0432\u0435\u043b\u0438\u043a\u0435, \u0449\u043e\u0431 \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0430\u043d\u0456\u043c\u0430\u0446\u0456\u044e. \u0412\u0438\u0431\u0435\u0440\u0456\u0442\u044c \u0444\u0430\u0439\u043b \u043c\u0435\u043d\u0448\u0435 290 \u041a\u0411.",
}

for code, text in TEXTS.items():
    path = LOCALES / f"{code}.json"
    raw = path.read_text(encoding="utf-8")
    if "avatar_gif_too_large" in raw:
        print(f"{code}: already present, skipped")
        continue
    # sanity: the JSON must parse and contain the sibling key
    data = json.loads(raw)
    assert "avatar_failed" in data["settings"]["profile"], code
    m = re.search(r'([ \t]+)"avatar_failed":\s*"[^"]*",\n', raw)
    assert m, f"{code}: avatar_failed line not found"
    indent = m.group(1)
    insertion = f'{indent}"avatar_gif_too_large": {json.dumps(text, ensure_ascii=False)},\n'
    raw = raw[: m.end()] + insertion + raw[m.end() :]
    json.loads(raw)  # must still parse
    path.write_text(raw, encoding="utf-8")
    print(f"{code}: inserted")

print("done")
