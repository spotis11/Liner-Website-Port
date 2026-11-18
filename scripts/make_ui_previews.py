"""Build the two UI-design preview thumbnails for the Appearance tab.

- original: user-provided screenshot of the classic library page
- new: user-provided screenshot of the 0.2.12 redesign library page, with the
  toast banners (Electron warning / network error) blurred out since they are
  test-environment artifacts, not part of the design.

Both are cropped to the same 16:10 frame (left-aligned so the sidebar stays),
resized to 640x400 and written into liner-app/public/ as JPEGs so both the
classic tree and the merged redesign tree reference one shared copy.
"""

from PIL import Image, ImageFilter

UPLOAD = "/home/z/my-project/upload"
OUT = "/home/z/my-project/liner-app/public"

JOBS = [
    # (source, output, banner-blur rect or None)
    (f"{UPLOAD}/pasted_image_1794992835302.png", f"{OUT}/ui-preview-original.jpg", None),
    (f"{UPLOAD}/pasted_image_1794990825934.png", f"{OUT}/ui-preview-new.jpg", (350, 4, 950, 92)),
]

for src, dst, blur in JOBS:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    if blur:
        region = im.crop(blur).filter(ImageFilter.GaussianBlur(14))
        im.paste(region, (blur[0], blur[1]))
    # normalize to 16:10 by cropping width (keep left edge: sidebar + content)
    target_w = round(h * 1.6)
    if target_w <= w:
        im = im.crop((0, 0, target_w, h))
    else:  # too narrow: crop height instead
        target_h = round(w / 1.6)
        im = im.crop((0, 0, w, min(h, target_h)))
    im = im.resize((640, 400), Image.LANCZOS)
    im.save(dst, "JPEG", quality=82, optimize=True)
    print(dst, im.size)
