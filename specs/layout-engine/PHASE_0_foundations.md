# Phase 0 — Foundations: fonts, registry, template metrics, units, model contract

**Status:** Ready for implementation
**Depends on:** nothing
**Blocks:** Phases 1–4 (all)

## Objective

Stand up the deterministic source of truth — the shaping authority (`fontkit`), the vendored font binaries, the per-template type-style data, the unit system, and the frozen layout-model types. **No measuring, no line-breaking, no positioning, no rendering** happens in this phase. The output is the foundation every later phase calls into.

## Resolved decisions (do not re-ask)

- **Effective font & color come from `themeColors`, NOT the template CSS.** This is the most important contract in Phase 0. At render time, `App.svelte` injects a `<style>` block that overrides every template's per-block-type `font-family` (and `color`) via CSS variables: `.block-type-h1 { font-family: var(--cv-h1-font) }` where `--cv-h1-font = themeColors.h1Font ?? 'Inter'`. **The template CSS `font-family`/`color` for h1/h2/h3/paragraph are dead — overridden.** The engine MUST resolve font and color exactly the same way or it drifts (see "Effective style resolution" below). The template still authoritatively provides **size, weight, line-height, letter-spacing, text-transform, and border** — only family and color are themeColors-driven.
- **Font inventory = the `index.html` Google Fonts `<link>`.** Vendor exactly the `(family, weight, ital)` combinations declared there: Inter, Lora, Outfit, Playfair Display, Space Grotesk, Noto Serif, Work Sans, Fira Code. That curated set is the **whitelist**.
- **One unknown-family rule, applied everywhere.** Any requested family (from `themeColors`, a `textStyle.fontFamily` mark, or a custom template) that is **not** in the vendored whitelist → fall back to **Inter** and emit **one visible warning per unknown family — never silent**. (Arbitrary fonts later = a user-uploads-the-binary-we-vendor flow; out of scope now.)
- **Italic gap is real → faux-italic is required.** Inter, Outfit, and Space Grotesk have **no italic** binary in that URL, yet every template maps `em/i → italic`. The `getFont` fallback must produce `faux.italic = true` for these (render-time skew; upright metrics for measurement).
- **Custom templates: minimal CSS parse, clean-template fallback.** `customTemplates` is `{ [id]: cssString }` (raw CSS authored to the built-in selector pattern `.tmpl-X.block-type-{h1,h2,h3,paragraph}`). The engine extracts **only** the geometric/typographic properties it needs (`font-size`, `line-height`, `font-weight`, `letter-spacing`, `text-transform`, `border-bottom`) from those selectors; any missing property falls back to the **`clean`** template's value for that block type. Family/color are ignored from custom CSS (themeColors wins anyway).
- **Basis Grotesque is NOT vendored for the engine.** It is the app-UI chrome font (`--font-serif` in `app.css`); no CV template references it. The engine never touches it.
- **Type system = JSDoc** (`@typedef`), not TypeScript. The repo is Svelte + plain JS; keep it that way across `src/lib/layout/`.

## Background (real codebase facts)

- Text block types: `paragraph`, `h1`, `h2`, `h3`. Non-text canvas blocks: `horizontal_divider`, `vertical_divider`, `headshot` (these carry no text and are passed through untouched by the engine).
- A block's text lives in `block.content`: a **flat inline array** of nodes `{ type:'text', text:string, marks?:Mark[] }` and `{ type:'hardBreak' }`. There is **no list/paragraph nesting** — StarterKit has `bulletList/orderedList/listItem` disabled.
- Marks: `{type:'bold'}`, `{type:'italic'}`, `{type:'underline'}`, `{type:'strike'}`, `{type:'textStyle', attrs:{ color?, fontFamily? }}`.
- Templates live as CSS in `src/lib/polished/templates/{clean,compact,elegant,modern}.css`. Each defines, per block type, `font-family`, `font-size` (**in mm**), `font-weight`, `line-height` (**in mm**), `color`, and sometimes `letter-spacing` (pt), `text-transform`, `border-bottom`. Custom templates may also arrive via the `customTemplates` prop; theme color overrides via `#theme-color-overrides`.
- Fonts are currently loaded for screen via Google Fonts `<link>` in `index.html` (Inter, Lora, Outfit, Playfair Display, Space Grotesk, Noto Serif, Work Sans, Fira Code) plus local `@font-face` Basis Grotesque woff2 in `src/app.css`. fontkit needs the **binary**, so the binaries must be vendored locally.
- Grid geometry (from `CvPage.svelte` / `CanvasBlock.svelte`): page 210×297mm, 4 columns, 4mm gutters, 5mm rows. `colWidth = (210 − 2·paddingMm − 12) / 4`.

## Scope

