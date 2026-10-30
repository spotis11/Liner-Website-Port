#!/usr/bin/env python3
"""Add player.song / player.video / player.video_unavailable keys to every locale."""
import json
import pathlib

TRANSLATIONS = {
    "en": ("Song", "Video", "Video unavailable"),
    "de": ("Titel", "Video", "Video nicht verfügbar"),
    "es": ("Canción", "Vídeo", "Vídeo no disponible"),
    "fr": ("Titre", "Vidéo", "Vidéo indisponible"),
    "id": ("Lagu", "Video", "Video tidak tersedia"),
    "it": ("Brano", "Video", "Video non disponibile"),
    "pl": ("Utwór", "Wideo", "Wideo niedostępne"),
    "pt": ("Música", "Vídeo", "Vídeo indisponível"),
    "ru": ("Трек", "Видео", "Видео недоступно"),
    "tl": ("Kanta", "Video", "Hindi available ang video"),
    "tr": ("Şarkı", "Video", "Video kullanılamıyor"),
    "uk": ("Трек", "Відео", "Відео недоступне"),
}

LOCALES = pathlib.Path("/home/z/my-project/liner-app/src/languages/locales")

for locale, (song, video, unavailable) in TRANSLATIONS.items():
    path = LOCALES / f"{locale}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    player = data.setdefault("player", {})
    changed = False
    for key, value in (
        ("song", song),
        ("video", video),
        ("video_unavailable", unavailable),
    ):
        if player.get(key) != value:
            player[key] = value
            changed = True
    if changed:
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        path.write_text(text, encoding="utf-8")
        print(f"{locale}: updated")
    else:
        print(f"{locale}: already ok")
