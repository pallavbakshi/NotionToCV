# Deterministic Layout Engine — PRD Set

This folder is the complete specification for `src/lib/layout/`, a deterministic, browser-independent text-layout engine for the polished CV view. It exists so that **screen rendering, PDF export, and AI-agent fit measurement are the same numbers produced by the same function** — the browser paints pixels but never decides layout.

## Why

HTML/CSS delegates line-breaking, text height, and overflow to each browser's layout engine. Chrome, Safari, and Edge disagree subtly. For a precision document (a CV destined for print) that is a defect, and it also means the AI agent's "does this content fit?" answer (currently `measureHtmlHeight`, a DOM measurement) is Chrome-specific. The fix is to compute layout ourselves from font metrics, once, and have every consumer draw from that result.

## The spine (invariants that hold across all phases)

1. **Single shaping authority: `fontkit`.** The only code allowed to measure or shape text, in browser or Node.
2. **One immutable model, many consumers.** The engine emits `LaidOutBlock` (positioned glyphs + lines + heights + overflow). Screen/PDF/agent consume it; none re-measure.
3. **Glyph-level output from Phase 1.** Per-glyph x/y, not line strings — this is what makes render and measurement physically identical.
4. **mm is canonical; px/pt derived.** Grid constants come from existing app config, never re-hardcoded.
5. **No tests.** Each phase is gated by a manual judge review against its "Judge gate" section.

## Phases (MECE, strictly linear 0 → 4)

| Phase | File | One concern |
|---|---|---|
| 0 | `PHASE_0_foundations.md` | Vendored fonts, fontkit registry, template-metrics data, units, model contract |
| 1 | `PHASE_1_core_kernel.md` | Single styled run → shaping + line-breaking + positioning + height/overflow |
| 2 | `PHASE_2_rich_text.md` | Multiple inline style runs per paragraph (marks, per-weight binaries, mixed baselines) |
| 3 | `PHASE_3_block_composition.md` | hardBreaks, per-block-type decorations, whole-block vertical stack, `computeLayout` API |
| 4 | `PHASE_4_consumers.md` | SVG renderer, canonical PDF (pdf-lib), agent swap, polished-view rewire |

Each phase consumes the previous and adds exactly one concern. A phase may not reach forward into a later phase's concern; the "Out of scope" section of each PRD enforces this.

## Final state

`initFonts()` once at startup; `computeLayout(block, blockRect)` produces the deterministic model; three thin consumers (SVG, PDF, agent) draw/measure from it. Cross-browser consistency, print fidelity, and agent correctness become the same property of the same function.
