/**
 * paragraph.js — Phase 1/2 layout: single-run and multi-run paragraph layout.
 *
 * Exports:
 *   layoutRuns(runs, contentWidthMm, blockHeightMm, blockMeta) -> LaidOutBlock
 *   layoutSingleRun(text, runStyle, contentWidthMm, blockHeightMm) -> LaidOutBlock
 *
 * layoutSingleRun is a thin wrapper over layoutRuns([oneRun], …).
 *
 * Baseline formula (CSS-centered, consistent Phase 1/2):
 *   contentHeightMm = lineAscentMm + lineDescentMm
 *   leadingAboveMm  = (lineBoxHeightMm - contentHeightMm) / 2
 *   baselineYMm     = runningYOffset + leadingAboveMm + lineAscentMm
 * where runningYOffset accumulates previous lines' lineBoxHeightMm.
 * This vertically centers glyph content inside the line box, matching browser CSS.
 */

import { shapeRun } from './shape.js';
import { breakLines } from './linebreak.js';
import { EPSILON } from './model.js';

/**
 * @typedef {Object} StyleRun
 * @property {string} text
 * @property {RunStyle} style
 */

/**
 * @typedef {Object} RunStyle
 * @property {import('fontkit').Font} font
 * @property {number} unitsPerEm
 * @property {number} fontSizeMm
 * @property {number} lineHeightMm
 * @property {string} color
 * @property {number} letterSpacingMm
 * @property {string} textTransform
 * @property {boolean} underline
 * @property {boolean} strike
 * @property {{italic:boolean,bold:boolean}} faux
 */

/**
 * @typedef {Object} LaidOutGlyph
 * @property {number} glyphId
 * @property {string} char
 * @property {number} xMm
 * @property {number} advanceMm
 * @property {import('fontkit').Font} font
 * @property {number} unitsPerEm
 * @property {number} fontSizeMm
 * @property {string} color
 * @property {boolean} underline
 * @property {boolean} strike
 * @property {{italic:boolean,bold:boolean}} faux
 */

/**
 * @typedef {Object} LaidOutLine
 * @property {LaidOutGlyph[]} glyphs
 * @property {number} baselineYMm
 * @property {number} ascentMm
 * @property {number} descentMm
 * @property {number} widthMm
 * @property {number} lineHeightMm
 */

/**
 * @typedef {Object} LaidOutBlock
 * @property {string} blockId
 * @property {string} blockType
 * @property {LaidOutLine[]} lines
 * @property {number|null} contentWidthMm
 * @property {number|null} blockWidthMm
 * @property {number|null} blockHeightMm
 * @property {number} usedHeightMm
 * @property {boolean} overflow
 * @property {number|null} maxLines
 * @property {number|null} linesRemaining
 * @property {Object|null} decorations
 * @property {string} kind
 * @property {string} placement
 * @property {Object} passthrough
 */

// ---------------------------------------------------------------------------
// Phase 2 — multi-run layout (shared kernel)
// ---------------------------------------------------------------------------

/**
 * Layout multiple style runs into a LaidOutBlock.
 *
 * Shapes each run independently, breaks across the concatenated glyph stream,
 * reconciles baselines per line for mixed font sizes/weights.
 *
 * Baseline formula (CSS-centered, consistent Phase 1/2):
 *   For each line: baselineYMm = runningYOffset + leadingAboveMm + lineAscentMm
 *   where runningYOffset = sum of all previous lines' lineBoxHeightMm,
 *   leadingAboveMm = (lineBoxHeightMm - (lineAscentMm + lineDescentMm)) / 2,
 *   and lineAscentMm = max(ascentMm of all styles on the line).
 *   This vertically centers glyph content inside the line box, matching browser CSS.
 *
 * Per-glyph style is carried through the pipeline by attaching `style` to each
 * glyph object before breakLines. breakLines preserves extra properties via
 * slice/push of object references, so style is never re-inferred.
 *
 * @param {StyleRun[]} runs
 * @param {number} contentWidthMm
 * @param {number} blockHeightMm
 * @param {Object} blockMeta
 * @returns {LaidOutBlock}
 */
