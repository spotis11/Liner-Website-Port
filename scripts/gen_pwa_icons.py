#!/usr/bin/env python3
"""Generate the PWA icon set for the Liner web app from public/liner/icon.png.

Outputs (into liner-app/public/, shipped as /liner/icon-*.png):
  - icon-192.png        any-purpose 192x192
  - icon-512.png        any-purpose 512x512
  - icon-maskable-192.png / icon-maskable-512.png  maskable with a safe zone
"""
from PIL import Image
import os

SRC = "/home/z/my-project/liner-app/public/icon.png"
OUT_DIR = "/home/z/my-project/liner-app/public"

im = Image.open(SRC).convert("RGBA")
print("source:", im.size, im.mode)

# sample the corners/edges for a background fill color (maskable padding)
w, h = im.size
edge_colors = [im.getpixel((x, y)) for x, y in [
    (2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3), (w // 2, 2), (w // 2, h - 3)
]]
print("edge colors:", edge_colors)

opaque = [(r, g, b) for (r, g, b, a) in edge_colors if a > 200]
if opaque:
    bg = tuple(sum(c[i] for c in opaque) // len(opaque) for i in range(3))
else:
    bg = (10, 10, 12)
print("maskable bg:", bg)


def save(size, name):
    out = im.resize((size, size), Image.LANCZOS)
    out.save(os.path.join(OUT_DIR, name), optimize=True)
    print("wrote", name, out.size)


def save_maskable(size, name, fill_ratio=0.78):
    """Pad the artwork into the maskable safe zone on a solid bg tile."""
    canvas = Image.new("RGBA", (size, size), bg + (255,))
    inner = int(size * fill_ratio)
    art = im.resize((inner, inner), Image.LANCZOS)
    offset = ((size - inner) // 2, (size - inner) // 2)
    canvas.alpha_composite(art, offset)
    canvas.save(os.path.join(OUT_DIR, name), optimize=True)
    print("wrote", name, canvas.size)


save(512, "icon-512.png")
save(192, "icon-192.png")
save_maskable(512, "icon-maskable-512.png")
save_maskable(192, "icon-maskable-192.png")
print("done")
