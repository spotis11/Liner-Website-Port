#!/usr/bin/env python3
"""Prune removed fork features from locale files and restore upstream EQ keys.

- player.equalizer: dict (fork EqualizerModal keys, feature removed) -> string (upstream EqualizerPicker)
- player.equalizer_hint: ensure present in every locale
- common.sidebar.downloads / common.sidebar.local: removed tabs
- top-level "downloads" / "local" sections: fork-only, zero code usages left
"""
import json
import glob
import collections

EQ_LABEL = {
    "de": "Equalizer", "en": "Equalizer", "es": "Ecualizador", "fr": "Égaliseur",
    "id": "Equalizer", "it": "Equalizzatore", "pl": "Korektor", "pt": "Equalizador",
    "ru": "Эквалайзер", "tl": "Equalizer", "tr": "Ekolayzer", "uk": "Еквалайзер",
}
EQ_HINT = {
    "de": "Klang bandweise formen", "en": "Shape the sound band by band",
    "es": "Modela el sonido banda por banda", "fr": "Ajuster le son bande par bande",
    "id": "Bentuk suara per pita", "it": "Modella il suono banda per banda",
    "pl": "Modeluj dźwięk pasmo po pasmie", "pt": "Modele o som banda a banda",
    "ru": "Настройка звука по частотам", "tl": "Hulmahin ang tunog bawat banda",
    "tr": "Sesi bant bant şekillendir", "uk": "Формуйте звук за смугами",
}

for path in sorted(glob.glob("src/languages/locales/*.json")):
    lang = path.split("/")[-1].removesuffix(".json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)

    changed = []

    player = data.get("player")
    if isinstance(player, dict) and isinstance(player.get("equalizer"), dict):
        player["equalizer"] = EQ_LABEL.get(lang, EQ_LABEL["en"])
        changed.append("equalizer dict->string")
    if isinstance(player, dict) and not player.get("equalizer"):
        player["equalizer"] = EQ_LABEL.get(lang, EQ_LABEL["en"])
        changed.append("equalizer missing->string")
    if isinstance(player, dict) and not player.get("equalizer_hint"):
        player["equalizer_hint"] = EQ_HINT.get(lang, EQ_HINT["en"])
        changed.append("equalizer_hint added")

    common = data.get("common")
    if isinstance(common, dict):
        sidebar = common.get("sidebar")
        if isinstance(sidebar, dict):
            for k in ("downloads", "local"):
                if k in sidebar:
                    del sidebar[k]
                    changed.append(f"sidebar.{k}")

    for section in ("downloads", "local"):
        if section in data:
            del data[section]
            changed.append(f"top-level {section}")

    if not changed:
        continue
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{lang}: {', '.join(changed)}")

print("done")
