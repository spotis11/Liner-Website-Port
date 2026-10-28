#!/usr/bin/env python3
"""Task 35: add the Settings -> Playback miniplayer toggle keys to every locale."""

import json
import os
import sys

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

TITLE = {
    "en": "Miniplayer", "es": "Minirreproductor", "fr": "Mini-lecteur",
    "de": "Mini-Player", "it": "Miniplayer", "pt": "Miniplayer",
    "ru": "Мини-плеер", "uk": "Мініплеєр", "tr": "Mini oynatıcı",
    "pl": "Miniodtwarzacz", "id": "Pemutar mini", "tl": "Miniplayer",
}
DESCRIPTION = {
    "en": "Open a mini player when you switch to another tab and close it as soon as you come back.",
    "es": "Abre un minirreproductor al cambiar a otra pestaña y ciérralo en cuanto vuelvas.",
    "fr": "Ouvre un mini-lecteur quand vous passez à un autre onglet et le ferme dès votre retour.",
    "de": "Öffnet einen Mini-Player beim Wechsel zu einem anderen Tab und schließt ihn, sobald du zurückkommst.",
    "it": "Apre un mini player quando passi a un'altra scheda e lo chiude appena torni indietro.",
    "pt": "Abre um mini player ao mudar para outra aba e fecha-o assim que você voltar.",
    "ru": "Открывает мини-плеер при переходе на другую вкладку и сразу закрывает его при возвращении.",
    "uk": "Відкриває мініплеєр під час переходу на іншу вкладку та одразу закриває його при поверненні.",
    "tr": "Başka bir sekmeye geçtiğinizde mini oynatıcıyı açar ve geri döner dönmez kapatır.",
    "pl": "Otwiera miniodtwarzacz po przejściu do innej karty i zamyka go od razu po powrocie.",
    "id": "Membuka pemutar mini saat berpindah ke tab lain dan menutupnya segera setelah kembali.",
    "tl": "Nagbubukas ng mini player kapag pumalit ka sa ibang tab at isinasara ito agad kapag bumalik ka.",
}


def main() -> int:
    changed = []
    for fname in sorted(os.listdir(LOCALES_DIR)):
        if not fname.endswith(".json"):
            continue
        code = fname[:-5]
        if code not in TITLE:
            print(f"skip unknown locale {fname}")
            continue
        path = os.path.join(LOCALES_DIR, fname)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)

        mini = data.setdefault("settings", {}).setdefault(
            "cross_tab_miniplayer", {}
        )

        touched = False
        if "title" not in mini:
            mini["title"] = TITLE[code]
            touched = True
        if "description" not in mini:
            mini["description"] = DESCRIPTION[code]
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
