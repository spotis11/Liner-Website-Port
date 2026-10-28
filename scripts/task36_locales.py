#!/usr/bin/env python3
"""Task 36: add local.scan_no_folders + local.scan_no_audio to all 12 locales."""
import json, os, collections

LOCALES = "/home/z/my-project/liner-app/src/languages/locales"
KEYS = {
    "scan_no_folders": {
        "en": "No folders to scan yet — add a folder or drop audio files first",
        "de": "Noch keine Ordner zum Scannen — füge zuerst einen Ordner hinzu oder ziehe Audiodateien hinein",
        "es": "Aún no hay carpetas que escanear: añade una carpeta o suelta archivos de audio primero",
        "fr": "Aucun dossier à analyser pour l'instant — ajoutez d'abord un dossier ou déposez des fichiers audio",
        "id": "Belum ada folder untuk dipindai — tambahkan folder atau jatuhkan file audio terlebih dahulu",
        "it": "Nessuna cartella da scansionare — aggiungi prima una cartella o trascina file audio",
        "pl": "Brak folderów do skanowania — najpierw dodaj folder lub przeciągnij pliki audio",
        "pt": "Ainda não há pastas para escanear — adicione uma pasta ou solte arquivos de áudio primeiro",
        "ru": "Пока нет папок для сканирования — сначала добавьте папку или перетащите аудиофайлы",
        "tl": "Walang folder na i-scan pa — magdagdag muna ng folder o mag-drop ng audio files",
        "tr": "Taranacak klasör yok — önce bir klasör ekleyin veya ses dosyası bırakın",
        "uk": "Ще немає папок для сканування — спочатку додайте папку або перетягніть аудіофайли",
    },
    "scan_no_audio": {
        "en": "No audio files found in that folder",
        "de": "Keine Audiodateien in diesem Ordner gefunden",
        "es": "No se encontraron archivos de audio en esa carpeta",
        "fr": "Aucun fichier audio trouvé dans ce dossier",
        "id": "Tidak ada file audio yang ditemukan di folder itu",
        "it": "Nessun file audio trovato in quella cartella",
        "pl": "Nie znaleziono plików audio w tym folderze",
        "pt": "Nenhum arquivo de áudio encontrado nessa pasta",
        "ru": "В этой папке не найдено аудиофайлов",
        "tl": "Walang nahanap na audio files sa folder na iyon",
        "tr": "O klasörde ses dosyası bulunamadı",
        "uk": "У цій папці не знайдено аудіофайлів",
    },
}

for fname in sorted(os.listdir(LOCALES)):
    if not fname.endswith(".json"):
        continue
    path = os.path.join(LOCALES, fname)
    code = fname[:-5]
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)
    local = data.get("local")
    if local is None:
        print(f"SKIP {fname}: no local section")
        continue
    changed = False
    for key, translations in KEYS.items():
        if key not in local:
            # insert after scan_failed if present, else append
            local[key] = translations[code]
            changed = True
    if changed:
        # re-order: keep scan_no_* right after scan_failed for tidy diffs
        items = collections.OrderedDict()
        for k, v in local.items():
            items[k] = v
            if k == "scan_failed":
                if "scan_no_folders" in local:
                    items["scan_no_folders"] = local["scan_no_folders"]
                if "scan_no_audio" in local:
                    items["scan_no_audio"] = local["scan_no_audio"]
        for k in ("scan_no_folders", "scan_no_audio"):
            if k in items and k in local and items.get(k) is local.get(k):
                pass
        # remove duplicates appended at end (they were added there first)
        seen = set()
        final = collections.OrderedDict()
        for k, v in items.items():
            if k in seen:
                continue
            seen.add(k)
            final[k] = v
        data["local"] = final
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"OK {fname}")
    else:
        print(f"NOOP {fname}")
