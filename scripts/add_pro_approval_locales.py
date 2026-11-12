#!/usr/bin/env python3
"""Add the Liner Pro approval-flow + moderation-grant locale keys.

settings.pro.approval_*  — how to get Pro: DM thearchyexpunged on Discord,
                           no payment, tell him your Liner username.
settings.pro.active_*    — the "Pro is active" state on the Pro tab.
settings.moderation.pro_* — the owner's Pro grants section in Moderation.
"""
import json
import collections
import os

LOCALES_DIR = "/home/z/my-project/liner-app/src/languages/locales"

PRO = {
    "en": {
        "active_title": "Liner Pro is active",
        "active_desc": "Every Pro benefit is unlocked on this account — forever. Thanks for building Liner with us.",
        "approval_title": "How to get Liner Pro",
        "approval_desc": "DM thearchyexpunged on Discord to get approval — no payment, just approval. Tell him your Liner username.",
        "approval_button": "DM thearchyexpunged",
    },
    "de": {
        "active_title": "Liner Pro ist aktiv",
        "active_desc": "Alle Pro-Vorteile sind für dieses Konto freigeschaltet — für immer. Danke, dass du Liner mit uns baust.",
        "approval_title": "So bekommst du Liner Pro",
        "approval_desc": "Schreibe thearchyexpunged auf Discord an, um eine Freigabe zu bekommen — keine Zahlung, nur die Freigabe. Nenne ihm deinen Liner-Benutzernamen.",
        "approval_button": "thestarchyexpunged anschreiben",
    },
    "es": {
        "active_title": "Liner Pro está activo",
        "active_desc": "Todos los beneficios Pro están desbloqueados en esta cuenta — para siempre. Gracias por construir Liner con nosotros.",
        "approval_title": "Cómo obtener Liner Pro",
        "approval_desc": "Escribe a thearchyexpunged por Discord para obtener la aprobación — sin pagos, solo aprobación. Dile tu nombre de usuario de Liner.",
        "approval_button": "Escribir a thearchyexpunged",
    },
    "fr": {
        "active_title": "Liner Pro est actif",
        "active_desc": "Tous les avantages Pro sont débloqués sur ce compte — pour toujours. Merci de construire Liner avec nous.",
        "approval_title": "Comment obtenir Liner Pro",
        "approval_desc": "Écris à thearchyexpunged sur Discord pour obtenir l'approbation — aucun paiement, juste une approbation. Donne-lui ton pseudo Liner.",
        "approval_button": "Écrire à thearchyexpunged",
    },
    "id": {
        "active_title": "Liner Pro aktif",
        "active_desc": "Semua manfaat Pro terbuka di akun ini — selamanya. Terima kasih telah membangun Liner bersama kami.",
        "approval_title": "Cara mendapatkan Liner Pro",
        "approval_desc": "DM thearchyexpunged di Discord untuk mendapat persetujuan — tanpa pembayaran, cukup persetujuan. Beritahu nama pengguna Liner-mu.",
        "approval_button": "DM thearchyexpunged",
    },
    "it": {
        "active_title": "Liner Pro è attivo",
        "active_desc": "Tutti i vantaggi Pro sono sbloccati su questo account — per sempre. Grazie per costruire Liner con noi.",
        "approval_title": "Come ottenere Liner Pro",
        "approval_desc": "Scrivi a thearchyexpunged su Discord per ottenere l'approvazione — nessun pagamento, solo approvazione. Digli il tuo nome utente Liner.",
        "approval_button": "Scrivi a thearchyexpunged",
    },
    "pl": {
        "active_title": "Liner Pro jest aktywne",
        "active_desc": "Wszystkie korzyści Pro są odblokowane na tym koncie — na zawsze. Dzięki, że tworzysz Liner z nami.",
        "approval_title": "Jak zdobyć Liner Pro",
        "approval_desc": "Napisz do thearchyexpunged na Discordzie, aby uzyskać aprobatę — bez płatności, tylko aprobata. Podaj swoją nazwę użytkownika Liner.",
        "approval_button": "Napisz do thearchyexpunged",
    },
    "pt": {
        "active_title": "Liner Pro está ativo",
        "active_desc": "Todos os benefícios Pro estão liberados nesta conta — para sempre. Obrigado por construir o Liner conosco.",
        "approval_title": "Como obter o Liner Pro",
        "approval_desc": "Mande mensagem para thearchyexpunged no Discord para obter aprovação — sem pagamento, apenas aprovação. Informe seu nome de usuário do Liner.",
        "approval_button": "Falar com thearchyexpunged",
    },
    "ru": {
        "active_title": "Liner Pro активен",
        "active_desc": "Все преимущества Pro открыты на этом аккаунте — навсегда. Спасибо, что создаёте Liner вместе с нами.",
        "approval_title": "Как получить Liner Pro",
        "approval_desc": "Напишите thearchyexpunged в Discord, чтобы получить одобрение — без оплаты, только одобрение. Назовите ему своё имя пользователя Liner.",
        "approval_button": "Написать thearchyexpunged",
    },
    "tl": {
        "active_title": "Aktibo ang Liner Pro",
        "active_desc": "Naka-unlock na ang lahat ng benepisyo ng Pro sa account na ito — magpakailanman. Salamat sa pagbuo ng Liner kasama namin.",
        "approval_title": "Paano makakuha ng Liner Pro",
        "approval_desc": "I-DM si thearchyexpunged sa Discord para sa approval — walang bayad, approval lang. Sabihin sa kanya ang Liner username mo.",
        "approval_button": "I-DM si thearchyexpunged",
    },
    "tr": {
        "active_title": "Liner Pro etkin",
        "active_desc": "Tüm Pro avantajları bu hesapta açıldı — sonsuza dek. Liner'i bizimle inşa ettiğin için teşekkürler.",
        "approval_title": "Liner Pro nasıl alınır",
        "approval_desc": "Onay almak için Discord'da thearchyexpunged'a yaz — ödeme yok, sadece onay. Liner kullanıcı adını ona söyle.",
        "approval_button": "thearchyexpunged'a yaz",
    },
    "uk": {
        "active_title": "Liner Pro активний",
        "active_desc": "Усі переваги Pro відкрито на цьому акаунті — назавжди. Дякуємо, що створюєте Liner разом з нами.",
        "approval_title": "Як отримати Liner Pro",
        "approval_desc": "Напишіть thearchyexpunged у Discord, щоб отримати схвалення — без оплати, лише схвалення. Назвіть йому своє ім'я користувача Liner.",
        "approval_button": "Написати thearchyexpunged",
    },
}

