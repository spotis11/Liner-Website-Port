#!/usr/bin/env python3
"""Add the Discord login keys to every locale's login section (key parity)."""
import json
import os

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

# key -> {locale: text}; 'en' is the source of truth
TEXTS = {
    "btn_discord": {
        "en": "Continue with Discord",
        "de": "Mit Discord fortfahren",
        "es": "Continuar con Discord",
        "fr": "Continuer avec Discord",
        "id": "Lanjutkan dengan Discord",
        "it": "Continua con Discord",
        "pl": "Kontynuuj z Discordem",
        "pt": "Continuar com Discord",
        "ru": "Продолжить с Discord",
        "tl": "Magpatuloy gamit ang Discord",
        "tr": "Discord ile devam et",
        "uk": "Продовжити з Discord",
    },
    "discord_hint": {
        "en": "One tap with your Discord account — your website account is created or linked automatically.",
        "de": "Ein Tipp mit deinem Discord-Konto — dein Website-Konto wird automatisch erstellt oder verknüpft.",
        "es": "Un toque con tu cuenta de Discord: tu cuenta del sitio se crea o vincula automáticamente.",
        "fr": "Un appui avec votre compte Discord : votre compte du site est créé ou lié automatiquement.",
        "id": "Sekali ketuk dengan akun Discord — akun situs Anda otomatis dibuat atau ditautkan.",
        "it": "Un tocco con il tuo account Discord: l'account del sito viene creato o collegato automaticamente.",
        "pl": "Jedno dotknięcie kontem Discord — konto na stronie zostanie automatycznie utworzone lub połączone.",
        "pt": "Um toque com sua conta Discord — sua conta do site é criada ou vinculada automaticamente.",
        "ru": "Одно касание через Discord — аккаунт сайта создастся или привяжется автоматически.",
        "tl": "Isang tap gamit ang Discord account — awtomatikong gagawin o ikakabit ang account mo sa site.",
        "tr": "Discord hesabınla tek dokunuş — site hesabın otomatik oluşturulur veya bağlanır.",
        "uk": "Одне торкання через Discord — акаунт сайту створиться або прив'яжеться автоматично.",
    },
    "discord_signing_in": {
        "en": "Signing you in with Discord…",
        "de": "Anmeldung mit Discord…",
        "es": "Iniciando sesión con Discord…",
        "fr": "Connexion avec Discord…",
        "id": "Masuk dengan Discord…",
        "it": "Accesso con Discord…",
        "pl": "Logowanie przez Discord…",
        "pt": "Entrando com Discord…",
        "ru": "Вход через Discord…",
        "tl": "Naglo-log in gamit ang Discord…",
        "tr": "Discord ile giriş yapılıyor…",
        "uk": "Вхід через Discord…",
    },
    "discord_error_title": {
        "en": "Discord sign-in failed",
        "de": "Discord-Anmeldung fehlgeschlagen",
        "es": "Falló el inicio de sesión con Discord",
        "fr": "Échec de la connexion Discord",
        "id": "Masuk dengan Discord gagal",
        "it": "Accesso con Discord non riuscito",
        "pl": "Logowanie przez Discord nie powiodło się",
        "pt": "Falha ao entrar com Discord",
        "ru": "Не удалось войти через Discord",
        "tl": "Hindi nakapag-log in sa Discord",
        "tr": "Discord girişi başarısız oldu",
        "uk": "Не вдалося увійти через Discord",
    },
    "discord_error": {
        "en": "Something went wrong while talking to Discord. Please try again.",
        "de": "Bei der Kommunikation mit Discord ist etwas schiefgelaufen. Bitte versuche es erneut.",
        "es": "Algo salió mal al hablar con Discord. Inténtalo de nuevo.",
        "fr": "Un problème est survenu avec Discord. Veuillez réessayer.",
        "id": "Terjadi kesalahan saat menghubungi Discord. Silakan coba lagi.",
        "it": "Si è verificato un problema con Discord. Riprova.",
        "pl": "Coś poszło nie tak podczas łączenia z Discordem. Spróbuj ponownie.",
        "pt": "Algo deu errado ao falar com o Discord. Tente novamente.",
        "ru": "Что-то пошло не так при связи с Discord. Попробуйте ещё раз.",
        "tl": "May naganap na problema sa Discord. Subukan muli.",
        "tr": "Discord ile bağlantıda bir sorun oluştu. Lütfen tekrar dene.",
        "uk": "Щось пішло не так під час зв'язку з Discord. Спробуйте ще раз.",
    },
    "discord_error_denied": {
        "en": "Discord sign-in was cancelled.",
        "de": "Die Discord-Anmeldung wurde abgebrochen.",
        "es": "Se canceló el inicio de sesión con Discord.",
        "fr": "La connexion Discord a été annulée.",
        "id": "Masuk dengan Discord dibatalkan.",
        "it": "Accesso con Discord annullato.",
        "pl": "Logowanie przez Discord zostało anulowane.",
        "pt": "Entrar com Discord foi cancelado.",
        "ru": "Вход через Discord отменён.",
        "tl": "Kanselado ang pag-log in sa Discord.",
        "tr": "Discord girişi iptal edildi.",
        "uk": "Вхід через Discord скасовано.",
    },
    "discord_back_to_login": {
        "en": "Back to sign in",
        "de": "Zurück zur Anmeldung",
        "es": "Volver a iniciar sesión",
        "fr": "Retour à la connexion",
        "id": "Kembali ke halaman masuk",
        "it": "Torna all'accesso",
        "pl": "Wróć do logowania",
        "pt": "Voltar para o login",
        "ru": "Вернуться к входу",
        "tl": "Bumalik sa pag-log in",
        "tr": "Girişe dön",
        "uk": "Повернутися до входу",
    },
}

for file in sorted(os.listdir(LOCALES_DIR)):
    if not file.endswith(".json"):
        continue
    code = file.removesuffix(".json")
    path = os.path.join(LOCALES_DIR, file)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    login = data.setdefault("login", {})
    added = []
    for key, texts in TEXTS.items():
        if key in login:
            continue
        login[key] = texts.get(code) or texts["en"]
        added.append(key)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{code}: +{len(added)} keys {added if added else '(none)'}")
