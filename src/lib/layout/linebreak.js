/**
 * linebreak.js — Greedy line breaking over a shaped glyph stream.
 *
 * Break opportunities: after whitespace and hyphen.
 * Emergency break: mid-word when a single token exceeds the width.
 *
 * Simplification: we do not implement full UAX #14 line-break class handling.
 * Instead, break opportunities are marked pragmatically at whitespace and hyphens.
 * This is sufficient for Latin-script CV content.
 */

/**
 * @typedef {Object} ShapedGlyph
 * @property {number} glyphId
 * @property {string} char
 * @property {number} advanceMm
 * @property {boolean} isBreakOpportunityAfter
 * @property {boolean} isWhitespace
 * @property {Object} [style] optional RunStyle carried through the pipeline
 */

/**
 * Visible width of a line: sum of advances excluding ALL trailing whitespace
 * (CSS collapses trailing spaces at a soft wrap, regardless of how many).
 * @param {ShapedGlyph[]} lineGlyphs
 * @returns {number}
 */
function visibleLineWidth(lineGlyphs) {
  let last = lineGlyphs.length - 1;
  while (last >= 0 && lineGlyphs[last].isWhitespace) last--;
  let w = 0;
  for (let j = 0; j <= last; j++) w += lineGlyphs[j].advanceMm;
  return w;
}

/**
 * Break a shaped glyph stream into lines for a fixed content width.
 *
 * @param {ShapedGlyph[]} glyphs
 * @param {number} contentWidthMm
 * @returns {Array<{glyphs:ShapedGlyph[], widthMm:number}>}
 */
export function breakLines(glyphs, contentWidthMm) {
  if (glyphs.length === 0) {
    return [{ glyphs: [], widthMm: 0 }];
  }

  if (contentWidthMm <= 0) {
    // Defensive: emergency-break every glyph
    return glyphs.map(g => ({ glyphs: [g], widthMm: g.advanceMm }));
  }

  const lines = [];
  let currentGlyphs = [];
  let currentWidth = 0;
  let lastBreakIdx = -1; // index in currentGlyphs of last break opportunity

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];

    // Collapse leading whitespace on continuation lines
    if (currentGlyphs.length === 0 && g.isWhitespace) {
      continue;
    }

    // Check if adding this glyph would overflow
    const wouldOverflow = currentWidth + g.advanceMm > contentWidthMm;

    if (wouldOverflow) {
      if (lastBreakIdx >= 0) {
        // Break after the last break opportunity
        const breakAfter = lastBreakIdx;
        const lineGlyphs = currentGlyphs.slice(0, breakAfter + 1);

        lines.push({ glyphs: lineGlyphs, widthMm: visibleLineWidth(lineGlyphs) });

        // Start new line with remaining glyphs (skip leading whitespace)
        const remaining = currentGlyphs.slice(breakAfter + 1);
        currentGlyphs = remaining.filter((rg, idx) => !(idx === 0 && rg.isWhitespace));
        currentWidth = currentGlyphs.reduce((sum, cg) => sum + cg.advanceMm, 0);
        lastBreakIdx = -1;

        // Re-evaluate this glyph for the new line
        i--;
        continue;
      } else {
        // Emergency break: no break opportunity on this line
        // Break before the current glyph (mid-word)
        if (currentGlyphs.length === 0) {
          // This glyph alone exceeds width — put it on its own line
          lines.push({ glyphs: [g], widthMm: g.advanceMm });
          currentGlyphs = [];
          currentWidth = 0;
          lastBreakIdx = -1;
          continue;
        } else {
          lines.push({ glyphs: currentGlyphs, widthMm: currentWidth });
          currentGlyphs = [];
          currentWidth = 0;
          lastBreakIdx = -1;
          i--; // retry this glyph on the new line
          continue;
        }
      }
    }

    currentGlyphs.push(g);
    currentWidth += g.advanceMm;

    if (g.isBreakOpportunityAfter) {
      lastBreakIdx = currentGlyphs.length - 1;
    }
  }

  // Flush final line
  if (currentGlyphs.length > 0) {
    lines.push({ glyphs: currentGlyphs, widthMm: visibleLineWidth(currentGlyphs) });
  }

  // All-whitespace text: leading-whitespace collapse consumed everything,
  // so currentGlyphs is empty. Produce one empty line per spec.
  if (lines.length === 0) {
    lines.push({ glyphs: [], widthMm: 0 });
  }

  return lines;
}