export function layoutRuns(runs, contentWidthMm, blockHeightMm, blockMeta) {
  if (runs.length === 0) {
    return buildBlock([], contentWidthMm, blockHeightMm, blockMeta);
  }

  // 1. Shape each run independently, concatenate glyph streams
  const taggedGlyphs = [];
  for (const run of runs) {
    const shaped = shapeRun(run.text, run.style);
    for (const g of shaped) {
      taggedGlyphs.push({ glyph: g, style: run.style });
    }
  }

  // 2. Build a heterogeneous-width glyph stream for breakLines.
  //    Every glyph carries its style through the pipeline (breakLines preserves
  //    extra properties via slice/push of object references).
  //    NOTE: no run-boundary break opportunities — CSS inline boxes do not
  //    create soft-wrap opportunities. Only whitespace/hyphen from shapeRun
  //    determine where lines may break.
  const breakGlyphs = taggedGlyphs.map((tg) => ({
    ...tg.glyph,
    style: tg.style,
  }));

  // 3. Break into lines
  const brokenLines = breakLines(breakGlyphs, contentWidthMm);

  // 4. Position lines with baseline reconciliation
  const lines = [];
  let runningYOffset = 0;

  for (const brokenLine of brokenLines) {
    const lineGlyphs = [];
    let xMm = 0;

    // Collect unique styles on this line to determine line metrics
    const lineStyles = new Set();

    for (const bg of brokenLine.glyphs) {
      const style = bg.style;
      lineStyles.add(style);

      lineGlyphs.push({
        glyphId: bg.glyphId,
        char: bg.char,
        xMm,
        advanceMm: bg.advanceMm,
        font: style.font,
        unitsPerEm: style.unitsPerEm,
        fontSizeMm: style.fontSizeMm,
        color: style.color,
        underline: style.underline,
        strike: style.strike,
        faux: style.faux,
      });
      xMm += bg.advanceMm;
    }

    // Baseline reconciliation: max ascent/descent/lineHeight across runs on this line
    let lineAscentMm = 0;
    let lineDescentMm = 0;
    let lineBoxHeightMm = 0;

    for (const style of lineStyles) {
      const font = style.font;
      const fontSizeMm = style.fontSizeMm;
      const ascentMm = (font.ascent / style.unitsPerEm) * fontSizeMm;
      const descentMm = Math.abs((font.descent / style.unitsPerEm) * fontSizeMm);
      lineAscentMm = Math.max(lineAscentMm, ascentMm);
      lineDescentMm = Math.max(lineDescentMm, descentMm);
      lineBoxHeightMm = Math.max(lineBoxHeightMm, style.lineHeightMm);
    }

    // Empty line fallback: use the first run's style for metrics
    if (brokenLine.glyphs.length === 0 && runs.length > 0) {
      const fallbackStyle = runs[0].style;
      const font = fallbackStyle.font;
      const fontSizeMm = fallbackStyle.fontSizeMm;
      lineAscentMm = (font.ascent / fallbackStyle.unitsPerEm) * fontSizeMm;
      lineDescentMm = Math.abs((font.descent / fallbackStyle.unitsPerEm) * fontSizeMm);
      lineBoxHeightMm = fallbackStyle.lineHeightMm;
    }

    // CSS half-leading baseline formula:
    //   contentHeightMm = lineAscentMm + lineDescentMm
    //   leadingAboveMm  = (lineBoxHeightMm - contentHeightMm) / 2
    //   baselineYMm     = runningYOffset + leadingAboveMm + lineAscentMm
    // This vertically centers glyph content inside the line box, matching browser CSS.
    const contentHeightMm = lineAscentMm + lineDescentMm;
    const leadingAboveMm = (lineBoxHeightMm - contentHeightMm) / 2;
    const baselineYMm = runningYOffset + leadingAboveMm + lineAscentMm;

    lines.push({
      glyphs: lineGlyphs,
      baselineYMm,
      ascentMm: lineAscentMm,
      descentMm: lineDescentMm,
      widthMm: brokenLine.widthMm,
      lineHeightMm: lineBoxHeightMm,
    });

    runningYOffset += lineBoxHeightMm;
  }

  return buildBlock(lines, contentWidthMm, blockHeightMm, blockMeta);
}

/**
 * Build a LaidOutBlock from positioned lines.
 * @param {LaidOutLine[]} lines
 * @param {number} contentWidthMm
 * @param {number} blockHeightMm
 * @param {Object} blockMeta
 * @returns {LaidOutBlock}
 */
function buildBlock(lines, contentWidthMm, blockHeightMm, blockMeta) {
  const baseLineHeight = lines.length > 0 ? lines[0].lineHeightMm : 0;
  const usedHeightMm = lines.reduce((sum, line) => sum + line.lineHeightMm, 0);
  const maxLines = baseLineHeight > 0 ? Math.floor(blockHeightMm / baseLineHeight) : 0;
  const overflow = usedHeightMm > blockHeightMm + EPSILON;
  const linesRemaining = maxLines - lines.length;

  return {
    blockId: blockMeta?.blockId || '',
    blockType: blockMeta?.blockType || 'paragraph',
    lines,
    contentLeftMm: 0,
    contentWidthMm,
    blockWidthMm: contentWidthMm,
    blockHeightMm,
    usedHeightMm,
    overflow,
    maxLines,
    linesRemaining,
    decorations: null,
    kind: 'text',
    placement: 'placed',
    passthrough: undefined,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — single-run wrapper (thin, byte-identical to layoutRuns([oneRun]))
// ---------------------------------------------------------------------------

/**
 * Layout one uniform style run into a LaidOutBlock.
 *
 * Thin wrapper over layoutRuns — produces byte-identical output to
 * layoutRuns([{text, style: runStyle}], contentWidthMm, blockHeightMm, {}).
 *
 * @param {string} text
 * @param {RunStyle} runStyle
 * @param {number} contentWidthMm
 * @param {number} blockHeightMm
 * @returns {LaidOutBlock}
 */
export function layoutSingleRun(text, runStyle, contentWidthMm, blockHeightMm) {
  return layoutRuns([{ text, style: runStyle }], contentWidthMm, blockHeightMm, {});
}
