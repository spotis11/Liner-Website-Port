#!/usr/bin/env python3
"""Task 39: add User Finder upstream-profile keys to all 12 locales."""
import json
import os

LOCALES_DIR = "liner-app/src/languages/locales"

TRANSLATIONS = {
    "en": {
        "followers": "Followers",
        "follow_stats": "{followers} followers \u00b7 {following} following",
        "source_live": "Live from Liner",
        "source_cache": "From website cache",
    },
    "de": {
        "followers": "Follower",
        "follow_stats": "{followers} Follower \u00b7 {following} folgt",
        "source_live": "Live von Liner",
        "source_cache": "Aus dem Website-Cache",
    },
    "es": {
        "followers": "Seguidores",
        "follow_stats": "{followers} seguidores \u00b7 {following} siguiendo",
        "source_live": "En vivo desde Liner",
        "source_cache": "De la cach\u00e9 del sitio",
    },
    "fr": {
        "followers": "Abonn\u00e9s",
        "follow_stats": "{followers} abonn\u00e9s \u00b7 {following} abonnements",
        "source_live": "En direct depuis Liner",
        "source_cache": "Du cache du site",
    },
    "id": {
        "followers": "Pengikut",
        "follow_stats": "{followers} pengikut \u00b7 {following} mengikuti",
        "source_live": "Langsung dari Liner",
        "source_cache": "Dari cache situs",
    },
    "it": {
        "followers": "Follower",
        "follow_stats": "{followers} follower \u00b7 {following} seguiti",
        "source_live": "In diretta da Liner",
        "source_cache": "Dalla cache del sito",
    },
    "pl": {
        "followers": "Obserwuj\u0105cy",
        "follow_stats": "{followers} obserwuj\u0105cych \u00b7 {following} obserwowanych",
        "source_live": "Na \u017cywo z Liner",
        "source_cache": "Z pami\u0119ci podr\u0119cznej witryny",
    },
    "pt": {
        "followers": "Seguidores",
        "follow_stats": "{followers} seguidores \u00b7 {following} seguindo",
        "source_live": "Ao vivo do Liner",
        "source_cache": "Do cache do site",
    },
    "ru": {
        "followers": "\u041f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u0438",
        "follow_stats": "{followers} \u043f\u043e\u0434\u043f\u0438\u0441\u0447\u0438\u043a\u043e\u0432 \u00b7 {following} \u043f\u043e\u0434\u043f\u0438\u0441\u043e\u043a",
        "source_live": "\u041d\u0430\u043f\u0440\u044f\u043c\u0443\u044e \u0438\u0437 Liner",
        "source_cache": "\u0418\u0437 \u043a\u044d\u0448\u0430 \u0441\u0430\u0439\u0442\u0430",
    },
    "tl": {
        "followers": "Mga tagasunod",
        "follow_stats": "{followers} tagasunod \u00b7 {following} sinusundan",
        "source_live": "Live mula sa Liner",
        "source_cache": "Mula sa website cache",
    },
    "tr": {
        "followers": "Takip\u00e7iler",
        "follow_stats": "{followers} takip\u00e7i \u00b7 {following} takip",
        "source_live": "Liner'dan canl\u0131",
        "source_cache": "Site \u00f6nbelle\u011finden",
    },
    "uk": {
        "followers": "\u041f\u0456\u0434\u043f\u0438\u0441\u043d\u0438\u043a\u0438",
        "follow_stats": "{followers} \u043f\u0456\u0434\u043f\u0438\u0441\u043d\u0438\u043a\u0456\u0432 \u00b7 {following} \u043f\u0456\u0434\u043f\u0438\u0441\u043e\u043a",
        "source_live": "\u041d\u0430\u0436\u0438\u0432\u043e \u0437 Liner",
        "source_cache": "\u0417 \u043a\u0435\u0448\u0443 \u0441\u0430\u0439\u0442\u0443",
    },
}


def main() -> None:
    for locale, additions in TRANSLATIONS.items():
        path = os.path.join(LOCALES_DIR, f"{locale}.json")
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        uf = data.setdefault("settings", {}).setdefault("user_finder", {})
        for key, value in additions.items():
            uf[key] = value
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"{locale}: +{len(additions)} keys")


if __name__ == "__main__":
    main()
