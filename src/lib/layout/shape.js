/**
 * shape.js — Shape a single styled run with fontkit.
 *
 * Applies text-transform, shapes with real GPOS kerning/ligatures,
 * converts advances to mm, adds letter-spacing, and marks break opportunities.
 */

import { advanceToMm } from './units.js';

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
 * @typedef {Object} ShapedGlyph
 * @property {number} glyphId
 * @property {string} char
 * @property {number} advanceMm
 * @property {boolean} isBreakOpportunityAfter
 * @property {boolean} isWhitespace
 * @property {Object} [style] optional RunStyle carried through the pipeline
 */

/**
 * Shape a run of text using fontkit.
 *
 * @param {string} text
 * @param {RunStyle} runStyle
 * @returns {ShapedGlyph[]}
 */
export function shapeRun(text, runStyle) {
  // 1. Apply textTransform first (uppercase changes glyphs and widths)
  const transformedText = runStyle.textTransform === 'uppercase'
    ? text.toUpperCase()
    : text;

  // 2. Shape with fontkit — this applies real GPOS kerning and ligatures
  const run = runStyle.font.layout(transformedText);

  const glyphs = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const codePoints = glyph.codePoints;
    const char = codePoints.length > 0
      ? String.fromCodePoint(...codePoints)
      : '';

    // Use fontkit's GPOS-adjusted advance (kerning, ligatures, etc.)
    // run.positions[i].xAdvance is the shaped advance including kerning.
    const position = run.positions[i];
    const advanceUnits = position?.xAdvance ?? glyph.advanceWidth ?? 0;
    let advanceMm = advanceToMm(advanceUnits, runStyle.unitsPerEm, runStyle.fontSizeMm);

    // 4. Add letter-spacing (CSS tracking after every glyph)
    advanceMm += runStyle.letterSpacingMm;

    const isWhitespace = /\s/.test(char);

    // 5. Mark break opportunities after whitespace and hyphen.
    // NOTE: This is a pragmatic simplification — full UAX #14 line-break class
    // handling (e.g. breaks between letters and numbers, emoji boundaries, etc.)
    // is not implemented. For Latin-script CV content, whitespace + hyphen
    // cover the common cases and the emergency-break path handles the rest.
    const isBreakOpportunityAfter = isWhitespace || char === '-';

    glyphs.push({
      glyphId: glyph.id,
      char,
      advanceMm,
      isBreakOpportunityAfter,
      isWhitespace,
    });
  }

  return glyphs;
}
