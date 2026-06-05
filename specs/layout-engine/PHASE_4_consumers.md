# Phase 4 — Consumers: SVG renderer, canonical PDF, agent swap, polished-view rewire

**Status:** Ready for implementation
**Depends on:** Phases 0–3
**Blocks:** nothing (final phase)

## Objective

Wire the one layout model into the three consumers — **screen (SVG), print (PDF), and the AI agent** — so that what the user sees, what prints, and what the agent measures are all derived from the same `computeLayout` result. **No new layout logic is permitted in this phase**; every consumer is a thin adapter over `LaidOutBlock`.

## Scope

**In scope**
- `render-svg.js` — draw a `LaidOutBlock` as SVG; replace the polished view's HTML/CSS text rendering.
- `render-pdf.js` — generate a canonical PDF (pdf-lib + fontkit subsetting) placing each block at its canvas coords; make export/print serve this PDF.
- Agent swap — replace `measureHtmlHeight` + hardcoded capacity math in `ChatDrawer.svelte` `runAgentTool` with `computeLayout`.

**Out of scope**
- Any change to how layout is computed (frozen after Phase 3).
- The Notion-pane editor (Tiptap) — untouched.

## Detailed design

### `render-svg.js` (screen)

```js
export function renderBlockSVG(laidOutBlock, opts) -> SVGElement | string
// opts: { glyphMode: 'text' | 'path', embedFonts: boolean }
```
- One `<svg>` per block sized `blockWidthMm × blockHeightMm` (mm units via `viewBox` or width/height in mm).
- **`glyphMode:'text'` (default):** emit one `<text>` per line with an explicit per-glyph `x` list (`textLength`/`x="x0 x1 x2…"`) at `y = baselineYMm`, fill = glyph color, font-family/weight/style from the run, `font-size` in mm. Geometry is fully determined by the engine; the browser only rasterizes glyph shapes. Apply faux-italic skew (`transform`) where `faux.italic`. Apply `underline`/`strike` as drawn lines (not `text-decoration`, to stay deterministic).
- **`glyphMode:'path'` (pixel-identical):** convert each glyph to a vector path via fontkit (`glyph.path.toSVG()` scaled to fontSizeMm) and emit `<path>`; no browser text layout at all. This is the escalation lever — wire it but default to `'text'`.
- **Pass-through blocks:** render `horizontal_divider`/`vertical_divider` as lines (use `barStyle/barColor`), `headshot` as `<image>` from `imageData`.
- **Embedded fonts:** include `@font-face` with the vendored WOFF2 (base64 or asset URL) so `'text'` mode is self-contained and consistent.
- Replace text rendering in the polished view (`CanvasBlock.svelte` content container / `BlockRenderer.svelte`) with this output. The block's absolute position on the page continues to use existing canvas coords (`blockRectMm`).

### `render-pdf.js` (print/export)

```js
export async function renderResumePDF(blocks, ctx) -> Uint8Array
```
- Page size A4 (`PAGE_W_MM × PAGE_H_MM`) per page; one PDF page per CV page.
- Embed each used font **subset** via pdf-lib + fontkit (`pdfDoc.embedFont(bytes, { subset:true })`).
- For each block: `lo = computeLayout(block, blockRectMm(block.canvas, paddingMm), ctx)`; for each line, for each glyph, `page.drawText`/`drawGlyph` at absolute page coords `(blockRect.leftMm + glyph.xMm, pageHeight − (blockRect.topMm + line.baselineYMm))` converted to PDF points. **Never** call a width-based text-wrapping API; positions come only from the model.
- Draw pass-through blocks (dividers as vector lines, headshot as embedded image) and decorations (heading border-bottom) from the model.
- Export button and print path serve **this** PDF (download/open), not `window.print()` on the DOM. Server pipeline can call `renderResumePDF` directly in Node (same engine, no browser).

### Agent swap (`ChatDrawer.svelte` → `runAgentTool`)

- `read_block`: replace the hardcoded `lineHeightMm`/`charsPerLine` estimates and DOM `scrollHeight` reads with a `computeLayout(block, blockRect, ctx)` call. Report real `usedHeightMm`, `maxLines`, `linesRemaining`, `is_overflowing` (= `overflow`) and per-line count. Keep the response schema (placed/unplaced fields) from the current implementation.
- `update_block_content`: after staging, parse the proposed HTML → block content (existing `parseHtmlToTiptapJson`/sanitize path), run `computeLayout` on the **proposed** content at the same `blockRect`, and return real fit/overflow numbers instead of `measureHtmlHeight`. Delete `measureHtmlHeight`.
- Net effect: the agent's "does it fit?" is now identical to what the SVG preview and the PDF will show.

## Codebase integration points

- `computeLayout`, `initFonts`, `blockRectMm`, model types — Phases 0–3.
- Call `initFonts()` once at app startup (and at pipeline startup) before any `computeLayout`.
- Files touched: new `render-svg.js`, `render-pdf.js`; modified `CanvasBlock.svelte`/`BlockRenderer.svelte` (text rendering), the export/print path, and `ChatDrawer.svelte` `runAgentTool`. `pdf-lib` added to deps.

## Deliverables

- `src/lib/layout/render-svg.js`, `src/lib/layout/render-pdf.js`.
- Polished view rendering text via SVG consumer.
- Export/print serving the canonical PDF.
- Agent measurement driven by `computeLayout`; `measureHtmlHeight` removed.

## Judge gate

1. **Screen = PDF:** the same block in the SVG preview and the exported PDF have identical line breaks, glyph positions, and overflow.
2. **Cross-browser:** the SVG preview renders identically (geometry) in Chrome and Safari; in `glyphMode:'path'` it is pixel-identical.
3. **Agent = reality:** for several blocks, the agent's reported `usedHeight/maxLines/overflow` equals what the preview/PDF show; `measureHtmlHeight` is gone.
4. **Print path:** export/print produces the canonical PDF with embedded subset fonts, not a DOM print.
5. **One authority:** every consumer draws/measures from `computeLayout`; no consumer re-measures text. The invariant holds end-to-end: what the agent verifies = what the user sees = what prints.
