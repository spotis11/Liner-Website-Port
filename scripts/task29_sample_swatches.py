#!/usr/bin/env python3
"""Sample swatch gradient colors from the Appearance screenshot (Task: color themes)."""
from PIL import Image

img = Image.open('/home/z/my-project/upload/pasted_image_1793086015861.png').convert('RGB')
W, H = img.size

# 8-column grid; estimate column centers and swatch vertical spans per row
cols = [108, 180, 252, 324, 396, 468, 540, 612]
rows = {
    'row1': (208, 268),
    'row2': (295, 352),
    'row3': (390, 442),
    'row4': (475, 524),
}
names = [
    ['Light', 'Black', 'CherryPopL', 'ElectricDreamL', 'OceanFML', 'MatchaL', 'GoldenHourL', 'CottonCandyL'],
    ['MistyBlue', 'Lavender', 'CoralBloom', 'MintBreeze', 'LemonCream', 'Rosewood', 'CherryPopD', 'ElectricDreamD'],
    ['OceanFMD', 'MatchaD', 'GoldenHourD', 'CottonCandyD', 'MidnightBlue', 'TealLagoon', 'RubyVelvet', 'SolarFlare'],
    ['FrostedSilver', 'ForestGlow'],
]

def hexc(px):
    return '#%02x%02x%02x' % px

for rname, (top, bot) in rows.items():
    row = names[list(rows).index(rname)]
    for i, cx in enumerate(cols):
        if i >= len(row):
            continue
        ytop, ybot = top + 8, bot - 10
        x = cx - (12 if row[i] == 'SolarFlare' else 0)  # dodge the check icon
        c1 = img.getpixel((x, ytop))
        c2 = img.getpixel((x, ybot))
        print(f"{row[i]:>16}  top={hexc(c1)}  bottom={hexc(c2)}")