MODERATION = {
    "en": {
        "pro_section_title": "Liner Pro grants",
        "pro_section_subtitle": "Hand out Liner Pro for free — approval-only tier, no payment. The owner's own Pro is permanent and can never be revoked.",
        "pro_list_title": "Accounts with Liner Pro",
        "pro_list_empty": "No Pro accounts yet.",
        "pro_owner_pill": "Owner",
        "pro_owner_hint": "Permanent — activated forever.",
        "pro_granted_by": "Granted by {by}",
        "pro_revoke": "Revoke",
        "pro_grant_title": "Grant Liner Pro",
        "pro_grant_button": "Grant",
        "pro_grant_hint": "Type the account's Liner username. Pro activates on their next session refresh.",
        "pro_toast_granted": "Liner Pro granted to @{username}.",
        "pro_toast_revoked": "Liner Pro revoked from @{username}.",
        "pro_error_owner": "The owner's Liner Pro is permanent — it cannot be revoked.",
    },
    "de": {
        "pro_section_title": "Liner Pro-Verleihungen",
        "pro_section_subtitle": "Liner Pro kostenlos vergeben — nur Freigabe, keine Zahlung. Das eigene Pro des Owners ist dauerhaft und kann nicht widerrufen werden.",
        "pro_list_title": "Konten mit Liner Pro",
        "pro_list_empty": "Noch keine Pro-Konten.",
        "pro_owner_pill": "Owner",
        "pro_owner_hint": "Dauerhaft — für immer aktiviert.",
        "pro_granted_by": "Vergeben von {by}",
        "pro_revoke": "Widerrufen",
        "pro_grant_title": "Liner Pro vergeben",
        "pro_grant_button": "Vergeben",
        "pro_grant_hint": "Liner-Benutzernamen des Kontos eingeben. Pro wird beim nächsten Sitzungs-Refresh aktiv.",
        "pro_toast_granted": "Liner Pro an @{username} vergeben.",
        "pro_toast_revoked": "Liner Pro von @{username} widerrufen.",
        "pro_error_owner": "Das Liner Pro des Owners ist dauerhaft — es kann nicht widerrufen werden.",
    },
    "es": {
        "pro_section_title": "Concesiones de Liner Pro",
        "pro_section_subtitle": "Regala Liner Pro gratis — nivel solo por aprobación, sin pago. El Pro del propietario es permanente y no puede revocarse.",
        "pro_list_title": "Cuentas con Liner Pro",
        "pro_list_empty": "Aún no hay cuentas Pro.",
        "pro_owner_pill": "Propietario",
        "pro_owner_hint": "Permanente — activado para siempre.",
        "pro_granted_by": "Concedido por {by}",
        "pro_revoke": "Revocar",
        "pro_grant_title": "Conceder Liner Pro",
        "pro_grant_button": "Conceder",
        "pro_grant_hint": "Escribe el nombre de usuario de Liner de la cuenta. Pro se activa en su próximo refresco de sesión.",
        "pro_toast_granted": "Liner Pro concedido a @{username}.",
        "pro_toast_revoked": "Liner Pro revocado a @{username}.",
        "pro_error_owner": "El Liner Pro del propietario es permanente — no puede revocarse.",
    },
    "fr": {
        "pro_section_title": "Attributions Liner Pro",
        "pro_section_subtitle": "Offrez Liner Pro gratuitement — formule sur approbation uniquement, sans paiement. Le Pro du propriétaire est permanent et ne peut être révoqué.",
        "pro_list_title": "Comptes avec Liner Pro",
        "pro_list_empty": "Aucun compte Pro pour l'instant.",
        "pro_owner_pill": "Propriétaire",
        "pro_owner_hint": "Permanent — activé pour toujours.",
        "pro_granted_by": "Attribué par {by}",
        "pro_revoke": "Révoquer",
        "pro_grant_title": "Attribuer Liner Pro",
        "pro_grant_button": "Attribuer",
        "pro_grant_hint": "Saisis le pseudo Liner du compte. Pro s'active au prochain rafraîchissement de session.",
        "pro_toast_granted": "Liner Pro attribué à @{username}.",
        "pro_toast_revoked": "Liner Pro révoqué pour @{username}.",
        "pro_error_owner": "Le Liner Pro du propriétaire est permanent — il ne peut pas être révoqué.",
    },
    "id": {
        "pro_section_title": "Pemberian Liner Pro",
        "pro_section_subtitle": "Beri Liner Pro secara gratis — tier persetujuan saja, tanpa pembayaran. Pro pemilik bersifat permanen dan tidak dapat dicabut.",
        "pro_list_title": "Akun dengan Liner Pro",
        "pro_list_empty": "Belum ada akun Pro.",
        "pro_owner_pill": "Pemilik",
        "pro_owner_hint": "Permanen — diaktifkan selamanya.",
        "pro_granted_by": "Diberikan oleh {by}",
        "pro_revoke": "Cabut",
        "pro_grant_title": "Beri Liner Pro",
        "pro_grant_button": "Beri",
        "pro_grant_hint": "Ketik nama pengguna Liner akun tersebut. Pro aktif pada penyegaran sesi berikutnya.",
        "pro_toast_granted": "Liner Pro diberikan ke @{username}.",
        "pro_toast_revoked": "Liner Pro dicabut dari @{username}.",
        "pro_error_owner": "Liner Pro pemilik bersifat permanen — tidak dapat dicabut.",
    },
    "it": {
        "pro_section_title": "Assegnazioni Liner Pro",
        "pro_section_subtitle": "Regala Liner Pro — livello solo su approvazione, nessun pagamento. Il Pro del proprietario è permanente e non revocabile.",
        "pro_list_title": "Account con Liner Pro",
        "pro_list_empty": "Nessun account Pro per ora.",
        "pro_owner_pill": "Proprietario",
        "pro_owner_hint": "Permanente — attivato per sempre.",
        "pro_granted_by": "Assegnato da {by}",
        "pro_revoke": "Revoca",
        "pro_grant_title": "Assegna Liner Pro",
        "pro_grant_button": "Assegna",
        "pro_grant_hint": "Digita il nome utente Liner dell'account. Pro si attiva al prossimo aggiornamento della sessione.",
        "pro_toast_granted": "Liner Pro assegnato a @{username}.",
        "pro_toast_revoked": "Liner Pro revocato a @{username}.",
        "pro_error_owner": "Il Liner Pro del proprietario è permanente — non può essere revocato.",
    },
    "pl": {
        "pro_section_title": "Przyznawanie Liner Pro",
        "pro_section_subtitle": "Rozdaj Liner Pro za darmo — poziom wyłącznie na aprobatę, bez płatności. Pro właściciela jest stałe i nie można go cofnąć.",
        "pro_list_title": "Konta z Liner Pro",
        "pro_list_empty": "Nie ma jeszcze kont Pro.",
        "pro_owner_pill": "Właściciel",
        "pro_owner_hint": "Stałe — aktywowane na zawsze.",
        "pro_granted_by": "Przyznane przez {by}",
        "pro_revoke": "Cofnij",
        "pro_grant_title": "Przyznaj Liner Pro",
        "pro_grant_button": "Przyznaj",
        "pro_grant_hint": "Wpisz nazwę użytkownika Liner konta. Pro aktywuje się przy następnym odświeżeniu sesji.",
        "pro_toast_granted": "Liner Pro przyznane dla @{username}.",
        "pro_toast_revoked": "Liner Pro cofnięte dla @{username}.",
        "pro_error_owner": "Liner Pro właściciela jest stałe — nie można go cofnąć.",
    },
    "pt": {
        "pro_section_title": "Concessões de Liner Pro",
        "pro_section_subtitle": "Dê Liner Pro de graça — nível apenas por aprovação, sem pagamento. O Pro do dono é permanente e não pode ser revogado.",
        "pro_list_title": "Contas com Liner Pro",
        "pro_list_empty": "Ainda não há contas Pro.",
        "pro_owner_pill": "Dono",
        "pro_owner_hint": "Permanente — ativado para sempre.",
        "pro_granted_by": "Concedido por {by}",
        "pro_revoke": "Revogar",
        "pro_grant_title": "Conceder Liner Pro",
        "pro_grant_button": "Conceder",
        "pro_grant_hint": "Digite o nome de usuário Liner da conta. O Pro ativa no próximo refresh da sessão.",
        "pro_toast_granted": "Liner Pro concedido a @{username}.",
        "pro_toast_revoked": "Liner Pro revogado de @{username}.",
        "pro_error_owner": "O Liner Pro do dono é permanente — não pode ser revogado.",
    },
    "ru": {
        "pro_section_title": "Выдача Liner Pro",
        "pro_section_subtitle": "Раздавайте Liner Pro бесплатно — уровень только по одобрению, без оплаты. Pro владельца постоянно и не может быть отозвано.",
        "pro_list_title": "Аккаунты с Liner Pro",
        "pro_list_empty": "Пока нет Pro-аккаунтов.",
        "pro_owner_pill": "Владелец",
        "pro_owner_hint": "Постоянно — активировано навсегда.",
        "pro_granted_by": "Выдано: {by}",
        "pro_revoke": "Отозвать",
        "pro_grant_title": "Выдать Liner Pro",
        "pro_grant_button": "Выдать",
        "pro_grant_hint": "Введите имя пользователя Liner аккаунта. Pro активируется при следующем обновлении сессии.",
        "pro_toast_granted": "Liner Pro выдан @{username}.",
        "pro_toast_revoked": "Liner Pro отозван у @{username}.",
        "pro_error_owner": "Liner Pro владельца постоянно — его нельзя отозвать.",
    },
    "tl": {
        "pro_section_title": "Pagbibigay ng Liner Pro",
        "pro_section_subtitle": "Magbigay ng Liner Pro nang libre — approval-only tier, walang bayad. Ang Pro ng may-ari ay permanente at hindi maibabalik.",
        "pro_list_title": "Mga account na may Liner Pro",
        "pro_list_empty": "Wala pang Pro account.",
        "pro_owner_pill": "May-ari",
        "pro_owner_hint": "Permanente — aktibo magpakailanman.",
        "pro_granted_by": "Ibinigay ni {by}",
        "pro_revoke": "Bawiin",
        "pro_grant_title": "Bigyan ng Liner Pro",
        "pro_grant_button": "Ibigay",
        "pro_grant_hint": "I-type ang Liner username ng account. Gaganahin ang Pro sa susunod na session refresh.",
        "pro_toast_granted": "Naibigay ang Liner Pro kay @{username}.",
        "pro_toast_revoked": "Binawi ang Liner Pro kay @{username}.",
        "pro_error_owner": "Ang Liner Pro ng may-ari ay permanente — hindi mababawi.",
    },
    "tr": {
        "pro_section_title": "Liner Pro atamaları",
        "pro_section_subtitle": "Liner Pro'yu ücretsiz dağıt — yalnızca onaylı kademe, ödeme yok. Sahibin kendi Pro'su kalıcıdır ve asla geri alınamaz.",
        "pro_list_title": "Liner Pro'lu hesaplar",
        "pro_list_empty": "Henüz Pro hesabı yok.",
        "pro_owner_pill": "Sahip",
        "pro_owner_hint": "Kalıcı — sonsuza dek etkin.",
        "pro_granted_by": "{by} tarafından atandı",
        "pro_revoke": "Geri al",
        "pro_grant_title": "Liner Pro ata",
        "pro_grant_button": "Ata",
        "pro_grant_hint": "Hesabın Liner kullanıcı adını yaz. Pro, bir sonraki oturum yenilemesinde etkinleşir.",
        "pro_toast_granted": "Liner Pro @{username} hesabına atandı.",
        "pro_toast_revoked": "Liner Pro @{username} hesabından geri alındı.",
        "pro_error_owner": "Sahibin Liner Pro'su kalıcıdır — geri alınamaz.",
    },
    "uk": {
        "pro_section_title": "Надання Liner Pro",
        "pro_section_subtitle": "Роздавайте Liner Pro безкоштовно — рівень лише за схваленням, без оплати. Pro власника постійне і не може бути відкликане.",
        "pro_list_title": "Акаунти з Liner Pro",
        "pro_list_empty": "Ще немає Pro-акаунтів.",
        "pro_owner_pill": "Власник",
        "pro_owner_hint": "Постійне — активоване назавжди.",
        "pro_granted_by": "Видано: {by}",
        "pro_revoke": "Відкликати",
        "pro_grant_title": "Видати Liner Pro",
        "pro_grant_button": "Видати",
        "pro_grant_hint": "Введіть ім'я користувача Liner акаунта. Pro активується при наступному оновленні сесії.",
        "pro_toast_granted": "Liner Pro видано @{username}.",
        "pro_toast_revoked": "Liner Pro відкликано в @{username}.",
        "pro_error_owner": "Liner Pro власника постійне — його не можна відкликати.",
    },
}

