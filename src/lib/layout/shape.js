/**
 * shape.js — Shape a single styled run with fontkit.
 *
 * Applies text-transform, shapes with real GPOS kerning (ligatures deliberately
 * disabled — see shapeRun), converts advances to mm, adds letter-spacing, and
 * marks break opportunities.
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

  // 2. Shape with fontkit. Apply real GPOS kerning, but DISABLE ligature/contextual
  // GSUB features. The engine's contract is one shaped glyph per codepoint: render-svg
  // emits one absolute x per glyph and render-pdf draws one char per glyph. If fontkit
  // formed a ligature (e.g. "ffl" → one glyph carrying 3 codePoints), the SVG <text>
  // would hold 3 chars against 1 x value and the browser (which we tell NOT to re-ligate)
  // would auto-advance the extras, desyncing every subsequent glyph; the PDF would draw a
  // 3-char string at a single point. Inter never ligates, but Lora/Playfair/Outfit/Space
  // Grotesk all form fi/fl/ff ligatures by default — so this guard is load-bearing for
  // every template except `clean`. Disabling these GSUB features leaves GPOS kerning
  // untouched (verified: AV/To/Wa advances are identical with the features off).
  const run = runStyle.font.layout(transformedText, { liga: false, clig: false, dlig: false, calt: false });

  const glyphs = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const codePoints = glyph.codePoints;

    // Strip trailing variation selectors / zero-width joiners so char is
    // a single UTF-16 unit.  SVG <text x="..."> consumes one x per UTF-16
    // code unit; a multi-unit char would desync the renderer's x-list.
    const isVS = (cp) =>
      (cp >= 0xFE00 && cp <= 0xFE0F) ||
      (cp >= 0xE0100 && cp <= 0xE01EF) ||
      cp === 0x200D;
    const base = codePoints.filter(cp => !isVS(cp));
    const char = base.length > 0
      ? String.fromCodePoint(...base)
      : (codePoints.length > 0 ? String.fromCodePoint(codePoints[0]) : '');

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
      // Trailing letter-spacing baked into advanceMm — carried so the line breaker
      // can trim it at a line end (CSS hangs trailing tracking, like trailing space).
      letterSpacingMm: runStyle.letterSpacingMm,
      isBreakOpportunityAfter,
      isWhitespace,
    });
  }

  return glyphs;
}
