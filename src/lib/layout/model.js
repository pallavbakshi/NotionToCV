/**
 * model.js — Layout-model type contract and factory helpers.
 *
 * "Frozen" here means the *contract* (shape, field names, units) is documented
 * upfront in this file and is the authoritative reference for every later phase.
 * Runtime values returned by factories are plain (non-frozen) objects — consumers
 * in later phases may attach renderer-specific fields as needed.
 *
 * JSDoc typedefs throughout; plain JS, no TypeScript.
 */

// ---------------------------------------------------------------------------
// Phase 0 types (data-only, no layout logic)
// ---------------------------------------------------------------------------

/**
 * A maximal span of text sharing one RunStyle (produced in Phase 2).
 * @typedef {Object} StyleRun
 * @property {string} text
 * @property {Object} style
 */

/**
 * A shaped glyph before line-breaking (produced in Phase 1).
 * @typedef {Object} ShapedGlyph
 * @property {number} glyphId
 * @property {string} char
 * @property {number} advanceMm
 * @property {boolean} isBreakOpportunityAfter
 * @property {boolean} isWhitespace
 */

// ---------------------------------------------------------------------------
// Phase 1+ types (positioned output)
// ---------------------------------------------------------------------------

/**
 * One positioned glyph inside a line.
 * @typedef {Object} LaidOutGlyph
 * @property {number} glyphId
 * @property {string} char
 * @property {number} xMm — left edge within the block content box
 * @property {number} advanceMm
 * @property {import('fontkit').Font} font
 * @property {number} unitsPerEm
 * @property {number} fontSizeMm
 * @property {string} color
 * @property {boolean} underline
 * @property {boolean} strike
 * @property {Object} faux
 * @property {boolean} faux.italic
 * @property {boolean} faux.bold
 */

/**
 * One visual line inside a block.
 * @typedef {Object} LaidOutLine
 * @property {LaidOutGlyph[]} glyphs
 * @property {number} baselineYMm — baseline offset from block content-box top
 * @property {number} ascentMm
 * @property {number} descentMm
 * @property {number} widthMm
 * @property {number} lineHeightMm
 */

/**
 * The engine's final output for one block.
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
 * @property {Object|null} decorations — { borderBottom?: { widthPt, color, yMm }, borderLeft?: { widthMm, color, paddingLeftMm } }
 * @property {string} kind — 'text' or 'passthrough'
 * @property {string} placement — 'placed' or 'unplaced'
 * @property {Object} [passthrough] — descriptor for divider/headshot (Phase 3); undefined for text blocks
 */

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty text LaidOutBlock for a block with no content.
 * @param {string} blockId
 * @param {string} blockType
 * @param {{leftMm:number,topMm:number,widthMm:number,heightMm:number}} rect
 * @returns {LaidOutBlock}
 */
export function emptyBlock(blockId, blockType, rect) {
  return {
    blockId,
    blockType,
    lines: [],
    contentWidthMm: rect.widthMm,
    blockWidthMm: rect.widthMm,
    blockHeightMm: rect.heightMm,
    usedHeightMm: 0,
    overflow: false,
    maxLines: 0,
    linesRemaining: 0,
    decorations: null,
    kind: 'text',
    placement: 'placed',
    passthrough: undefined,
  };
}

/**
 * Small epsilon for overflow comparisons.
 */
export const EPSILON = 0.01; // mm