**In scope**
1. Add `fontkit` dependency; confirm it parses woff2 (it bundles brotli — yes).
2. **Vendor font binaries**: download exactly the `(family, weight, ital)` combinations declared in the `index.html` Google Fonts `<link>` into `src/assets/fonts/`. (Do not vendor Basis Grotesque — it is UI-only.)
3. `fonts.js` — font registry + style resolution.
4. `template-metrics.js` — per-template, per-block-type type-style data, transcribed from the CSS.
5. `units.js` — unit conversions + grid constants.
6. `model.js` — frozen type contract + factory helpers.
7. `initFonts()` — async load of all binaries, works in browser **and** Node.

**Out of scope (belongs to later phases)**
- Any `shapeRun`, line-breaking, glyph positioning, height/overflow math (Phase 1+).
- Converting a block's `content` into runs (Phase 2).
- Rendering of any kind (Phase 4).

## Detailed design

### `units.js`

```js
export const PAGE_W_MM = 210, PAGE_H_MM = 297;
export const COLUMNS = 4, GUTTER_MM = 4, ROW_MM = 5;

export const colWidthMm = (paddingMm) => (PAGE_W_MM - 2 * paddingMm - GUTTER_MM * (COLUMNS - 1)) / COLUMNS;

// Conversions
export const mmToPt = (mm) => mm * 72 / 25.4;          // 1mm ≈ 2.834646pt
export const mmToPx = (mm) => mm * 96 / 25.4;          // CSS @96dpi
export const ptToMm = (pt) => pt * 25.4 / 72;

// fontkit advance (font units) → mm, given font size in mm
export const advanceToMm = (advanceUnits, unitsPerEm, fontSizeMm) =>
  (advanceUnits / unitsPerEm) * fontSizeMm;

// Block rect from canvas coords — MUST match canvasToRect in ChatDrawer.svelte exactly.
// colSpan === 0 is a gutter element (vertical_divider): width = GUTTER_MM, left offset by colWidth.
export function blockRectMm(canvas, paddingMm) {
  const cw = colWidthMm(paddingMm);
  const left = canvas.colSpan === 0
    ? paddingMm + canvas.col * (cw + GUTTER_MM) + cw
    : paddingMm + canvas.col * (cw + GUTTER_MM);
  const width = canvas.colSpan === 0 ? GUTTER_MM : canvas.colSpan * cw + (canvas.colSpan - 1) * GUTTER_MM;
  const top = paddingMm + canvas.row * ROW_MM;
  const height = canvas.rowSpan * ROW_MM;
  return { leftMm: left, topMm: top, widthMm: width, heightMm: height };
}
```

### `template-metrics.js`

Transcribe each template CSS into data. Shape per `(templateName, blockType)`:

```js
// TypeStyle
{
  fontFamily: 'Inter',
  fontWeight: 400,            // 400/500/600/700/800
  fontStyle: 'normal',        // 'normal' | 'italic'
  fontSizeMm: 4,
  lineHeightMm: 5,
  color: '#4b4b4b',
  letterSpacingPt: 0,         // default 0
  textTransform: 'none',      // 'none' | 'uppercase'
  borderBottom: null,         // or { widthPt: 0.75, color: '#111111' } — adds to block visual height (Phase 3)
}
```

The `fontFamily` and `color` fields are **template defaults only** — they are overridden by `themeColors` at resolution time (see "Effective style resolution"). Carry them anyway so unplaced/edge paths have a value.

Provide `getTypeStyle(templateName, blockType, customTemplates?) -> TypeStyle`. For built-in templates return the transcribed data; for a custom template id, run the minimal CSS parse (per Resolved decisions) with `clean` fallback per property. Known values for `clean` (transcribe the other three identically from their CSS):

| blockType | family | weight | sizeMm | lhMm | color | letterSpacingPt | transform | borderBottom |
|---|---|---|---|---|---|---|---|---|
| h1 | Inter | 800 | 16 | 20 | #111111 | −0.5 | none | — |
| h2 | Inter | 700 | 12 | 15 | #111111 | 1.5 | uppercase | 0.75pt #111111 |
| h3 | Inter | 600 | 8 | 10 | #111111 | 0 | none | — |
| paragraph | Inter | 400 | 4 | 5 | #4b4b4b | 0 | none | — |

### `fonts.js` — registry + resolution

```js
// Registry: key `${family}__${weight}__${style}` -> fontkit Font instance
// initFonts(): load each vendored binary (fetch in browser, fs.readFile in Node) and fontkit.create(buffer).

export async function initFonts(): Promise<void>;

// Resolve a fontkit font for a desired style, with documented fallback policy.
export function getFont(family, weight, style): { font, usedFamily, usedWeight, usedStyle, faux: { italic:boolean, bold:boolean } };
```

**Fallback policy (must be explicit):**
- Exact `(family, weight, style)` present → use it, no faux.
- Missing weight → nearest available weight of same family/style.
- Missing italic for the family → use upright binary and set `faux.italic = true` (renderer applies a skew; measurement uses upright metrics — acceptable, flag it).
- Missing family entirely → fall back to Inter (and log once). Should not happen if vendoring is complete.