problems = []


def add_ns(data, path_keys):
    """Walk/create nested namespaces, preserving key order."""
    node = data
    for key in path_keys[:-1]:
        nxt = node.get(key)
        if not isinstance(nxt, dict):
            nxt = collections.OrderedDict()
            node[key] = nxt
        node = nxt
    return node.setdefault(path_keys[-1], collections.OrderedDict())


for code in PRO:
    path = os.path.join(LOCALES_DIR, f"{code}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=collections.OrderedDict)

    # settings.pro.approval_* / active_* — merge into the existing pro ns
    pro_ns = data.get("settings", {}).get("pro")
    if not isinstance(pro_ns, dict):
        problems.append(f"{code}.json has no settings.pro namespace")
        continue
    changed = False
    for key, value in PRO[code].items():
        if key not in pro_ns:
            pro_ns[key] = value
            changed = True

    # settings.moderation.pro_* — create on demand (partial translations OK)
    mod_ns = add_ns(data, ["settings", "moderation"])
    for key, value in MODERATION[code].items():
        if key not in mod_ns:
            mod_ns[key] = value
            changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"[ok] {code}.json updated")
    else:
        print(f"[skip] {code}.json already has keys")

# Parity assertion
PRO_KEYS = set(PRO["en"].keys())
MOD_KEYS = set(MODERATION["en"].keys())
for code in PRO:
    path = os.path.join(LOCALES_DIR, f"{code}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    pro_ns = data.get("settings", {}).get("pro", {})
    mod_ns = data.get("settings", {}).get("moderation", {})
    for key in PRO_KEYS:
        if key not in pro_ns or not str(pro_ns[key]).strip():
            problems.append(f"{code}.json missing settings.pro.{key}")
    for key in MOD_KEYS:
        if key not in mod_ns or not str(mod_ns[key]).strip():
            problems.append(f"{code}.json missing settings.moderation.{key}")

if problems:
    print("FAILURES:")
    for p in problems:
        print(" -", p)
    raise SystemExit(1)
print("All locales carry the Pro approval + moderation grant keys — parity OK")
