#!/usr/bin/env bash
# Fill the owner-secret slots in the gitignored /home/z/my-project/.env.
#
# Values arrive as environment variables (OWNER_*), so THIS SCRIPT FILE never
# contains, prints, or logs any secret material — it can be safely committed.
# It uncomments the "# VAR=" placeholder slots left by restore_deploy_env.sh /
# rearm_deploy_chain_v2.sh and fills them; existing non-secret keys are kept.
# Never echoes values — only key names.
set -euo pipefail
cd /home/z/my-project
umask 077
[ -f .env ] || { echo ".env missing — run restore_deploy_env.sh first"; exit 1; }

python3 - <<'PY'
import os, re
path = ".env"
fills = {
    "DISCORD_CLIENT_SECRET": os.environ.get("OWNER_DISCORD_SECRET", "").strip(),
    "SMTP_USER": os.environ.get("OWNER_SMTP_USER", "").strip(),
    "SMTP_PASS": os.environ.get("OWNER_SMTP_PASS", "").strip(),
    "LINER_SERVICE_EMAIL": os.environ.get("OWNER_LINER_EMAIL", "").strip(),
    "LINER_SERVICE_PASS": os.environ.get("OWNER_LINER_PASS", "").strip(),
}
lines = open(path).read().splitlines()
out, seen = [], set()
for ln in lines:
    m = re.match(r"^#\s*([A-Za-z_][A-Za-z0-9_]*)=", ln)   # commented placeholder slot
    m2 = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", ln)       # already-uncommented line
    key = m.group(1) if m else (m2.group(1) if m2 else None)
    if key in fills and fills[key]:
        out.append(f"{key}={fills[key]}")
        seen.add(key)
    else:
        out.append(ln)
for k, v in fills.items():
    if v and k not in seen:
        out.append(f"{k}={v}")
open(path, "w").write("\n".join(out) + "\n")
filled = sorted(k for k in fills if fills[k])
print("filled slots:", ", ".join(filled))
PY

chmod 600 .env
echo "key names now (values never printed):"
grep -vE '^\s*#' .env | cut -d= -f1 | grep -v '^$' | tr '\n' ' '; echo
