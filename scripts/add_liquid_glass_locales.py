#!/usr/bin/env python3
"""Add the Liquid Glass appearance keys to settings.appearance in all locales.

Keys: liquid_glass_title / liquid_glass_description — the real liquidGL
(WebGPU refracting glass) toggle on the Appearance tab.
"""
import json
import collections
import os

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

TRANSLATIONS = {
    "en": {
        "liquid_glass_title": "Liquid glass",
        "liquid_glass_description": "Real refracting glass on the player bar and queue drawer — the page behind bends through the pane. Falls back to frosted blur on older devices.",
    },
    "de": {
        "liquid_glass_title": "Flüssigglas",
        "liquid_glass_description": "Echtes lichtbrechendes Glas auf Player-Leiste und Warteschlange — die Seite dahinter krümmt sich durch die Scheibe. Auf älteren Geräten wird ein Milchglas-Effekt verwendet.",
    },
    "es": {
        "liquid_glass_title": "Cristal líquido",
        "liquid_glass_description": "Cristal real con refracción en la barra del reproductor y la cola: la página detrás se curva a través del panel. En dispositivos antiguos se usa un desenfoque esmerilado.",
    },
    "fr": {
        "liquid_glass_title": "Verre liquide",
        "liquid_glass_description": "Véritable verre réfractant sur la barre de lecture et la file d'attente — la page derrière se courbe à travers le panneau. Sur les anciens appareils, un flou dépoli est utilisé.",
    },
    "id": {
        "liquid_glass_title": "Kaca cair",
        "liquid_glass_description": "Kaca refraksi nyata pada bilah pemutar dan panel antrean — halaman di belakangnya melengkung melewati kacanya. Perangkat lama memakai efek buram susu.",
    },
    "it": {
        "liquid_glass_title": "Vetro liquido",
        "liquid_glass_description": "Vetro reale con rifrazione sulla barra del riproduttore e sulla coda — la pagina dietro si curva attraverso il pannello. Sui dispositivi più vecchi si usa una sfumatura satinata.",
    },
    "pl": {
        "liquid_glass_title": "Płynne szkło",
        "liquid_glass_description": "Prawdziwe załamujące szkło na pasku odtwarzacza i panelu kolejki — strona za nim ugina się przez szybę. Na starszych urządzeniach używane jest rozmycie mleczne.",
    },
    "pt": {
        "liquid_glass_title": "Vidro líquido",
        "liquid_glass_description": "Vidro real com refração na barra do player e na fila — a página atrás se curva através do painel. Em dispositivos antigos, usa um desfoque fosco.",
    },
    "ru": {
        "liquid_glass_title": "Жидкое стекло",
        "liquid_glass_description": "Настоящее преломляющее стекло на панели плеера и очереди — страница за ним изгибается сквозь стекло. На старых устройствах используется матовое размытие.",
    },
    "tl": {
        "liquid_glass_title": "Liquid na salamin",
        "liquid_glass_description": "Tunay na sumasalamin na salamin sa player bar at queue drawer — yumuyuko ang page sa likod sa pamamagitan ng salamin. Sa lumang device, ginagamit ang malabong frosted blur.",
    },
    "tr": {
        "liquid_glass_title": "Sıvı cam",
        "liquid_glass_description": "Oynatıcı çubuğunda ve kuyruk panelinde gerçek kırıcı cam — arkasındaki sayfa camın içinden bükülür. Eski cihazlarda buzlu cam bulanıklığı kullanılır.",
    },
    "uk": {
        "liquid_glass_title": "Рідке скло",
        "liquid_glass_description": "Справжнє заломлювальне скло на панелі програвача та черги — сторінка за ним згинається крізь скло. На старих пристроях використовується матове розмиття.",
    },
}

ORDER = ["liquid_glass_title", "liquid_glass_description"]

problems = []
for code, additions in TRANSLATIONS.items():
    path = os.path.join(LOCALES_DIR, f"{code}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)
    settings = data.get("settings")
    if settings is None:
        problems.append(f"{code}.json has no settings namespace")
        continue
    # Non-English locales partially translate settings.* (missing keys fall
    # back to English per key), so create the appearance namespace on demand.
    ns = settings.setdefault("appearance", collections.OrderedDict())
    changed = False
    for key in ORDER:
        if key not in ns:
            ns[key] = additions[key]
            changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"[ok] {code}.json updated")
    else:
        print(f"[skip] {code}.json already has keys")

# Parity assertion: every locale file now carries both keys.
for code in TRANSLATIONS:
    path = os.path.join(LOCALES_DIR, f"{code}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    ns = data.get("settings", {}).get("appearance", {})
    for key in ORDER:
        if key not in ns or not ns[key].strip():
            problems.append(f"{code}.json missing settings.appearance.{key}")

if problems:
    print("FAILURES:")
    for p in problems:
        print(" -", p)
    raise SystemExit(1)
print("All 12 locales carry settings.appearance.liquid_glass_* — parity OK")
