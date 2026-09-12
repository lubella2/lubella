#!/usr/bin/env python3
"""
Generates the PWA icon set and favicon from the brand palette.

Kept as a script (rather than committed binaries) so the marks can be
regenerated whenever the logo changes:  python3 scripts/make_icons.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

ROSE = (209, 128, 154)
DEEP = (185, 100, 130)
BLUSH = (251, 237, 243)
WHITE = (255, 255, 255)


def leaf(draw, base, angle_deg, length, width, colour):
    """
    A single leaf: a lens shape, pointed at both tips, rotated about its base.

    Sampled as two mirrored curves so the widest point sits about 40% along the
    leaf, which is what makes it read as a leaf rather than an ellipse.
    """
    import math
    steps = 30
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        taper = math.sin(math.pi * (t ** 0.82)) ** 0.9
        x = t * length
        y = width * taper
        left.append((x, -y))
        right.append((x, y))
    outline = left + list(reversed(right))
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    bx, by = base
    pts = [(bx + x * cos_a - y * sin_a, by + x * sin_a + y * cos_a) for x, y in outline]
    draw.polygon(pts, fill=colour)


def make_icon(size, maskable=False):
    img = Image.new('RGBA', (size, size), ROSE + (255,))
    d = ImageDraw.Draw(img)
    # soft blush plate behind the mark for depth
    pad = int(size * (0.22 if maskable else 0.14))
    d.rounded_rectangle([pad, pad, size - pad, size - pad],
                        radius=int(size * 0.22), fill=BLUSH + (255,))

    c = size / 2
    unit = size * (0.24 if maskable else 0.29)

    # Three leaves springing from one point, echoing the logo's sprig.
    base = (c, c + unit * 0.62)
    leaf(d, base, -90, unit * 1.52, unit * 0.30, ROSE)    # centre leaf
    leaf(d, base, -152, unit * 1.10, unit * 0.26, DEEP)   # left leaf
    leaf(d, base, -28, unit * 1.10, unit * 0.26, DEEP)    # right leaf
    # short stem below the join
    d.line([base, (base[0], base[1] + unit * 0.34)],
           fill=ROSE, width=max(2, int(size * 0.020)))
    # rounded ends on the stem so it does not look chopped
    r = max(1, int(size * 0.010))
    d.ellipse([base[0] - r, base[1] + unit * 0.34 - r, base[0] + r, base[1] + unit * 0.34 + r], fill=ROSE)
    return img


for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'),
                   (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
    make_icon(size).save(os.path.join(OUT, name))
    print('wrote', name)

# maskable icon gets extra safe-area padding for Android's circular crop
make_icon(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('wrote icon-maskable-512.png')

# favicon.ico (multi-size)
make_icon(64).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('wrote favicon.ico')
