#!/usr/bin/env python3
"""Add Liner Pro locale keys (settings.tabs.pro + settings.pro.*) to all locales.

settings.pro presents the Pro tier benefit list (doubled library limits / 5000
liked tracks, animated avatar + banner, avatar frames + Web badge, revamped
profile editor, listening rooms for 50 friends, animated Pro sticker pack).
"""
import json
from pathlib import Path

LOCALES_DIR = Path("/home/z/my-project/liner-app/src/languages/locales")

TAB_LABEL = "Liner Pro"  # brand name, kept identical everywhere

PRO_KEYS = {
    "en": {
        "description": "The premium Liner experience — bigger library, animated profile and more.",
        "title": "Liner Pro",
        "tagline": "Everything you love about Liner, unlocked.",
        "cta": "Get Liner Pro",
        "benefits_title": "Included with Pro",
        "b1_title": "Doubled library limits",
        "b1_desc": "Keep up to 5,000 liked tracks in your library.",
        "b2_title": "Animated avatar and profile banner",
        "b2_desc": "Bring your profile to life with motion.",
        "b3_title": "Avatar frames and the Web badge",
        "b3_desc": "Dress up your avatar and stand out.",
        "b4_title": "Full profile editor (revamped)",
        "b4_desc": "Name, avatar, bio and privacy in one place.",
        "b5_title": "Host listening rooms",
        "b5_desc": "Listen together with up to 50 friends.",
        "b6_title": "Animated Pro sticker pack",
        "b6_desc": "Animated stickers, exclusive to Pro.",
        "support_title": "Questions about Pro?",
        "support_desc": "Get in touch with the Liner team.",
    },
    "de": {
        "description": "Das Premium-Erlebnis von Liner – größere Bibliothek, animiertes Profil und mehr.",
        "title": "Liner Pro",
        "tagline": "Alles, was du an Liner liebst, freigeschaltet.",
        "cta": "Liner Pro holen",
        "benefits_title": "In Pro enthalten",
        "b1_title": "Doppelte Bibliothekslimits",
        "b1_desc": "Bis zu 5.000 Lieblingssongs in deiner Bibliothek speichern.",
        "b2_title": "Animierter Avatar und Profil-Banner",
        "b2_desc": "Bringe dein Profil mit Animationen zum Leben.",
        "b3_title": "Avatar-Rahmen und Web-Badge",
        "b3_desc": "Schmücke deinen Avatar und hebe dich ab.",
        "b4_title": "Vollständiger Profil-Editor (überarbeitet)",
        "b4_desc": "Name, Avatar, Bio und Privatsphäre an einem Ort.",
        "b5_title": "Listening Rooms hosten",
        "b5_desc": "Höre gemeinsam mit bis zu 50 Freunden.",
        "b6_title": "Animiertes Pro-Sticker-Paket",
        "b6_desc": "Animierte Sticker, exklusiv für Pro.",
        "support_title": "Fragen zu Pro?",
        "support_desc": "Kontaktiere das Liner-Team.",
    },
    "es": {
        "description": "La experiencia premium de Liner: biblioteca más grande, perfil animado y más.",
        "title": "Liner Pro",
        "tagline": "Todo lo que amas de Liner, desbloqueado.",
        "cta": "Conseguir Liner Pro",
        "benefits_title": "Incluido con Pro",
        "b1_title": "Límites de biblioteca duplicados",
        "b1_desc": "Guarda hasta 5 000 canciones favoritas en tu biblioteca.",
        "b2_title": "Avatar y banner de perfil animados",
        "b2_desc": "Da vida a tu perfil con animación.",
        "b3_title": "Marcos de avatar e insignia Web",
        "b3_desc": "Decora tu avatar y destaca.",
        "b4_title": "Editor de perfil completo (renovado)",
        "b4_desc": "Nombre, avatar, biografía y privacidad en un solo lugar.",
        "b5_title": "Crea salas de escucha",
        "b5_desc": "Escucha junto con hasta 50 amigos.",
        "b6_title": "Paquete de stickers animados de Pro",
        "b6_desc": "Stickers animados exclusivos de Pro.",
        "support_title": "¿Preguntas sobre Pro?",
        "support_desc": "Contacta con el equipo de Liner.",
    },
    "fr": {
        "description": "L'expérience Liner premium : bibliothèque plus grande, profil animé et plus encore.",
        "title": "Liner Pro",
        "tagline": "Tout ce que vous aimez dans Liner, débloqué.",
        "cta": "Obtenir Liner Pro",
        "benefits_title": "Inclus avec Pro",
        "b1_title": "Limites de bibliothèque doublées",
        "b1_desc": "Gardez jusqu'à 5 000 titres aimés dans votre bibliothèque.",
        "b2_title": "Avatar et bannière de profil animés",
        "b2_desc": "Donnez vie à votre profil.",
        "b3_title": "Cadres d'avatar et badge Web",
        "b3_desc": "Habillez votre avatar et distinguez-vous.",
        "b4_title": "Éditeur de profil complet (repensé)",
        "b4_desc": "Nom, avatar, bio et confidentialité au même endroit.",
        "b5_title": "Animer des salles d'écoute",
        "b5_desc": "Écoutez avec jusqu'à 50 amis.",
        "b6_title": "Pack de stickers Pro animés",
        "b6_desc": "Des stickers animés exclusifs pour Pro.",
        "support_title": "Des questions sur Pro ?",
        "support_desc": "Contactez l'équipe Liner.",
    },
    "it": {
        "description": "L'esperienza premium di Liner: libreria più grande, profilo animato e altro.",
        "title": "Liner Pro",
        "tagline": "Tutto ciò che ami di Liner, sbloccato.",
        "cta": "Ottieni Liner Pro",
        "benefits_title": "Incluso con Pro",
        "b1_title": "Limiti della libreria raddoppiati",
        "b1_desc": "Tieni fino a 5 000 brani preferiti nella tua libreria.",
        "b2_title": "Avatar e banner del profilo animati",
        "b2_desc": "Dà vita al tuo profilo.",
        "b3_title": "Cornici per l'avatar e badge Web",
        "b3_desc": "Decora il tuo avatar e mettiti in risalto.",
        "b4_title": "Editor del profilo completo (rinnovato)",
        "b4_desc": "Nome, avatar, bio e privacy in un unico posto.",
        "b5_title": "Crea stanze d'ascolto",
        "b5_desc": "Ascolta insieme fino a 50 amici.",
        "b6_title": "Pacchetto di sticker Pro animati",
        "b6_desc": "Sticker animati esclusivi per Pro.",
        "support_title": "Domande su Pro?",
        "support_desc": "Contatta il team di Liner.",
    },
    "pt": {
        "description": "A experiência premium do Liner: biblioteca maior, perfil animado e mais.",
        "title": "Liner Pro",
        "tagline": "Tudo o que você ama no Liner, desbloqueado.",
        "cta": "Obter Liner Pro",
        "benefits_title": "Incluído no Pro",
        "b1_title": "Limites de biblioteca dobrados",
        "b1_desc": "Guarde até 5 000 músicas curtidas na sua biblioteca.",
        "b2_title": "Avatar e banner de perfil animados",
        "b2_desc": "Dê vida ao seu perfil.",
        "b3_title": "Molduras de avatar e selo Web",
        "b3_desc": "Enfeite seu avatar e destaque-se.",
        "b4_title": "Editor de perfil completo (renovado)",
        "b4_desc": "Nome, avatar, bio e privacidade num só lugar.",
        "b5_title": "Crie salas de escuta",
        "b5_desc": "Ouça junto com até 50 amigos.",
        "b6_title": "Pacote de stickers Pro animados",
        "b6_desc": "Stickers animados exclusivos do Pro.",
        "support_title": "Dúvidas sobre o Pro?",
        "support_desc": "Fale com a equipe do Liner.",
    },
    "pl": {
        "description": "Premiumowe doświadczenie Linera — większa biblioteka, animowany profil i więcej.",
        "title": "Liner Pro",
        "tagline": "Wszystko, co kochasz w Linerze, odblokowane.",
        "cta": "Zdobądź Liner Pro",
        "benefits_title": "W ramach Pro",
        "b1_title": "Podwojone limity biblioteki",
        "b1_desc": "Przechowuj do 5000 polubionych utworów w bibliotece.",
        "b2_title": "Animowany awatar i baner profilu",
        "b2_desc": "Ożyw swój profil animacją.",
        "b3_title": "Ramki awatara i odznaka Web",
        "b3_desc": "Udekoruj awatar i wyróżnij się.",
        "b4_title": "Pełny edytor profilu (odświeżony)",
        "b4_desc": "Nazwa, awatar, bio i prywatność w jednym miejscu.",
        "b5_title": "Prowadź pokoje odsłuchowe",
        "b5_desc": "Słuchaj razem z nawet 50 znajomymi.",
        "b6_title": "Animowany pakiet naklejek Pro",
        "b6_desc": "Animowane naklejki, tylko dla Pro.",
        "support_title": "Pytania o Pro?",
        "support_desc": "Skontaktuj się z zespołem Linera.",
    },
    "ru": {
        "description": "Премиум-опыт Liner — больше библиотека, анимированный профиль и другое.",
        "title": "Liner Pro",
        "tagline": "Всё, что вы любите в Liner, разблокировано.",
        "cta": "Получить Liner Pro",
        "benefits_title": "Входит в Pro",
        "b1_title": "Удвоенные лимиты библиотеки",
        "b1_desc": "Храните до 5 000 любимых треков в библиотеке.",
        "b2_title": "Анимированный аватар и баннер профиля",
        "b2_desc": "Оживите свой профиль анимацией.",
        "b3_title": "Рамки для аватара и значок Web",
        "b3_desc": "Украсьте аватар и выделяйтесь.",
        "b4_title": "Полный редактор профиля (обновлён)",
        "b4_desc": "Имя, аватар, био и приватность — в одном месте.",
        "b5_title": "Создавайте комнаты прослушивания",
        "b5_desc": "Слушайте вместе с 50 друзьями.",
        "b6_title": "Анимированный набор стикеров Pro",
        "b6_desc": "Анимированные стикеры — только для Pro.",
        "support_title": "Вопросы о Pro?",
        "support_desc": "Свяжитесь с командой Liner.",
    },
    "uk": {
        "description": "Преміум-досвід Liner — більша бібліотека, анімований профіль та інше.",
        "title": "Liner Pro",
        "tagline": "Усе, що ви любите в Liner, розблоковано.",
        "cta": "Отримати Liner Pro",
        "benefits_title": "Входить до Pro",
        "b1_title": "Подвоєні ліміти бібліотеки",
        "b1_desc": "Зберігайте до 5 000 улюблених треків у бібліотеці.",
        "b2_title": "Анімований аватар і банер профілю",
        "b2_desc": "Оживіть свій профіль анімацією.",
        "b3_title": "Рамки для аватара та значок Web",
        "b3_desc": "Прикрасьте аватар і виділяйтеся.",
        "b4_title": "Повний редактор профілю (оновлений)",
        "b4_desc": "Ім'я, аватар, біо і приватність — в одному місці.",
        "b5_title": "Створюйте кімнати прослуховування",
        "b5_desc": "Слухайте разом із 50 друзями.",
        "b6_title": "Анімований набір стікерів Pro",
        "b6_desc": "Анімовані стікери — лише для Pro.",
        "support_title": "Питання про Pro?",
        "support_desc": "Зв'яжіться з командою Liner.",
    },
    "tr": {
        "description": "Premium Liner deneyimi — daha büyük kütüphane, animasyonlu profil ve daha fazlası.",
        "title": "Liner Pro",
        "tagline": "Liner'da sevdiğin her şeyin kilidi açık.",
        "cta": "Liner Pro'yu al",
        "benefits_title": "Pro'ya dahil",
        "b1_title": "İkiye katlanan kütüphane limitleri",
        "b1_desc": "Kütüphanende 5.000'e kadar beğenilen parça sakla.",
        "b2_title": "Animasyonlu avatar ve profil kapak görseli",
        "b2_desc": "Profilini animasyonla canlandır.",
        "b3_title": "Avatar çerçeveleri ve Web rozeti",
        "b3_desc": "Avatarını süsle ve öne çık.",
        "b4_title": "Eksiksiz profil düzenleyici (yenilendi)",
        "b4_desc": "İsim, avatar, bio ve gizlilik tek bir yerde.",
        "b5_title": "Dinleme odaları aç",
        "b5_desc": "50 arkadaşınla birlikte dinle.",
        "b6_title": "Animasyonlu Pro sticker paketi",
        "b6_desc": "Animasyonlu stickerlar, Pro'ya özel.",
        "support_title": "Pro hakkında soruların mı var?",
        "support_desc": "Liner ekibiyle iletişime geç.",
    },
    "id": {
        "description": "Pengalaman premium Liner — perpustakaan lebih besar, profil animasi, dan lainnya.",
        "title": "Liner Pro",
        "tagline": "Semua yang kamu suka dari Liner, terbuka.",
        "cta": "Dapatkan Liner Pro",
        "benefits_title": "Termasuk dalam Pro",
        "b1_title": "Batas perpustakaan dua kali lipat",
        "b1_desc": "Simpan hingga 5.000 lagu favorit di perpustakaanmu.",
        "b2_title": "Avatar dan banner profil animasi",
        "b2_desc": "Hidupkan profilmu dengan animasi.",
        "b3_title": "Bingkai avatar dan lencana Web",
        "b3_desc": "Hias avatarmu dan menonjol.",
        "b4_title": "Editor profil lengkap (diperbarui)",
        "b4_desc": "Nama, avatar, bio, dan privasi dalam satu tempat.",
        "b5_title": "Host ruang mendengarkan",
        "b5_desc": "Dengarkan bersama hingga 50 teman.",
        "b6_title": "Paket stiker animasi Pro",
        "b6_desc": "Stiker animasi eksklusif untuk Pro.",
        "support_title": "Ada pertanyaan tentang Pro?",
        "support_desc": "Hubungi tim Liner.",
    },
    "tl": {
        "description": "Ang premium na karanasan ng Liner — mas malaking library, animated na profile, at marami pa.",
        "title": "Liner Pro",
        "tagline": "Lahat ng gusto mo sa Liner, naka-unlock.",
        "cta": "Kunin ang Liner Pro",
        "benefits_title": "Kasama sa Pro",
        "b1_title": "Dobleng limitasyon ng library",
        "b1_desc": "Mag-imbak ng hanggang 5,000 liked na kanta sa library mo.",
        "b2_title": "Animated na avatar at profile banner",
        "b2_desc": "Buhayin ang profile mo gamit ang animasyon.",
        "b3_title": "Mga frame ng avatar at Web badge",
        "b3_desc": "Damitan ang avatar mo at tumindig.",
        "b4_title": "Kumpletong profile editor (binago)",
        "b4_desc": "Pangalan, avatar, bio, at privacy — sa iisang lugar.",
        "b5_title": "Mag-host ng listening rooms",
        "b5_desc": "Makinig kasama ang hanggang 50 kaibigan.",
        "b6_title": "Animated na Pro sticker pack",
        "b6_desc": "Eksklusibong animated na stickers para sa Pro.",
        "support_title": "May tanong tungkol sa Pro?",
        "support_desc": "Makipag-ugnayan sa Liner team.",
    },
}


