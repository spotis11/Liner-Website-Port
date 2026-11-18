#!/usr/bin/env python3
"""Human-check fallback pass: "Try without verification" + honest guidance.

- en.json (both trees): reword failed/failed_domain, add try_without
- humanCheck.ts (both): "" resolution = user declined the widget -> proceed
  token-less once, with a 60s decline flag so the TURNSTILE_REQUIRED
  auto-recovery doesn't re-prompt immediately
- humanCheckStore.ts (both): skip() action resolving ""
- HumanCheckNotice.tsx (both): failed phase gets the try-without button
- api.ts (both): guard the auto-recovery with the decline flag
"""
import json, re, sys

ROOT = "/home/z/my-project/liner-app"

FAILED_NEW = (
    "The check didn't load or was closed before it finished. An ad-blocker or "
    "privacy extension can block it — try an incognito window with extensions "
    "off, or try again."
)
FAILED_DOMAIN_NEW = (
    "Liner's provider is blocking this network from loading the verification "
    "page (it showed \"you have been blocked\"). Try a different network or a "
    "VPN just for this one-time check — or email Liner support with the Cloudflare "
    "Ray ID shown in that popup. Sign-in may also simply work if you retry later: "
    "Liner only sometimes requires this check."
)
TRY_WITHOUT = "Try without verification"


def patch_json(path):
    d = json.load(open(path, encoding="utf-8"))
    hc = d.get("human_check")
    if hc is None:
        print(f"  !! no human_check in {path}")
        return
    hc["failed"] = FAILED_NEW
    hc["failed_domain"] = FAILED_DOMAIN_NEW
    hc["try_without"] = TRY_WITHOUT
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  ok {path}")


def patch_humancheck(path):
    s = open(path, encoding="utf-8").read()
    if "markHumanCheckDeclined" in s:
        print(f"  skip {path} (already patched)")
        return
    old = """export async function runHumanCheck(
  action: HumanCheckAction,
  mode: HumanCheckMode,
): Promise<string | undefined> {
  if (mode === "off") return undefined;
  const token = prompt ? await prompt({ action, mode }) : null;
  if (token) return token;
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}"""
    new = """// the user chose "Try without verification" — remember it for a short
// window so a following TURNSTILE_REQUIRED answer doesn't re-open the
// check dialog in a loop
let declinedUntil = 0;

export function markHumanCheckDeclined() {
  declinedUntil = Date.now() + 60_000;
}

export function isHumanCheckDeclined(): boolean {
  return Date.now() < declinedUntil;
}

export async function runHumanCheck(
  action: HumanCheckAction,
  mode: HumanCheckMode,
): Promise<string | undefined> {
  if (mode === "off") return undefined;
  const token = prompt ? await prompt({ action, mode }) : null;
  if (token === "") {
    // explicit "try without verification" — not a cancel
    markHumanCheckDeclined();
    return undefined;
  }
  if (token) return token;
  if (mode === "required") throw new HumanCheckCancelledError();
  return undefined;
}"""
    assert old in s, f"runHumanCheck shape mismatch in {path}"
    s = s.replace(old, new)
    open(path, "w", encoding="utf-8").write(s)
    print(f"  ok {path}")


def patch_store(path):
    s = open(path, encoding="utf-8").read()
    if "skip: () =>" in s:
        print(f"  skip {path} (already patched)")
        return
    old_iface = "  cancel: () => void;\n}"
    new_iface = "  cancel: () => void;\n  skip: () => void;\n}"
    assert old_iface in s, f"interface shape mismatch in {path}"
    s = s.replace(old_iface, new_iface, 1)
    old_cancel = """  cancel: () => {
    set({ request: null });
    finish(null);
  },"""
    new_cancel = old_cancel + """

  // "Try without verification" — resolve with "" so the caller proceeds
  // without a token (upstream only sometimes enforces the check)
  skip: () => {
    set({ request: null });
    finish("");
  },"""
    assert old_cancel in s, f"cancel shape mismatch in {path}"
    s = s.replace(old_cancel, new_cancel, 1)
    open(path, "w", encoding="utf-8").write(s)
    print(f"  ok {path}")


