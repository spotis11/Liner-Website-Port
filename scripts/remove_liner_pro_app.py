#!/usr/bin/env python3
"""Remove every trace of Liner Pro from the liner-app sources (src + src-classic),
the fan changelog data and all locale files. Anchor-based with assertions:
every replacement must apply exactly once or the script reports failure."""
import json
import os
import re
import sys

APP = "/home/z/my-project/liner-app"
failures = []
notes = []


def report(path, what, ok):
    (notes if ok else failures).append(f"{'OK  ' if ok else 'FAIL'} {path}: {what}")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, encoding="utf-8") as f:
        pass
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def cut_block(s, start_marker, open_ch="{", close_ch="}", include_start=True):
    """Find start_marker, locate the first open_ch at/after it, then cut through
    the char after the matching close_ch. Returns (new_s, found)."""
    i = s.find(start_marker)
    if i < 0:
        return s, False
    j = s.find(open_ch, i)
    if j < 0:
        return s, False
    depth = 0
    k = j
    in_str = None
    while k < len(s):
        c = s[k]
        if in_str:
            if c == "\\":
                k += 2
                continue
            if c == in_str:
                in_str = None
        elif c in "\"'`":
            in_str = c
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                break
        k += 1
    if depth != 0:
        return s, False
    start = i if include_start else j
    return s[:start] + s[k + 1 :], True


def remove_entry(s, line_re):
    """Remove an object-literal entry: the line matching line_re plus any
    continuation lines up to (not including) the next line at the same indent
    that looks like `key:` or a closing brace."""
    m = re.search(line_re, s, re.M)
    if not m:
        return s, False
    lines = s.splitlines(keepends=True)
    # find index of the matched line
    idx = None
    for n, ln in enumerate(lines):
        if re.match(line_re, ln):
            idx = n
            break
    indent = re.match(r"^\s*", lines[idx]).group(0)
    end = idx + 1
    key_re = re.compile(rf"^{indent}[A-Za-z_][A-Za-z0-9_]*:\s")
    while end < len(lines):
        ln = lines[end]
        if key_re.match(ln) or re.match(r"^\s*[\}\]]", ln):
            break
        end += 1
    del lines[idx:end]
    return "".join(lines), True


def sub_once(s, pat, repl, path, what, count=1):
    new, n = re.subn(pat, repl, s, count=count, flags=re.M)
    report(path, what, n == count)
    return new


# ---------------------------------------------------------------- deletes
for rel in [
    "src/features/settings/ui/tabs/ProTab.tsx",
    "src-classic/features/settings/ui/tabs/ProTab.tsx",
    "src/features/moderation/lib/proApi.ts",
    "src-classic/features/moderation/lib/proApi.ts",
]:
    p = os.path.join(APP, rel)
    if os.path.exists(p):
        os.remove(p)
        report(rel, "deleted", True)
    else:
        report(rel, "delete (already gone)", True)

