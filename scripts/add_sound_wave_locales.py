import json
import collections
import os

BASE = "/home/z/my-project/liner-app/src/languages/locales"

TEXTS = {
    "en": ("Sound wave visualizer",
           "Show a live sound wave synced to the music in the fullscreen player."),
    "tl": ("Sound wave visualizer",
           "Magpakita ng live na sound wave na naka-sync sa musika sa fullscreen player."),
    "id": ("Visualizer gelombang suara",
           "Tampilkan gelombang suara langsung yang sinkron dengan musik di pemutar layar penuh."),
    "de": ("Soundwave-Visualisierer",
           "Zeige eine live Soundwelle, synchron zur Musik, im Vollbild-Player."),
    "it": ("Visualizzatore a onda sonora",
           "Mostra un'onda sonora live sincronizzata con la musica nel player a schermo intero."),
    "fr": ("Visualiseur d'onde sonore",
           "Afficher une onde sonore en direct synchronisee sur la musique dans le lecteur plein ecran."),
    "tr": ("Ses dalgasi gorsellestirici",
           "Tam ekran oynaticida muzige senkronize canli bir ses dalgasi goster."),
    "pt": ("Visualizador de onda sonora",
           "Mostrar uma onda sonora ao vivo sincronizada com a musica no player em tela cheia."),
    "pl": ("Wizualizacja fali dzwiekowej",
           "Pokaz zywa fale dzwiekowa zsynchronizowana z muzyka w odtwarzaczu pelnoekranowym."),
    "ru": ("Визуализатор звуковой волны",
           "Показывать живую звуковую волну, синхронизированную с музыкой, в полноэкранном плеере."),
    "uk": ("Візуалізатор звукової хвилі",
           "Показувати живу звукову хвилю, синхронізовану з музикою, у повноекранному плеєрі."),
    "es": ("Visualizador de onda de sonido",
           "Muestra una onda de sonido en vivo sincronizada con la musica en el reproductor a pantalla completa."),
}

for loc, (title, desc) in TEXTS.items():
    path = os.path.join(BASE, f"{loc}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)

    settings = data.get("settings")
    if settings is None:
        raise SystemExit(f"{loc}: no settings section")

    wave = collections.OrderedDict([("title", title), ("description", desc)])
    if "sound_wave" in settings:
        print(f"{loc}: sound_wave already present, overwriting value")
        settings["sound_wave"] = wave
        inserted = True
    else:
        new = collections.OrderedDict()
        inserted = False
        for k, v in settings.items():
            new[k] = v
            if k == "cross_tab_miniplayer":
                new["sound_wave"] = wave
                inserted = True
        if not inserted:
            new["sound_wave"] = wave
        data["settings"] = new

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{loc}: ok (placed={inserted})")

print("done")