def patch_notice(path):
    s = open(path, encoding="utf-8").read()
    if "try_without" in s:
        print(f"  skip {path} (already patched)")
        return
    # hook the store's skip
    m = re.search(r"const cancel = useHumanCheckStore\(\(state\) => state\.cancel\);", s)
    assert m, f"cancel hook not found in {path}"
    s = s.replace(m.group(0), m.group(0) + "\n  const skip = useHumanCheckStore((state) => state.skip);", 1)
    # insert the try-without text button right before the closing of the buttons row
    marker = "</div>\n        </motion.div>"
    if marker not in s:
        marker = "          </div>\n        </motion.div>"
    assert marker in s, f"buttons-row marker not found in {path}"
    button = """
          {!failed ? null : (
            <button
              type="button"
              onClick={skip}
              className="mt-[8px] text-[13px] font-[500] text-text-secondary underline-offset-2 transition-colors hover:text-text-primary hover:underline"
            >
              {t("human_check.try_without")}
            </button>
          )}"""
    s = s.replace(marker, button + "\n" + "        " + marker.strip(), 1)
    open(path, "w", encoding="utf-8").write(s)
    print(f"  ok {path}")


def patch_api(path):
    s = open(path, encoding="utf-8").read()
    if "isHumanCheckDeclined" in s:
        print(f"  skip {path} (already patched)")
        return
    # import
    m = re.search(r"(\n  runHumanCheck,)", s)
    if m:
        s = s.replace(m.group(1), "\n  isHumanCheckDeclined,\n  runHumanCheck,", 1)
    else:
        # humanCheck is imported via namespace or named block; find the named import containing runHumanCheck
        m2 = re.search(r"import \{([^}]*)\} from \"(@?/?[^\"]*humanCheck[^\"]*)\";", s)
        assert m2, f"humanCheck import not found in {path}"
        inner = m2.group(1)
        if "runHumanCheck" not in inner:
            inner = inner.rstrip() + ",\n  isHumanCheckDeclined,\n"
            s = s.replace(m2.group(0), f"import {{{inner}}} from \"{m2.group(2)}\";", 1)
        else:
            inner2 = inner.replace("runHumanCheck,", "isHumanCheckDeclined,\n  runHumanCheck,", 1)
            s = s.replace(m2.group(0), f"import {{{inner2}}} from \"{m2.group(2)}\";", 1)
    # guard the recovery
    old = """    if (
      error instanceof ApiError &&
      (error.code === "TURNSTILE_REQUIRED" || error.code === "TURNSTILE_INVALID")
    ) {
      const token = await runHumanCheck(purpose, "required");
      if (token) return send({ ...proof, turnstile: token });
    }"""
    new = """    if (
      error instanceof ApiError &&
      (error.code === "TURNSTILE_REQUIRED" || error.code === "TURNSTILE_INVALID")
    ) {
      // respect an explicit "try without verification" — don't loop the dialog
      if (!isHumanCheckDeclined()) {
        const token = await runHumanCheck(purpose, "required");
        if (token) return send({ ...proof, turnstile: token });
      }
    }"""
    assert old in s, f"recovery shape mismatch in {path}"
    s = s.replace(old, new, 1)
    open(path, "w", encoding="utf-8").write(s)
    print(f"  ok {path}")


for tree, alias in (("src", "@/shared"), ("src-classic", "@classic/shared")):
    print(f"[{tree}]")
    patch_json(f"{ROOT}/{tree}/languages/locales/en.json")
    patch_humancheck(f"{ROOT}/{tree}/shared/api/humanCheck.ts")
    patch_store(f"{ROOT}/{tree}/features/human-check/store/humanCheckStore.ts")
    patch_notice(f"{ROOT}/{tree}/features/human-check/ui/HumanCheckNotice.tsx")
    patch_api(f"{ROOT}/{tree}/shared/api/api.ts")

print("DONE")
