#!/usr/bin/env python3
"""Add the guest-mode login keys to every locale (en/fr/ru localized)."""
import json
import glob
import collections

KEYS = {
    "en": {
        "or": "or",
        "btn_guest": "Continue as guest",
        "guest_hint": "No email or password needed — a private guest account is created on this site and kept for next time.",
    },
    "fr": {
        "or": "ou",
        "btn_guest": "Continuer en invité",
        "guest_hint": "Sans e-mail ni mot de passe — un compte invité privé est créé sur ce site et conservé pour votre prochaine visite.",
    },
    "ru": {
        "or": "или",
        "btn_guest": "Войти как гость",
        "guest_hint": "Без почты и пароля — на сайте создаётся приватный гостевой аккаунт, который сохранится для следующих входов.",
    },
}

EN = KEYS["en"]

for path in sorted(glob.glob("src/languages/locales/*.json")):
    lang = path.split("/")[-1].removesuffix(".json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)
    login = data.setdefault("login", collections.OrderedDict())
    source = KEYS.get(lang, EN)
    changed = []
    for key, value in source.items():
        if key not in login:
            login[key] = value
            changed.append(key)
    if not changed:
        continue
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{lang}: +{', '.join(changed)}")
print("done")