**Effective style resolution (the themeColors overlay) — defined here, used by Phases 1–3:**

```js
// Map a block type to its themeColors category.
export function fontCategory(blockType) // 'h1'|'h2'|'h3' -> same; 'paragraph' -> 'text'

// themeColors shape (from App.svelte):
// { h1Font, h2Font, h3Font, textFont, h1Color, h2Color, h3Color, textColor, backgroundColor }

// Produce the block's EFFECTIVE base style: template metrics for geometry, themeColors for family+color.
export function effectiveBaseStyle(templateName, blockType, themeColors, customTemplates?) -> BaseStyle
// BaseStyle = TypeStyle but with:
//   fontFamily = themeColors[`${cat}Font`]  (cat = fontCategory(blockType)), unknown-family rule applied
//   color      = themeColors[`${cat}Color`]
//   (size/weight/lineHeight/letterSpacing/textTransform/borderBottom keep template values)
```

**Style resolution from marks** (used by Phase 2, defined here):

```js
// Given the block's EFFECTIVE BaseStyle and a run's marks, produce the effective run style.
export function resolveRunStyle(baseStyle, marks): RunStyle
// RunStyle = { font (fontkit), unitsPerEm, fontSizeMm, lineHeightMm, color, letterSpacingMm,
//              textTransform, underline:boolean, strike:boolean, faux }
```
Rules (in order): start from `baseStyle` (already themeColors-resolved); `bold` → weight 700 (or nearest available for the family); `italic` → style italic (or `faux.italic`); `textStyle.fontFamily` (≠ `'Default'`) overrides family — re-resolve via `getFont`, applying the unknown-family rule; `textStyle.color` overrides color; `underline`/`strike` set decoration flags (no width effect). Per-run color does apply (inline span color beats the parent's `!important` color rule because they target different elements).

### `model.js` — frozen contract

```js
// StyleRun: a maximal span of text sharing one RunStyle (produced in Phase 2)
StyleRun = { text: string, style: RunStyle }

// LaidOutGlyph: one positioned glyph
LaidOutGlyph = {
  glyphId: number, char: string,
  xMm: number,            // left edge within the block content box
  advanceMm: number,
  font, unitsPerEm: number, fontSizeMm: number,
  color: string, underline: boolean, strike: boolean, faux: { italic, bold }
}

// LaidOutLine: one visual line
LaidOutLine = {
  glyphs: LaidOutGlyph[],
  baselineYMm: number,    // baseline offset from block content-box top
  ascentMm: number, descentMm: number,
  widthMm: number, lineHeightMm: number,
}

// LaidOutBlock: the engine's output for one block
LaidOutBlock = {
  blockId: string, blockType: string,
  lines: LaidOutLine[],
  contentWidthMm: number, blockWidthMm: number, blockHeightMm: number,
  usedHeightMm: number,
  overflow: boolean,
  maxLines: number, linesRemaining: number,
  decorations: { borderBottom?: { widthPt, color, yMm } } | null,
  kind: 'text' | 'passthrough',   // 'passthrough' for divider/headshot
}
```

Provide factory/validator helpers (`emptyBlock(blockId, type, rect)`, etc.). Use **JSDoc `@typedef`** for the contract (not TypeScript) — matches the repo's Svelte + plain-JS setup.

## Deliverables

- `package.json`: `fontkit` added.
- `src/assets/fonts/`: all vendored binaries.
- `src/lib/layout/units.js`, `template-metrics.js`, `fonts.js`, `model.js`.
- `initFonts()` callable from both browser and Node entry points.

## Judge gate (manual review by judge)

1. **Vendoring complete:** every family in the `index.html` whitelist resolves to a real vendored binary at every weight/ital declared; `getFont` returns no `family-missing` fallback for any whitelisted combination.
2. **Template metrics match CSS:** spot-check all four templates' h1/h2/h3/paragraph against their CSS files — sizes/line-heights/weights/transform/letter-spacing/border identical (family/color are defaults only).
3. **themeColors overlay correct:** `effectiveBaseStyle` returns the `themeColors.{cat}Font`/`{cat}Color` family+color (not the template CSS font) for each block type; changing `themeColors.h1Font` to e.g. `'Space Grotesk'` changes the resolved h1 font and `getFont` picks the right binary (nearest weight if 800 absent).
4. **Unknown-family rule:** an unvendored family (via themeColors, a mark, or a custom template) falls back to Inter with exactly one visible warning — never silent.
5. **Custom template parse:** a custom template `cssString` yields correct size/weight/line-height/transform/border for its block types, with per-property `clean` fallback for anything absent.
6. **Geometry parity:** `blockRectMm` returns the same numbers as the existing `canvasToRect`/`CanvasBlock` math for several sample canvases, including a `colSpan === 0` gutter element.
7. **Dual-environment:** the module imports and `initFonts()` resolves in both the browser and a plain Node script.
8. **Contract completeness:** I can read the `model.js` types and see exactly what a full block's output will contain before any layout code exists.
