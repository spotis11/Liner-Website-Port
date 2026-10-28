#!/usr/bin/env python3
"""Task 33: add sidebar Profile + miniplayer keys to every locale."""

import json
import os
import sys

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

PROFILE = {
    "en": "Profile", "es": "Perfil", "fr": "Profil", "de": "Profil",
    "it": "Profilo", "pt": "Perfil", "ru": "Профиль", "uk": "Профіль",
    "tr": "Profil", "pl": "Profil", "id": "Profil", "tl": "Profile",
}
MINIPLAYER = {
    "en": "Miniplayer", "es": "Minirreproductor", "fr": "Mini-lecteur",
    "de": "Miniplayer", "it": "Miniplayer", "pt": "Miniplayer",
    "ru": "Мини-плеер", "uk": "Мініплеєр", "tr": "Mini oynatıcı",
    "pl": "Miniodtwarzacz", "id": "Pemutar mini", "tl": "Miniplayer",
}
CLOSE_MINIPLAYER = {
    "en": "Close miniplayer", "es": "Cerrar minirreproductor",
    "fr": "Fermer le mini-lecteur", "de": "Miniplayer schließen",
    "it": "Chiudi miniplayer", "pt": "Fechar miniplayer",
    "ru": "Закрыть мини-плеер", "uk": "Закрити мініплеєр",
    "tr": "Mini oynatıcıyı kapat", "pl": "Zamknij miniodtwarzacz",
    "id": "Tutup pemutar mini", "tl": "Isara ang miniplayer",
}

def main() -> int:
    changed = []
    for fname in sorted(os.listdir(LOCALES_DIR)):
        if not fname.endswith(".json"):
            continue
        code = fname[:-5]
        if code not in PROFILE:
            print(f"skip unknown locale {fname}")
            continue
        path = os.path.join(LOCALES_DIR, fname)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)

        sidebar = data.setdefault("common", {}).setdefault("sidebar", {})
        player = data.setdefault("player", {})

        touched = False
        if "profile" not in sidebar:
            sidebar["profile"] = PROFILE[code]
            touched = True
        for key, table in (("miniplayer", MINIPLAYER), ("close_miniplayer", CLOSE_MINIPLAYER)):
            if key not in player:
                player[key] = table[code]
                touched = True

        if touched:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
            changed.append(code)

    print("updated:", ", ".join(changed) if changed else "(none)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
