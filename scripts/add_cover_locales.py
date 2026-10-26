#!/usr/bin/env python3
"""Add custom-playlist-cover i18n keys to the playlist namespace of all locales."""
import json
import collections
import os

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

# change_cover / reset_cover / cover_updated / cover_reset / cover_invalid / cover_failed
TRANSLATIONS = {
    "en": {
        "change_cover": "Change cover",
        "reset_cover": "Reset to auto cover",
        "cover_updated": "Custom cover updated",
        "cover_reset": "Cover reset to auto",
        "cover_invalid": "That file is not an image",
        "cover_failed": "Couldn't update the cover",
    },
    "de": {
        "change_cover": "Cover ändern",
        "reset_cover": "Auf automatisches Cover zurücksetzen",
        "cover_updated": "Eigenes Cover aktualisiert",
        "cover_reset": "Cover auf automatisch zurückgesetzt",
        "cover_invalid": "Diese Datei ist kein Bild",
        "cover_failed": "Cover konnte nicht aktualisiert werden",
    },
    "es": {
        "change_cover": "Cambiar portada",
        "reset_cover": "Restablecer portada automática",
        "cover_updated": "Portada personalizada actualizada",
        "cover_reset": "Portada restablecida a automática",
        "cover_invalid": "Ese archivo no es una imagen",
        "cover_failed": "No se pudo actualizar la portada",
    },
    "fr": {
        "change_cover": "Changer la pochette",
        "reset_cover": "Rétablir la pochette auto",
        "cover_updated": "Pochette personnalisée mise à jour",
        "cover_reset": "Pochette rétablie sur auto",
        "cover_invalid": "Ce fichier n'est pas une image",
        "cover_failed": "Impossible de mettre à jour la pochette",
    },
    "id": {
        "change_cover": "Ubah sampul",
        "reset_cover": "Kembalikan ke sampul otomatis",
        "cover_updated": "Sampul kustom diperbarui",
        "cover_reset": "Sampul dikembalikan ke otomatis",
        "cover_invalid": "File itu bukan gambar",
        "cover_failed": "Tidak dapat memperbarui sampul",
    },
    "it": {
        "change_cover": "Cambia copertina",
        "reset_cover": "Ripristina copertina automatica",
        "cover_updated": "Copertina personalizzata aggiornata",
        "cover_reset": "Copertina ripristinata su automatica",
        "cover_invalid": "Quel file non è un'immagine",
        "cover_failed": "Impossibile aggiornare la copertina",
    },
    "pl": {
        "change_cover": "Zmień okładkę",
        "reset_cover": "Przywróć automatyczną okładkę",
        "cover_updated": "Zaktualizowano własną okładkę",
        "cover_reset": "Przywrócono automatyczną okładkę",
        "cover_invalid": "Ten plik nie jest obrazem",
        "cover_failed": "Nie udało się zaktualizować okładki",
    },
    "pt": {
        "change_cover": "Alterar capa",
        "reset_cover": "Restaurar capa automática",
        "cover_updated": "Capa personalizada atualizada",
        "cover_reset": "Capa restaurada para automática",
        "cover_invalid": "Esse arquivo não é uma imagem",
        "cover_failed": "Não foi possível atualizar a capa",
    },
    "ru": {
        "change_cover": "Изменить обложку",
        "reset_cover": "Вернуть автообложку",
        "cover_updated": "Своя обложка обновлена",
        "cover_reset": "Возвращена автообложка",
        "cover_invalid": "Этот файл не изображение",
        "cover_failed": "Не удалось обновить обложку",
    },
    "tl": {
        "change_cover": "Palitan ang cover",
        "reset_cover": "Ibalik sa auto cover",
        "cover_updated": "Na-update ang custom cover",
        "cover_reset": "Naibalik sa auto cover",
        "cover_invalid": "Hindi image ang file na iyan",
        "cover_failed": "Hindi ma-update ang cover",
    },
    "tr": {
        "change_cover": "Kapakyı değiştir",
        "reset_cover": "Otomatik kapaka dön",
        "cover_updated": "Özel kapak güncellendi",
        "cover_reset": "Otomatik kapaga dönüldü",
        "cover_invalid": "Bu dosya bir görsel değil",
        "cover_failed": "Kapak güncellenemedi",
    },
    "uk": {
        "change_cover": "Змінити обкладинку",
        "reset_cover": "Повернути автообкладинку",
        "cover_updated": "Власну обкладинку оновлено",
        "cover_reset": "Повернуто автообкладинку",
        "cover_invalid": "Цей файл не є зображенням",
        "cover_failed": "Не вдалося оновити обкладинку",
    },
}

ORDER = [
    "change_cover",
    "reset_cover",
    "cover_updated",
    "cover_reset",
    "cover_invalid",
    "cover_failed",
]

for code, additions in TRANSLATIONS.items():
    path = os.path.join(LOCALES_DIR, f"{code}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)
    ns = data.get("playlist")
    if ns is None:
        print(f"[warn] {code}.json has no playlist namespace — skipped")
        continue
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
