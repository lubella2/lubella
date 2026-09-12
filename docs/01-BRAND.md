# LuBella Cosmetics & Accessories — Brand System

Derived directly from the supplied logo (`uploads/21442404acede0bb6c3c9f85adedc3b6.webp`),
sampled from the actual pixels of the artwork.

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `brand.rose` | `#D1809A` | Primary. Logo wordmark pink, primary buttons, active nav, POS accents |
| `brand.rose-deep` | `#B96482` | Hover/pressed states, headings on tinted panels |
| `brand.blush` | `#FBEDF3` | App background, card tint, customer portal hero |
| `brand.blush-soft` | `#FDF6F9` | Zebra rows, subtle section backgrounds |
| `brand.charcoal` | `#4A4A4A` | Logo strapline grey. Body text, table headers |
| `brand.ink` | `#2E2A2C` | Primary text, near-black |
| `brand.muted` | `#8A8489` | Secondary text, placeholders |
| `brand.line` | `#EFE1E8` | Borders, dividers, table rules |
| `state.green` | `#3F9D6D` | 🟢 Available |
| `state.amber` | `#D99A2B` | 🟡 Low stock / expiring soon |
| `state.red` | `#C8433F` | 🔴 Out of stock / expired / void |
| `state.slate` | `#6B7280` | Neutral / informational |

Money is **always** rendered in the shop currency (default `ETB`, rendered as `Birr`) with
thousands separators and 2 decimals — format comes from `settings.currency`, never hard-coded.

## Typography

| Role | Stack | Notes |
|---|---|---|
| Brand/display | `Georgia, 'Times New Roman', serif` italic | Wordmark, customer hero, receipt header. Echoes the logo's calligraphic script without shipping a webfont (the preview sandbox blocks external fonts). |
| UI | system-ui / Roboto / Segoe UI | All app chrome — fast, Android-native feel |
| Numbers | `ui-monospace, 'Roboto Mono'` tabular | All money columns, right-aligned, so ledgers line up |

## Logo usage

- `app/public/brand/lubella-logo.svg` — recreated vector lockup (leaf sprig + wordmark + strapline).
- Minimum clear space = height of the "L" ascender.
- The strapline is dropped below 120px width; only the wordmark + leaf is used.
- Never recolour the leaf off-brand, never stretch, never place on mid-tone backgrounds without
  the blush plate.

## Tone

Warm, confident, feminine but not fussy. Copy is short and human: "Order on WhatsApp",
"3 left — order soon", "No tithe due this month."