def flatten_keys(obj, prefix=""):
    keys = set()
    for k, v in obj.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys |= flatten_keys(v, path)
        else:
            keys.add(path)
    return keys


def main() -> None:
    for locale, keys in PRO_KEYS.items():
        path = LOCALES_DIR / f"{locale}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        settings = data["settings"]

        settings["pro"] = dict(keys)

        tabs = settings.setdefault("tabs", {})
        tabs["pro"] = TAB_LABEL

        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        path.write_text(text, encoding="utf-8")
        print(f"{locale}: settings.pro keys={len(keys)}, tabs.pro set")

    # parity check across all locale files
    base = None
    for path in sorted(LOCALES_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        settings = data.get("settings", {})
        keys = frozenset(flatten_keys(settings.get("pro", {})))
        tab_label = settings.get("tabs", {}).get("pro")
        if base is None:
            base = keys
        elif keys != base:
            only_here = keys - base
            only_base = base - keys
            raise SystemExit(
                f"parity break in {path.name}: +{sorted(only_here)} -{sorted(only_base)}"
            )
        if not tab_label:
            raise SystemExit(f"missing settings.tabs.pro in {path.name}")
    print(f"parity OK: settings.pro identical across all locales ({len(base)} keys)")


if __name__ == "__main__":
    main()
