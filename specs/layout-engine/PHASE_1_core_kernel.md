# Phase 1 — Core kernel: single styled run → glyphs, lines, height, overflow

**Status:** Ready for implementation
**Depends on:** Phase 0
**Blocks:** Phases 2–4

## Objective

Implement the core layout algorithm proven on **one uniform style run**: shape text with fontkit, break it into lines for a fixed mm width, position every glyph, and compute used height + overflow. This is the algorithmic heart; Phase 2 generalizes it to mixed styles, Phase 3 to whole blocks.

## Scope

**In scope**
- `shape.js` — `shapeRun(text, runStyle)` via fontkit, with letter-spacing and text-transform applied.
- `linebreak.js` — greedy line breaking over UAX #14 break opportunities + emergency mid-word break.
- `paragraph.js` (single-run entry) — `layoutSingleRun(text, runStyle, contentWidthMm, blockHeightMm)` → `LaidOutBlock`.

**Out of scope**
- Multiple style runs / marks within the text (Phase 2). Phase 1 takes ONE `RunStyle`.
- `hardBreak` handling, block-type decorations, vertical stacking of multiple paragraphs (Phase 3).
- Rendering (Phase 4).

## Detailed design

### `shape.js`

```js
// Returns shaped glyphs in document order with advances already in mm.
export function shapeRun(text, runStyle) -> ShapedGlyph[]
// ShapedGlyph = { glyphId, char, advanceMm, isBreakOpportunityAfter:boolean, isWhitespace:boolean }
```

Algorithm:
1. **Apply `textTransform`** first: if `uppercase`, transform the string before shaping (changes glyphs and widths). Keep a map back to original chars for completeness, but layout uses transformed text.
2. **Shape** with fontkit: `const run = runStyle.font.layout(transformedText)`. fontkit returns positioned glyphs with `advanceWidth` (font units) and `glyph.codePoints`. This applies real GPOS kerning and ligatures — do not sum naive metrics.
3. Convert each advance: `advanceMm = advanceToMm(advanceWidth, unitsPerEm, runStyle.fontSizeMm)`.
4. **Add letter-spacing:** `advanceMm += runStyle.letterSpacingMm` per glyph (skip after the last glyph of the run if you want CSS parity; CSS adds tracking after every glyph including last — match CSS: add to every glyph).
5. Mark `isWhitespace` for space/tab; mark `isBreakOpportunityAfter` using UAX #14 (a soft-wrap opportunity exists after spaces and at other break classes). For Phase 1, a pragmatic rule is acceptable: break opportunity after any whitespace and after hyphen `-`; document this and leave full UAX #14 class handling as a noted simplification.

> Note on ligatures: when a ligature maps multiple codepoints to one glyph, keep it as one `ShapedGlyph` whose `char` is the joined source text; never break inside it.

### `linebreak.js`

```js
export function breakLines(glyphs, contentWidthMm) -> Line[]   // Line = { glyphs: ShapedGlyph[], widthMm }
```

Greedy algorithm:
1. Walk glyphs, accumulating width. Track the index of the **last break opportunity** seen on the current line.
2. When adding the next glyph would exceed `contentWidthMm`:
   - If there is a break opportunity on the current line → break **after** it; trailing whitespace at the break is collapsed (its advance does not count toward the line's visible width but is consumed).
   - If there is **no** break opportunity (a single token longer than the width) → **emergency break**: break before the glyph that overflows (mid-word). Never produce a zero-glyph line.
3. Continue until glyphs exhausted. Leading whitespace on a continuation line is collapsed.
4. Compute each `Line.widthMm` from non-collapsed glyph advances.

Edge cases: empty string → one empty line (height of one line). Width ≤ 0 → treat as emergency-break every glyph (defensive). All-whitespace text → one line, width 0.

### `paragraph.js` (single-run entry)

```js
export function layoutSingleRun(text, runStyle, contentWidthMm, blockHeightMm, blockMeta) -> LaidOutBlock
```

1. `glyphs = shapeRun(text, runStyle)`.
2. `lines = breakLines(glyphs, contentWidthMm)`.
3. **Vertical metrics:** from fontkit font, derive `ascentMm`/`descentMm` scaled to `fontSizeMm` (`font.ascent/unitsPerEm*fontSizeMm`). Each line occupies `runStyle.lineHeightMm`.
4. **Position lines:** for line *i*, derive metrics from the fontkit font: `ascentMm = font.ascent / unitsPerEm * fontSizeMm`, `descentMm = -font.descent / unitsPerEm * fontSizeMm`. The line box height is `lineHeightMm`. The glyph content is vertically centered within the line box (CSS half-leading):
   ```
   contentHeightMm = ascentMm + descentMm
   leadingAboveMm  = (lineHeightMm - contentHeightMm) / 2
   baselineYMm     = runningYOffset + leadingAboveMm + ascentMm
   ```
   where `runningYOffset` accumulates previous lines' `lineHeightMm`. This matches browser CSS `line-height` block behavior with `vertical-align: baseline`. Document the exact baseline formula chosen.
5. **Position glyphs in a line:** running `xMm` from 0, each `LaidOutGlyph.xMm` = cumulative advance; carry `color/underline/strike/faux/font/unitsPerEm/fontSizeMm` from `runStyle`.
6. **Totals:** `usedHeightMm = lines.length * lineHeightMm` (+ border-bottom height if present — but borders are Phase 3; here pass through `blockMeta.decorations` untouched). `maxLines = floor(blockHeightMm / lineHeightMm)`. `overflow = usedHeightMm > blockHeightMm + EPSILON`. `linesRemaining = maxLines − lines.length`.
7. Return a fully-populated `LaidOutBlock` (`kind:'text'`).

Use a small `EPSILON` (e.g. 0.01mm) on all overflow comparisons.

## Codebase integration points

- Replaces the *intent* of `measureHtmlHeight` and the hardcoded capacity math in `ChatDrawer.svelte` (`runAgentTool`) — but the actual swap is Phase 4. Phase 1 just makes the numbers computable.
- Uses `units.js`, `fonts.js`, `model.js` from Phase 0.

## Deliverables

- `src/lib/layout/shape.js`, `linebreak.js`, `paragraph.js` (single-run path only).

## Judge gate

1. **Wrapping correctness:** a plain `paragraph` style (Inter 400 / 4mm / lh 5mm) wrapping at a real column width produces line breaks that visually match the browser rendering of the same single-style text.
2. **Kerning honored:** advances reflect fontkit GPOS (e.g., "AV", "To" tighter than naive sum) — not a constant per-char width.
3. **Overflow numbers sane:** `usedHeightMm`, `maxLines`, `linesRemaining`, `overflow` are correct for a block sized to N rows.
4. **Emergency break:** a single 60-character token in a narrow column breaks mid-word with no zero-glyph lines.
5. **Letter-spacing & transform:** an `h2`-style run (uppercase + 1.5pt tracking) measures wider than the same text without tracking, and is uppercased.
6. **Determinism:** identical inputs yield byte-identical `LaidOutBlock` across browser and Node runs.
