#!/usr/bin/env python3
"""
LuBella  |  Rebuild every brand asset from the shop's real logo.

    python3 scripts/make_brand_assets.py

Source of truth:  docs/brand/lubella-logo-source.webp
                  (the shop's logo, as supplied — pale pink background, pink
                   script wordmark with a leaf sprig above, grey strapline)

Outputs
-------
  app/public/brand/lubella-logo.png        transparent lockup (leaf + wordmark + strapline)
  app/public/brand/lubella-mark.png        the leaf alone, transparent
  app/public/icons/icon-192.png            app icon
  app/public/icons/icon-512.png            app icon (install prompt, splash)
  app/public/icons/icon-maskable-512.png   Android adaptive icon (extra padding)
  app/public/icons/apple-touch-icon.png    180px, opaque background (iOS)
  app/public/icons/favicon-32.png          browser tab
  app/public/icons/favicon.ico             legacy favicon

The background is removed with a soft alpha ramp, so the anti-aliased edges of
the script lettering stay smooth instead of turning into a hard outline.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "app" / "public" / "brand"
ICONS = ROOT / "app" / "public" / "icons"

SRC = ROOT / "docs" / "brand" / "lubella-logo-source.webp"

# Brand tokens (docs/01-BRAND.md)
BLUSH_SOFT = (253, 246, 249, 255)   # #FDF6F9 page background
BLUSH = (251, 237, 243, 255)        # #FBEDF3 card / maskable background


def cut_background(img: Image.Image, inner: int = 26, outer: int = 58) -> Image.Image:
    """Make the flat background transparent, keeping smooth edges.

    Pixels close to the background colour become fully transparent; pixels far
    from it stay opaque; the band between gets a proportional alpha.
    """
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    bg = px[3, 3][:3]

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            distance = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if distance <= inner:
                px[x, y] = (r, g, b, 0)
            elif distance < outer:
                alpha = int(round(255 * (distance - inner) / (outer - inner)))
                px[x, y] = (r, g, b, min(a, alpha))
    return img


def trimmed(img: Image.Image, threshold: int = 8) -> Image.Image:
    """Trim fully transparent margins."""
    alpha = img.getchannel("A").point(lambda v: 255 if v > threshold else 0)
    box = alpha.getbbox()
    return img.crop(box) if box else img


def blank_bands(img: Image.Image, min_height: int) -> list[tuple[int, int]]:
    """Rows of empty space at least `min_height` tall, as (start, end) pairs."""
    alpha = img.getchannel("A")
    w, h = img.size
    empty = [alpha.crop((0, y, w, y + 1)).getextrema()[1] <= 8 for y in range(h)]

    bands, start = [], None
    for y in range(h):
        if empty[y] and start is None:
            start = y
        elif not empty[y] and start is not None:
            if y - start >= min_height:
                bands.append((start, y))
            start = None
    if start is not None and h - start >= min_height:
        bands.append((start, h))
    return bands


def split_parts(lockup: Image.Image) -> dict[str, Image.Image]:
    """Cut the artwork at its blank bands: leaf | wordmark | strapline."""
    w, h = lockup.size
    gap = max(6, h // 40)
    bands = blank_bands(lockup, gap)

    cuts = [0] + [end for _, end in bands]
    parts = []
    for i, top in enumerate(cuts):
        bottom = bands[i][0] if i < len(bands) else h
        piece = trimmed(lockup.crop((0, top, w, bottom)))
        if piece.height > 0:
            parts.append(piece)

    mark = parts[0] if parts else lockup
    wordmark = trimmed(lockup.crop((0, 0, w, bands[1][0]))) if len(bands) > 1 else lockup
    return {"mark": mark, "compact": wordmark, "full": lockup}


def contain(img: Image.Image, size: int, background, padding: float) -> Image.Image:
    """Centre `img` on a square canvas with proportional padding."""
    canvas = Image.new("RGBA", (size, size), background)
    inner = int(size * (1 - 2 * padding))
    scale = min(inner / img.width, inner / img.height)
    resized = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))),
                         Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source logo: {SRC}")

    source = Image.open(SRC)
    print(f"· source: {SRC.name} {source.width}×{source.height} {source.format}")

    cut = cut_background(source)
    lockup = trimmed(cut)
    lockup.save(BRAND / "lubella-logo.png")
    print(f"· brand/lubella-logo.png  {lockup.width}×{lockup.height} (transparent)")

    parts = split_parts(lockup)
    parts["mark"].save(BRAND / "lubella-mark.png")
    print(f"· brand/lubella-mark.png  {parts['mark'].width}×{parts['mark'].height} (the leaf alone)")
    parts["compact"].save(BRAND / "lubella-logo-compact.png")
    print(f"· brand/lubella-logo-compact.png  {parts['compact'].width}×{parts['compact'].height} (leaf + wordmark)")

    # Icons: the lockup where it can be read, the mark where it cannot.
    for size, name, bg, pad in (
        (512, "icon-512.png", BLUSH_SOFT, 0.10),
        (192, "icon-192.png", BLUSH_SOFT, 0.12),
        (512, "icon-maskable-512.png", BLUSH, 0.24),   # adaptive icons need the safe zone
        (180, "apple-touch-icon.png", BLUSH_SOFT, 0.12),
    ):
        contain(lockup, size, bg, pad).convert("RGB").save(ICONS / name)
        print(f"· icons/{name}  {size}×{size}")

    contain(parts["mark"], 32, BLUSH_SOFT, 0.06).convert("RGB").save(ICONS / "favicon-32.png")
    ico = contain(parts["mark"], 64, BLUSH_SOFT, 0.06).convert("RGB")
    ico.save(ICONS / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("· icons/favicon-32.png + favicon.ico")


if __name__ == "__main__":
    main()
