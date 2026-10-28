#!/usr/bin/env python3
"""Vendor real brand logos into the AI Translate feature.

Sources:
- google-translate.svg / gemini.svg  -> official colored logos (Wikimedia Commons)
- openrouter/openai/claude/ollama    -> official brand glyphs (simple-icons npm)

Normalization: strip <title>, drop width/height (CSS sizes them), make the
monochrome glyphs theme-adaptive via fill="currentColor" (Claude gets its
official brand orange #D97757).
"""

import re
import shutil
from pathlib import Path

SRC = Path("/tmp/logos_dl")
DST = Path(
    "/home/z/my-project/liner-app/src/features/lyrics/aiTranslate/logos"
)

# simple-icons glyph -> fill strategy
GLYPHS = {
    "openrouter.svg": "currentColor",
    "openai.svg": "currentColor",
    "claude.svg": "#D97757",  # official Claude brand orange
    "ollama.svg": "currentColor",
}


def normalize(svg: str, fill: str | None) -> str:
    # strip title tags (tooltip pollution)
    svg = re.sub(r"<title>.*?</title>\s*", "", svg, flags=re.S)
    # drop hardcoded width/height — the wrapper CSS sizes the icon
    svg = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"', r"\1", svg, count=1)
    svg = re.sub(r'(<svg\b[^>]*?)\sheight="[^"]*"', r"\1", svg, count=1)
    # monochrome glyphs: force adaptive fill on the root
    if fill:
        if "fill=" in re.search(r"<svg\b[^>]*>", svg).group(0):
            svg = re.sub(r"(<svg\b[^>]*?)\sfill=\"[^\"]*\"", r"\1", svg, count=1)
        svg = re.sub(r"<svg\b", f'<svg fill="{fill}"', svg, count=1)
    # tidy whitespace
    svg = re.sub(r"\n\s*\n", "\n", svg).strip()
    if not svg.endswith("\n"):
        svg += "\n"
    return svg


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for name in GLYPHS:
        raw = (SRC / name).read_text()
        (DST / name).write_text(normalize(raw, GLYPHS[name]))
        print(f"{name}: {len(raw)} -> {len((DST / name).read_text())} bytes")

    for name in ("google-translate-official.svg", "gemini-official.svg"):
        out = name.replace("-official", "")
        raw = (SRC / name).read_text()
        (DST / out).write_text(normalize(raw, None))
        print(f"{out}: {len(raw)} -> {len((DST / out).read_text())} bytes (official colors kept)")

    shutil.copy(SRC / "openrouter.svg", DST / ".keep-src-openrouter")
    (DST / ".keep-src-openrouter").unlink()
    print("done ->", DST)


if __name__ == "__main__":
    main()