for base in ["src", "src-classic"]:
    B = os.path.join(APP, base)

    # idempotency: skip a base that a previous partial run already cleaned
    probe = read(f"{B}/features/settings/ui/SettingsModal.tsx")
    if "Liner Pro" not in probe and "ProTab" not in probe:
        report(base, "already clean, skipped", True)
        continue

    # ------------------------------------------------ tabs/index.ts
    p = f"{B}/features/settings/ui/tabs/index.ts"
    s = read(p)
    s2 = s.replace('export { ProTab } from "./ProTab";\n', "")
    report(p, "ProTab export removed", s2 != s)
    write(p, s2)

    # ------------------------------------------------ SettingsModal.tsx
    p = f"{B}/features/settings/ui/SettingsModal.tsx"
    s = read(p)
    # search-index entries: cut from the "// Liner Pro" comment through the
    # entry just before "// Playback"
    i = s.find("  // Liner Pro\n")
    j = s.find("  // Playback", i) if i >= 0 else -1
    if i >= 0 and j > i:
        s = s[:i] + s[j:]
        report(p, "Pro search-index entries", True)
    else:
        report(p, "Pro search-index entries", "Liner Pro" not in s)
    s2 = s.replace('  { labelKey: "account", ids: ["Account", "Pro"] },',
                   '  { labelKey: "account", ids: ["Account"] },')
    report(p, "TAB_GROUPS Pro id", s2 != s)
    s = s2
    s2 = s.replace('  ProTab,\n', "", 1)
    report(p, "ProTab import", s2 != s)
    s = s2
    s2 = s.replace('  | "Pro"\n', "", 1)
    report(p, 'TabId "Pro"', s2 != s)
    s = s2
    s2 = s.replace("  Pro: Crown,\n", "", 1)
    report(p, "TAB_ICONS Pro", s2 != s)
    s = s2
    s2 = s.replace("  Crown,\n", "", 1)
    report(p, "Crown icon import", s2 != s)
    s = s2
    for pat, what in [
        (r'^\s*Pro: t\("settings\.tabs\.pro"\).*\n(?:\s+.*\n)*?', "tabLabels Pro"),
        (r'^\s*Pro:\s*$', "tabDescriptions Pro key"),
        (r'^\s*Pro: "settings\.tabs\.pro",\n', "TAB_LABEL_KEYS Pro"),
        (r'^\s*Pro: "settings\.pro\.description",\n', "TAB_DESC_KEYS Pro"),
    ]:
        s, ok = remove_entry(s, pat)
        report(p, what, ok)
    s = sub_once(s, r'\n\s*\{activeTab === "Pro" && <ProTab[^>]*/>\}',
                 "", p, "ProTab render")
    write(p, s)

    # ------------------------------------------------ ModerationTab.tsx
    p = f"{B}/features/moderation/ui/ModerationTab.tsx"
    s = read(p)
    imp = re.search(
        r'import \{\n  grantProUser,\n  listProUsers,\n  revokeProUser,\n  type ProUserInfo,\n\} from "@/features/moderation/lib/proApi";\n',
        s,
    )
    if imp:
        s = s[: imp.start()] + s[imp.end():]
        report(p, "proApi import", True)
    else:
        report(p, "proApi import", False)
    s2 = re.sub(
        r'\n  // Liner Pro grants \(approval-only tier[^\n]*\n  const \[proUsers, setProUsers\][^\n]*\n  const \[proGrantUsername, setProGrantUsername\][^\n]*\n  const \[proLoading, setProLoading\][^\n]*\n  const \[proBusy, setProBusy\][^\n]*\n',
        "\n",
        s,
        count=1,
    )
    report(p, "pro state block", s2 != s)
    s = s2
    s, ok = cut_block(s, "  const refreshPro = useCallback(async () => {")
    # the brace match ends at the callback body "}" — swallow the deps tail
    s2 = re.sub(r"^, \[t, toast\]\);\n", "", s, count=1, flags=re.M)
    report(p, "refreshPro callback", ok and s2 != s)
    s = s2
    s2 = s.replace("      void refreshPro();\n", "", 1)
    report(p, "useEffect refreshPro call", s2 != s)
    s = s2
    s2 = s.replace("        setProLoading(false);\n", "", 1)
    report(p, "useEffect setProLoading", s2 != s)
    s = s2
    s2 = s.replace("[isAdmin, refresh, refreshPro]", "[isAdmin, refresh]", 1)
    report(p, "useEffect deps", s2 != s)
    s = s2
    s2 = s.replace("listBans/listProUsers", "listBans", 1)
    report(p, "comment listProUsers", s2 != s)
    s = s2
    s2 = s.replace(
        "  const canGrantPro = normalizeUsername(proGrantUsername.trim()) !== null && !proBusy;\n",
        "",
        1,
    )
    report(p, "canGrantPro", s2 != s)
    s = s2
    for marker, what in [
        ("  const handleGrantPro = async () => {", "handleGrantPro"),
        ("  const handleRevokePro = async (username: string) => {", "handleRevokePro"),
        ("  const handleProError = (err: unknown) => {", "handleProError"),
    ]:
        s, ok = cut_block(s, marker, open_ch="{", close_ch="}")
        # body "}" matched — swallow the leftover ";" on its own line
        s2 = re.sub(r"^;\n", "", s, count=1, flags=re.M)
        report(p, what, ok and s2 != s)
        s = s2
    i = s.find("      {/* ── Liner Pro grants ── */}")
    if i >= 0:
        j = s.find("</SettingSection>", i)
        if j >= 0:
            j += len("</SettingSection>")
            # swallow one trailing newline + blank line
            while j < len(s) and s[j] in "\n ":
                if s[j] == "\n" and j + 1 < len(s) and s[j + 1] not in "\n ":
                    break
                j += 1
            s = s[:i] + s[j:]
            report(p, "Pro grants UI section", True)
        else:
            report(p, "Pro grants UI section (no close)", False)
    else:
        report(p, "Pro grants UI section (no marker)", False)
    write(p, s)

    # ------------------------------------------------ AccountTab.tsx
    p = f"{B}/features/settings/ui/tabs/AccountTab.tsx"
    s = read(p)
    s2 = s.replace(
        "if (!isAcceptableAvatarFile(file, { isPro: user.isPro === true })) {",
        "if (!isAcceptableAvatarFile(file)) {", 1)
    ok1 = s2 != s
    s = s2
    s2 = s.replace(
        "const dataUrl = await fileToAvatarDataUrl(file, {\n        isPro: user.isPro === true,\n      });",
        "const dataUrl = await fileToAvatarDataUrl(file);", 1)
    ok2 = s2 != s
    s = s2
    s2 = s.replace(
        '? "settings.profile.avatar_gif_too_large"\n', '? "settings.profile.avatar_too_large"\n', 1)
    ok3 = s2 != s
    s = s2
    # remove the PRO badge JSX block by {..} depth counting from the marker
    ok4 = False
    i = s.find("{user.isPro && (")
    if i >= 0:
        depth = 0
        k = i
        while k < len(s):
            if s[k] == "{":
                depth += 1
            elif s[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        if depth == 0:
            s = s[:i] + s[k + 1:]
            ok4 = True
    report(p, "avatar opts isPro x2 + gif key + badge", ok1 and ok2 and ok3 and ok4)
    write(p, s)

    # ------------------------------------------------ avatarImage.ts
    p = f"{B}/features/settings/lib/avatarImage.ts"
    s = read(p)
    s = s.replace(
        "// far under the compact 400k-char cap. animated GIFs are the exception: the\n// canvas re-encode below would flatten them to their first frame, so they are\n// stored byte-for-byte instead — the same bypass custom playlist covers use.\n// Liner Pro unlocks animated GIF avatars up to 30 MB (oversized data URLs are\n// served back through GET /api/avatar/[id] instead of inlined into payloads).",
        "// far under the compact 400k-char cap. animated GIFs are the exception: the\n// canvas re-encode below would flatten them to their first frame, so they are\n// stored byte-for-byte instead — the same bypass custom playlist covers use.\n// oversized data URLs are served back through GET /api/avatar/[id] instead of\n// being inlined into payloads.", 1)
    s = sub_once(s, r'// Liner Pro: animated GIF avatars up to 30 MB file size\. Base64 inflates that\n// to ~41\.94M chars; the 41\.95M data-url cap admits exactly <= 30 MB files and\n// matches the server-side cap in src/app/api/auth/profile/route\.ts\.\nconst AVATAR_PRO_GIF_INPUT_LIMIT_BYTES = 30 \* 1024 \* 1024;\nconst AVATAR_PRO_DATA_URL_LIMIT = 41_950_000;\n', "", p, "Pro constants")
    s = sub_once(s, r'\nexport interface AvatarProcessOptions \{\n  /\*\* Liner Pro: animated GIF avatars up to 30 MB \(vs ~290 KB for everyone\)\. \*/\n  isPro\?: boolean;\n\}\n', "", p, "AvatarProcessOptions")
    s = sub_once(s, r'  const isProGif = Boolean\(opts\?\.isPro\) && file\.type === "image/gif";\n  if \(file\.size > \(isProGif \? AVATAR_PRO_GIF_INPUT_LIMIT_BYTES : AVATAR_INPUT_LIMIT_BYTES\)\)\n    return false;',
                 '  if (file.size > AVATAR_INPUT_LIMIT_BYTES)\n    return false;', p, "isAcceptableAvatarFile cap")
    s = sub_once(s, r'  const isProGif = Boolean\(opts\?\.isPro\) && file\.type === "image/gif";\n  const maxInputBytes = isProGif\n    \? AVATAR_PRO_GIF_INPUT_LIMIT_BYTES\n    : AVATAR_INPUT_LIMIT_BYTES;\n  if \(file\.size > maxInputBytes\) \{',
                 '  if (file.size > AVATAR_INPUT_LIMIT_BYTES) {', p, "fileToAvatarDataUrl input cap")
    s = s.replace("export function isAcceptableAvatarFile(\n  file: File,\n  opts?: AvatarProcessOptions,\n): boolean {",
                  "export function isAcceptableAvatarFile(file: File): boolean {", 1)
    s = s.replace("export async function fileToAvatarDataUrl(\n  file: File,\n  opts?: AvatarProcessOptions,\n): Promise<string> {",
                  "export async function fileToAvatarDataUrl(file: File): Promise<string> {", 1)
    s = s.replace("// caller's cap (400k chars, or 41.95M for Liner Pro) with 413 — a longer",
                  "// server's 400k-char cap with 413 — a longer", 1)
    s = sub_once(s, r'        const gifCap = opts\?\.isPro\n          \? AVATAR_PRO_DATA_URL_LIMIT\n          : AVATAR_DATA_URL_LIMIT;\n        if \(gifDataUrl\.length > gifCap\) \{',
                 '        if (gifDataUrl.length > AVATAR_DATA_URL_LIMIT) {', p, "gif cap")
    report(p, "avatarImage rewritten", True)
    write(p, s)

    # ------------------------------------------------ avatarImage.test.ts
    p = f"{B}/features/settings/lib/avatarImage.test.ts"
    if os.path.exists(p):
        s = read(p)
        s, ok = cut_block(s, 'describe("Liner Pro GIF avatars (30 MB)"')
        report(p, "Pro test block", ok)
        s2 = s.replace(", { isPro: true }", "", 99)
        report(p, "stray isPro opts in tests", "isPro" not in s2)
        write(p, s2)

    # ------------------------------------------------ contracts/auth.ts
    p = f"{B}/shared/contracts/auth.ts"
    s = read(p)
    s2 = s.replace('  /** Liner Pro — the site owner is Pro forever; others by owner grant. */\n  isPro?: boolean;\n', "", 1)
    report(p, "isPro contract field", s2 != s)
    write(p, s2)

    # ------------------------------------------------ moderationApi.ts comment
    p = f"{B}/features/moderation/lib/moderationApi.ts"
    s = read(p)
    s2 = re.sub(r' \* Shared with the Liner Pro grants API \(proApi\.ts\) so both moderation\n \* surfaces heal identically\.\n', "", s, count=1)
    report(p, "proApi comment", s2 != s)
    write(p, s2)

    # ------------------------------------------------ changelog.ts
    p = f"{B}/features/changelog/data/changelog.ts"
    s = read(p)
    # remove the whole 1.19.0 Pro release block
    m = re.search(r'\n  \{\n    version: "1\.19\.0",', s)
    if m:
        s2, ok = cut_block(s[m.start() + 1:], 'version: "1.19.0"')
        # cut_block starts at marker; we need the preceding "  {" too
        i = m.start()
        j = s.find('version: "1.19.0"')
        # brace-match from the "{" before version:
        open_i = s.rfind("{", i, j)
        depth = 0
        k = open_i
        in_str = None
        while k < len(s):
            c = s[k]
            if in_str:
                if c == "\\":
                    k += 2
                    continue
                if c == in_str:
                    in_str = None
            elif c in '"`':
                in_str = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        if depth == 0:
            # also swallow the trailing comma+newline
            end = k + 1
            if s[end:end+1] == ",":
                end += 1
            if s[end:end+1] == "\n":
                end += 1
            s = s[:i] + s[end:]
            ok = True
        else:
            ok = False
        report(p, "1.19.0 Pro release block", ok)
    else:
        report(p, "1.19.0 Pro release block (missing)", False)
    s2 = s.replace('title: "Liquid glass, Liner Pro grants, alternate lyrics"',
                   'title: "Liquid glass, alternate lyrics"', 1)
    report(p, "1.20.0 title", s2 != s)
    s = s2
    # remove the Liner Pro entry inside 1.20.0
    t = s.find('text: "Liner Pro is now a real tier')
    if t >= 0:
        open_i = s.rfind("{", 0, t)
        depth = 0
        k = open_i
        in_str = None
        while k < len(s):
            c = s[k]
            if in_str:
                if c == "\\":
                    k += 2
                    continue
                if c == in_str:
                    in_str = None
            elif c in '"`':
                in_str = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        end = k + 1
        if s[end:end+1] == ",":
            end += 1
        if s[end:end+1] == "\n":
            end += 1
        # also swallow leading indentation + newline of the entry
        lead = s.rfind("\n", 0, open_i)
        s = s[:lead] + s[end:]
        report(p, "1.20.0 Pro entry", True)
    else:
        report(p, "1.20.0 Pro entry (missing)", False)
    write(p, s)

# ---------------------------------------------------------------- locales
KEYS_MOD_PRO = re.compile(r"^pro_")


def clean_locale(p):
    with open(p, encoding="utf-8") as f:
        raw = f.read()
    indent = 2
    m = re.search(r'\n(\s+)"', raw)
    if m:
        indent = len(m.group(1))
    try:
        data = json.loads(raw)
    except Exception as e:
        report(p, f"json parse ({e})", False)
        return
    removed = []

    settings = data.get("settings", {})
    if "pro" in settings:
        del settings["pro"]
        removed.append("settings.pro")
    tabs = settings.get("tabs", {})
    if "pro" in tabs:
        del tabs["pro"]
        removed.append("settings.tabs.pro")
    prof = settings.get("profile", {})
    if "avatar_gif_too_large" in prof:
        del prof["avatar_gif_too_large"]
        removed.append("settings.profile.avatar_gif_too_large")
    mod = settings.get("moderation", {})
    for k in [k for k in mod if KEYS_MOD_PRO.match(k)]:
        del mod[k]
        removed.append(f"settings.moderation.{k}")
    report(p, f"removed {len(removed)} key groups", "Liner Pro" not in json.dumps(data, ensure_ascii=False))
    out = json.dumps(data, ensure_ascii=False, indent=indent) + "\n"
    write(p, out)


LOCALE_DIRS = [
    "src/languages/locales",
    "src-classic/languages/locales",
]
for d in LOCALE_DIRS:
    for fn in sorted(os.listdir(os.path.join(APP, d))):
        if fn.endswith(".json"):
            clean_locale(os.path.join(APP, d, fn))

# ---------------------------------------------------------------- web-beta changelog.json
p = os.path.join(APP, "web-beta/changelog.json")
with open(p, encoding="utf-8") as f:
    raw = f.read()
data = json.loads(raw)
kept = []
for rel in data:
    ents = [e for e in rel.get("entries", []) if "Liner Pro" not in e.get("text", "")]
    if ents:
        kept.append({**rel, "entries": ents})
report(p, f"releases {len(data)} -> {len(kept)}", len(kept) < len(data))
out = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
if raw.endswith("\n"):
    out += "\n"
write(p, out)
report(p, "no Liner Pro strings left", "Liner Pro" not in out)

# ---------------------------------------------------------------- summary
print("\n".join(notes))
print()
if failures:
    print("FAILURES:")
    print("\n".join(failures))
    sys.exit(1)
print("ALL CLEAN")
