# Phase 2 — Inline rich text: multi-run lines, per-weight binaries, mixed baselines

**Status:** Ready for implementation
**Depends on:** Phases 0–1
**Blocks:** Phases 3–4

## Objective

Generalize the single-run kernel to **real Tiptap inline content**: a paragraph whose text mixes styles (bold/italic/color/fontFamily) within and across lines. Line-breaking must work across run boundaries and inside a run; each run is shaped with its own font binary; glyphs carry their own style to the renderer; mixed-size/style runs sharing a line align on a common baseline.

## Background (real content shape)

`block.content` is a flat inline array: `{type:'text', text, marks?}` and `{type:'hardBreak'}`. Marks: `bold`, `italic`, `underline`, `strike`, `textStyle{color, fontFamily}`. (`hardBreak` handling is Phase 3 — Phase 2 may assume content with no hardBreaks, i.e. a single visual paragraph, OR treat hardBreak as a hard segment boundary and lay out only the first segment; pick the former and let Phase 3 own segmentation.)

## Scope

**In scope**
- `runs.js` — convert a block's inline content (a hardBreak-free segment) into ordered `StyleRun[]` using `resolveRunStyle` from Phase 0.
- Extend `paragraph.js` to `layoutRuns(runs, contentWidthMm, blockHeightMm, blockMeta) -> LaidOutBlock`:
  - shape each run with its own font,
  - break across and within runs,
  - per-line baseline reconciliation across mixed run metrics,
  - carry per-glyph style.

**Out of scope**
- `hardBreak` segmentation and block-type decorations / heading borders (Phase 3).
- Whole-block vertical stacking of multiple segments (Phase 3).
- Rendering (Phase 4).

## Detailed design

### `runs.js`

```js
export function contentToRuns(inlineNodes, baseStyle) -> StyleRun[]
```
`baseStyle` is the **effective** base style from Phase 0's `effectiveBaseStyle(templateName, blockType, themeColors, customTemplates)` — i.e. template geometry with themeColors family+color already applied. Do **not** pass the raw `TypeStyle`; that would use the dead template font.

1. Iterate `inlineNodes` (text nodes only here; hardBreak handled upstream in Phase 3).
2. For each text node, `style = resolveRunStyle(baseStyle, node.marks ?? [])`.
3. Coalesce adjacent text nodes with **structurally equal** `RunStyle` into one run (compare resolved font identity + size + color + flags), to minimize run count.
4. Output `StyleRun[]` preserving order. Empty text nodes are dropped.

### Shaping across runs

Each run shapes independently (`shapeRun` from Phase 1, which already applies that run's letter-spacing/transform). Concatenate the resulting glyph streams **in run order** into one logical glyph sequence, where every glyph remembers its originating `RunStyle`. Break opportunities are exactly those from Phase 1 (after whitespace / hyphen). No extra break opportunities are injected at run boundaries — CSS inline boxes do not create soft-wrap opportunities. A word split across multiple runs (e.g. a bold substring inside a word) remains one unbreakable token.

### Line breaking (extended)

Reuse `breakLines` semantics from Phase 1 over the concatenated, style-tagged glyph stream. The only change: a glyph's `advanceMm` already reflects its own run's font/size/tracking, so widths are heterogeneous along the line. No other change to the greedy algorithm.

### Per-line baseline reconciliation (the hard part)

A line may contain glyphs from runs of different font sizes / fonts. Compute the line's shared baseline so all runs sit correctly:
1. For each glyph, derive its run's `ascentMm` and `descentMm` (from its fontkit font scaled to its `fontSizeMm`).
2. `line.ascentMm = max(glyph.ascentMm)`, `line.descentMm = max(glyph.descentMm)` across the line.
3. The line's content height = `line.ascentMm + line.descentMm`; the line box height is the **max `lineHeightMm`** among the runs on the line (matches CSS: line box grows to tallest inline).
4. `baselineYMm` = previous lines' stacked box heights + leading-above + `line.ascentMm`, where leading-above centers content in the line box. Document the exact formula and keep it consistent with Phase 1's single-run result (a single-run line must produce the same baseline as `layoutSingleRun`).
5. Each `LaidOutGlyph.yMm` is implied by the line baseline; glyphs of smaller runs share the same baseline (so a bold 4mm word and a regular 4mm word align; a larger inline run extends above).

> Consistency requirement: `layoutRuns` called with a single run MUST return the identical `LaidOutBlock` that `layoutSingleRun` returns. Make `layoutSingleRun` a thin wrapper over `layoutRuns([oneRun], …)`.

### Decoration flags

`underline` / `strike` do not affect width or breaking; they ride on each `LaidOutGlyph` for the renderer. Color rides per glyph.

## Deliverables

- `src/lib/layout/runs.js`.
- Extended `src/lib/layout/paragraph.js` exposing `layoutRuns`, with `layoutSingleRun` refactored to delegate to it.

## Judge gate

1. **Mixed runs break correctly:** a line mixing regular + **bold** + *italic* + colored text wraps at the right column width; break opportunities occur at run boundaries and whitespace.
2. **Per-weight metrics:** a bold run measures wider than the same text in regular (proves separate binaries), and an italic run uses italic (or flagged faux) metrics.
3. **Per-glyph style preserved:** every glyph carries correct font, color, underline/strike — verifiable by dumping the `LaidOutBlock`.
4. **Baseline alignment:** when a larger inline run shares a line with body text, all runs sit on one baseline and the line box grows to the tallest run; visually matches the browser.
5. **Single-run equivalence:** `layoutRuns([run])` is byte-identical to Phase 1's `layoutSingleRun(run)`.
