#!/usr/bin/env python3
"""Resolve v0.2.11 merge conflicts — batch 1: entry, languages, settings, lyrics."""
import re, sys, pathlib

ROOT = pathlib.Path("/home/z/my-project/liner-app")

def load(f):
    return (ROOT / f).read_text(encoding="utf-8")

def save(f, s):
    (ROOT / f).write_text(s, encoding="utf-8")

def from_conflict(f):
    """use the .conflict twin as the working copy"""
    c = ROOT / (f + ".conflict")
    if c.exists():
        save(f, c.read_text(encoding="utf-8"))
        c.unlink()

def resolve(f, content):
    save(f, content)
    print(f"resolved {f}")

# ---------------------------------------------------------------- App.tsx
f = "src/app/App.tsx"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
import { ConnectivityWall } from "@/features/connectivity";
import { useThemeCustomizationSync, useAppearanceSync } from "@/features/settings";
=======
import { ConnectionIssueModal } from "@/features/connectivity";
import { useThemeCustomizationSync } from "@/features/settings";
>>>>>>> theirs""",
"""import { ConnectionIssueModal } from "@/features/connectivity";
import { useThemeCustomizationSync, useAppearanceSync } from "@/features/settings";""")
s = s.replace("""<<<<<<< ours
  return null;
}

function AppearanceSync() {
  useAppearanceSync();
=======
>>>>>>> theirs""",
"""  return null;
}

function AppearanceSync() {
  useAppearanceSync();
""")
s = s.replace("""<<<<<<< ours
                  <ConnectivityWall />
                  <BanGate />
                  <WelcomeGate />
=======
                  <ConnectionIssueModal />
>>>>>>> theirs""",
"""                  <ConnectionIssueModal />
                  <BanGate />
                  <WelcomeGate />""")
resolve(f, s)

# ---------------------------------------------------------------- routes.tsx
f = "src/app/routes.tsx"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
import LocalMusicPage from "@/features/local-music/ui/LocalMusicPage";
import DownloadsPage from "@/features/downloads/ui/DownloadsPage";
=======
import { FullscreenRouteContext } from "@/features/navigation/fullscreenRouteContext";""",
"""import LocalMusicPage from "@/features/local-music/ui/LocalMusicPage";
import DownloadsPage from "@/features/downloads/ui/DownloadsPage";
import { FullscreenRouteContext } from "@/features/navigation/fullscreenRouteContext";""")
resolve(f, s)  # remaining conflict(s) handled below after inspecting

# ---------------------------------------------------------------- RightDrawer
f = "src/features/navigation/ui/RightDrawer.tsx"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
    <div
      className="relative flex flex-col h-full w-full overflow-hidden rounded-[14px] select-none bg-bg-glass backdrop-blur-[48px]"
      style={drawerStyle}
    >
=======
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-[14px] select-none bg-bg-glass backdrop-blur-[48px]">
>>>>>>> theirs""",
"""    <div
      className="relative flex flex-col h-full w-full overflow-hidden rounded-[14px] select-none bg-bg-glass backdrop-blur-[48px]"
      style={drawerStyle}
    >""")
resolve(f, s)

# ---------------------------------------------------------------- settings/index
f = "src/features/settings/index.ts"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
export * from "./store/appearanceStore";
export * from "./hooks/useThemeCustomizationSync";
export * from "./hooks/useAppearanceSync";
=======
export * from "./hooks/useThemeCustomizationSync";
>>>>>>> theirs""",
"""export * from "./store/appearanceStore";
export * from "./hooks/useThemeCustomizationSync";
export * from "./hooks/useAppearanceSync";""")
resolve(f, s)

# ---------------------------------------------------------------- languages/data
f = "src/languages/data.ts"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
import tl from "./locales/tl.json";
=======
>>>>>>> theirs""", 'import tl from "./locales/tl.json";')
s = s.replace("""<<<<<<< ours
  tl,
=======
>>>>>>> theirs""", "  tl,")
resolve(f, s)

# ---------------------------------------------------------------- languages/locale
f = "src/languages/locale.ts"
from_conflict(f)
s = load(f)
s = s.replace("""<<<<<<< ours
  "tl",
=======
>>>>>>> theirs""", '  "tl",')
resolve(f, s)

# ---------------------------------------------------------------- lyrics/index
f = "src/features/lyrics/index.ts"
from_conflict(f)
s = load(f)
s = re.sub(
    r"<<<<<<< ours\n(// AI lyrics translation.*?from \"\./aiTranslate\";)\n=======\n(export \{\n  LyricsCanvasRenderer.*?\} from \"\./canvas/lyricsCanvasRenderer\";)\n>>>>>>> theirs\n",
    r"\1\n\n\2\n",
    s,
    flags=re.S,
)
resolve(f, s)
print("batch 1 done")
