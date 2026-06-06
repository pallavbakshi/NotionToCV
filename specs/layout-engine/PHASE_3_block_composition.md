# Phase 3 — Block composition: hardBreaks, decorations, vertical stack, `computeLayout`

**Status:** Ready for implementation
**Depends on:** Phases 0–2
**Blocks:** Phase 4

## Objective

Compose a complete block from its inline content and expose the engine's public entry point `computeLayout(block, blockRect)`. This phase owns everything between "a single wrapped paragraph segment" (Phase 2) and "a finished `LaidOutBlock` for any block the app supports": explicit `hardBreak` line breaks, per-block-type decorations (uppercase already handled in shaping; heading `border-bottom` height; block padding), the vertical stacking of multiple segments, final overflow/capacity numbers, and pass-through handling of non-text blocks.

## Background (real model)

- Text block types: `paragraph`, `h1`, `h2`, `h3`. A block has **one** block type (its whole content shares that base TypeStyle); inline marks vary per run within it (Phase 2).
- `block.content` may contain `{type:'hardBreak'}` nodes that force a new line regardless of width.
- **No list block types exist.** Do not build list markers/indents. (Forward-compat note only: if list types are added later, they slot in as additional "block children" here — leave the child-iteration structure open, but build nothing for it now.)
- Non-text blocks: `horizontal_divider`, `vertical_divider`, `headshot` — these carry no text. `block.source === 'canvas'` identifies canvas elements; `block.elementType` gives the kind.
- `h2` (clean) has `border-bottom: 0.75pt`. Borders consume vertical space and are drawn by the renderer; the engine must report them in `decorations` and include their height in `usedHeightMm`.

## Scope

**In scope**
- `block.js` — segmentation by `hardBreak`, stacking segments, decoration metrics, final totals.
- `index.js` — `computeLayout(block, blockRect, ctx)` public API for **all** block types and **all four** templates (+ custom templates).
- Pass-through for non-text blocks.

**Out of scope**
- Any change to shaping / run building / line breaking (frozen after Phase 2).
- SVG/PDF rendering, agent wiring (Phase 4).

## Detailed design

### `ctx` (layout context)

`computeLayout(block, blockRect, ctx)` where `ctx = { templateName, customTemplates, paddingMm, themeColors }`. `themeColors` is **required** (font + color resolution depends on it — see Phase 0 "Effective style resolution"). `blockRect` is from `blockRectMm(block.canvas, paddingMm)` (Phase 0); if the block is unplaced (`block.canvas == null`), see "Unplaced blocks" below.

### Segmentation by hardBreak

1. Resolve `baseStyle = effectiveBaseStyle(templateName, block.type, themeColors, customTemplates)` (Phase 0) — template geometry + themeColors family/color.
2. Split `block.content` into **segments** at each `{type:'hardBreak'}`. Each segment is a hardBreak-free inline array.
3. For each segment: `runs = contentToRuns(segment, baseStyle)` (Phase 2); lay the segment's runs into lines via `layoutRuns`, but **without** computing per-segment totals — Phase 3 owns vertical position across segments.
4. An empty segment (consecutive hardBreaks) produces exactly one empty line of height `baseStyle.lineHeightMm`.

### Vertical stacking

- Concatenate all segments' lines in order into the block's `lines[]`.
- Re-base each line's `baselineYMm` against a single running vertical cursor so lines stack continuously across segment boundaries (a hardBreak just starts the next line; it does not add extra spacing unless the template specifies paragraph spacing — none currently do).
- `contentHeightMm = Σ line box heights`.

### Decorations

- `decorations.borderBottom` (if the TypeStyle has one): `{ widthPt, color, yMm }` where `yMm = contentHeightMm` (drawn under the content). Add `ptToMm(widthPt)` to `usedHeightMm`.
- Account for any block padding the template applies (transcribe from CSS; most are `margin:0`, `padding:0` for text types — verify per template).

### Final totals

```
usedHeightMm = contentHeightMm + borderHeightMm
maxLines     = floor(blockRect.heightMm / baseTypeStyle.lineHeightMm)
overflow     = usedHeightMm > blockRect.heightMm + EPSILON
linesRemaining = maxLines - lines.length
contentWidthMm = blockRect.widthMm   // minus horizontal padding if any
```

Populate and return the full `LaidOutBlock` (`kind:'text'`) with `blockWidthMm/blockHeightMm` from `blockRect`.

### Non-text blocks (pass-through)

If `block.source === 'canvas'` or `block.type` ∈ {`horizontal_divider`,`vertical_divider`,`headshot`}: return `LaidOutBlock` with `kind:'passthrough'`, `lines: []`, `usedHeightMm = blockRect.heightMm`, `overflow:false`, and a `passthrough` descriptor `{ elementType, imageData?, barStyle?, barColor? }` copied from the block so the renderer can draw it. The engine does no text work for these.

### Unplaced blocks (`block.canvas == null`)

No `blockRect`. Return a `LaidOutBlock` with `blockWidthMm/blockHeightMm = null`, `overflow:false`, `maxLines/linesRemaining = null`, and lay out content at an **unconstrained** width (single line per segment, no wrapping) purely so callers can still read content metrics. Mark `placement:'unplaced'`. (This mirrors the agent's existing placed/unplaced distinction in `read_block`.)

## Codebase integration points

- `getTypeStyle`, `blockRectMm` from Phase 0; `contentToRuns`, `layoutRuns` from Phase 2.
- `computeLayout` becomes the single function Phase 4's three consumers call.

## Deliverables

- `src/lib/layout/block.js`, `src/lib/layout/index.js` (`computeLayout`, `initFonts` re-export).

## Judge gate

1. **All types × all templates:** `paragraph`, `h1`, `h2`, `h3` across `clean/compact/elegant/modern` each lay out with correct size/line-height/transform/color; no unhandled combination.
2. **hardBreaks:** content with explicit hardBreaks stacks onto new lines at the right vertical positions; consecutive hardBreaks add blank lines of correct height.
3. **Heading border:** an `h2` reports `decorations.borderBottom` and includes its height in `usedHeightMm`.
4. **Overflow/capacity:** for a real experience block sized to N rows, `usedHeightMm/maxLines/linesRemaining/overflow` are correct and match a browser rendering's visible fit.
5. **Pass-through:** a `headshot`/divider block returns `kind:'passthrough'` with its descriptor and no text work.
6. **Unplaced:** an unplaced block returns content metrics with null spatial fields and `placement:'unplaced'`.
7. **Public API shape:** `computeLayout(block, blockRect, ctx)` is the only entry callers need.
