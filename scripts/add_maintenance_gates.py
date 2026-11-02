#!/usr/bin/env python3
"""Insert the maintenance gate at the top of every exported HTTP handler
(except OPTIONS preflights) in the playback/data-plane API routes.

Idempotent: files already importing maintenanceGate are skipped.
"""
import re
import sys
from pathlib import Path

API = Path("/home/z/my-project/src/app/api")

TARGETS = [
    "ai-translate/route.ts",
    "fetch/route.ts",
    "history/route.ts",
    "likes/route.ts",
    "media/route.ts",
    "music/trending/route.ts",
    "music/playlists-trending/route.ts",
    "music/search/route.ts",
    "music/underground/route.ts",
    "music/track/[id]/route.ts",
    "music/artist/[id]/route.ts",
    "music/playlist/[id]/route.ts",
    "music/stream/[id]/route.ts",
    "playlists/route.ts",
    "playlists/[id]/route.ts",
    "po-token/route.ts",
    "sc/[...path]/route.ts",
    "youtube/tv-session/route.ts",
    "yt/[...path]/route.ts",
    "yt/sabr/route.ts",
    "yt/www/[...path]/route.ts",
]

HANDLER_RE = re.compile(r"^export async function ([A-Z][A-Za-z]*)\(")
IMPORT_LINE = 'import { maintenanceGate } from "@/lib/maintenance";'
GATE = "  const gate = await maintenanceGate();\n  if (gate) return gate;\n"

changed = skipped = 0
for rel in TARGETS:
    path = API / rel
    if not path.exists():
        print(f"MISSING: {rel}")
        continue
    src = path.read_text()
    if "maintenanceGate" in src:
        skipped += 1
        continue
    lines = src.split("\n")
    # 1) import after the last existing top-level import line
    import_idx = max(i for i, l in enumerate(lines) if l.startswith("import "))
    lines.insert(import_idx + 1, IMPORT_LINE)
    # 2) gate at the top of each non-OPTIONS handler body
    out = []
    i = 0
    gated_handlers = []
    while i < len(lines):
        line = out and lines[i] or lines[i]
        m = HANDLER_RE.match(line)
        if m and m.group(1) != "OPTIONS":
            out.append(line)
            if line.rstrip().endswith("{"):
                out.append(GATE.rstrip("\n"))
                gated_handlers.append(m.group(1))
            else:
                # multi-line signature: find the standalone opening brace
                j = i + 1
                while j < len(lines) and not lines[j].strip() == "{":
                    out.append(lines[j])
                    j += 1
                if j < len(lines):
                    out.append(lines[j])  # the "{" line
                    out.append(GATE.rstrip("\n"))
                    gated_handlers.append(m.group(1))
                    i = j
        else:
            out.append(line)
        i += 1
    path.write_text("\n".join(out))
    changed += 1
    print(f"GATED {rel}: {', '.join(gated_handlers)}")

print(f"\ndone: {changed} changed, {skipped} skipped")
sys.exit(0)
