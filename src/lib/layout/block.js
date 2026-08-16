/**
 * block.js — Block composition: hardBreak segmentation, vertical stacking,
 * decoration metrics, and final totals.
 *
 * Assembles a complete LaidOutBlock from inline content.
 */

import { effectiveBaseStyle, resolveRunStyle } from './fonts.js';
import { contentToRuns } from './runs.js';
import { layoutRuns } from './paragraph.js';
import { ptToMm } from './units.js';
import { EPSILON } from './model.js';

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
 * Compose a complete block from its content and produce a LaidOutBlock.
 *
 * @param {Object} block — the app's block object
 * @param {{leftMm:number,topMm:number,widthMm:number,heightMm:number}} blockRect
 * @param {Object} ctx — { templateName, paddingMm, themeColors }
 * @returns {LaidOutBlock}
 */
export function composeBlock(block, blockRect, ctx) {
  const { templateName, themeColors } = ctx;
  const blockType = block.type;
  const baseStyle = effectiveBaseStyle(templateName, blockType, themeColors);

  // Split content by hardBreak nodes
  const segments = splitByHardBreak(block.content || []);

  // Horizontal insets (border-left + padding-left)
  const leftInsetMm = (baseStyle.borderLeft?.widthMm || 0) + (baseStyle.paddingLeftMm || 0);
  const contentWidthMm = blockRect.widthMm - leftInsetMm;

  // Vertical insets (padding-top + padding-bottom)
  const paddingTopMm = baseStyle.paddingTopMm || 0;
  const paddingBottomMm = baseStyle.paddingBottomMm || 0;
  const contentHeightLimitMm = Math.max(0, blockRect.heightMm - paddingTopMm - paddingBottomMm);

  // Lay out each segment
  const allLines = [];
  let runningYOffset = paddingTopMm;

  for (const segment of segments) {
    if (segment.length === 0) {
      // Empty segment (consecutive hardBreaks) → one empty line
      allLines.push(emptyLine(baseStyle, runningYOffset));
      runningYOffset += baseStyle.lineHeightMm;
      continue;
    }

    const runs = contentToRuns(segment, baseStyle);
    const laidOut = layoutRuns(runs, contentWidthMm, contentHeightLimitMm, {
      blockId: block.id,
      blockType,
      align: block.canvas?.align || 'left',
    });

    // Re-base each line's baselineYMm against the running vertical cursor
    for (const line of laidOut.lines) {
      line.baselineYMm += runningYOffset;
      allLines.push(line);
    }

    runningYOffset += laidOut.usedHeightMm;
  }

  // Offset glyph xMm by left inset so positions are absolute within the block
  if (leftInsetMm > 0) {
    for (const line of allLines) {
      for (const glyph of line.glyphs) {
        glyph.xMm += leftInsetMm;
      }
    }
  }

  // Decorations
  const decorations = {};
  let borderHeightMm = 0;
  if (baseStyle.borderBottom) {
    borderHeightMm = ptToMm(baseStyle.borderBottom.widthPt);
    decorations.borderBottom = {
      widthPt: baseStyle.borderBottom.widthPt,
      color: baseStyle.borderBottom.color,
      yMm: runningYOffset + paddingBottomMm,
    };
  }
  if (baseStyle.borderLeft) {
    decorations.borderLeft = {
      widthMm: baseStyle.borderLeft.widthMm,
      color: baseStyle.borderLeft.color,
      paddingLeftMm: baseStyle.paddingLeftMm || 0,
      heightMm: runningYOffset + paddingBottomMm,
    };
  }
  const usedHeightMm = runningYOffset + paddingBottomMm + borderHeightMm;

  const isHeading = ['h1', 'h2', 'h3', 'h4'].includes(blockType);
  let charsHeight = 0;
  let visualAscentMm = 0;
  let visualDescentMm = 0;

  if (isHeading && allLines.length > 0) {
    const headingRunStyle = resolveRunStyle(baseStyle, []);
    const font = headingRunStyle.font;
    const unitsPerEm = headingRunStyle.unitsPerEm;
    const capHeight = font.capHeight !== undefined ? font.capHeight : font.ascent;
    visualAscentMm = (capHeight / unitsPerEm) * baseStyle.fontSizeMm;
    visualDescentMm = Math.abs((font.descent / unitsPerEm) * baseStyle.fontSizeMm);
    const firstLine = allLines[0];
    const lastLine = allLines[allLines.length - 1];
    charsHeight = (lastLine.baselineYMm + visualDescentMm) - (firstLine.baselineYMm - visualAscentMm);
  }

  // Heading overflow is determined by character height bounds (not line-height metric),
  // avoiding false overflow warnings on single-row blocks.
  const overflow = isHeading
    ? (charsHeight + paddingTopMm + paddingBottomMm + borderHeightMm) > blockRect.heightMm + EPSILON
    : (usedHeightMm - borderHeightMm) > blockRect.heightMm + EPSILON;

  // Apply vertical centering for headings (h1, h2, h3, h4) if there is unused height based on characters
  if (isHeading && !overflow && allLines.length > 0) {
    const extraSpaceCharsMm = blockRect.heightMm - borderHeightMm - paddingTopMm - paddingBottomMm - charsHeight;
    if (extraSpaceCharsMm > 0) {
      const firstLine = allLines[0];
      const leadingAbove0 = firstLine.baselineYMm - paddingTopMm - visualAscentMm;
      const shiftYMm = extraSpaceCharsMm / 2 - leadingAbove0;
      for (const line of allLines) {
        line.baselineYMm += shiftYMm;
      }
      if (decorations.borderLeft) {
        decorations.borderLeft.heightMm = blockRect.heightMm;
      }
      if (decorations.borderBottom) {
        decorations.borderBottom.yMm = blockRect.heightMm - borderHeightMm;
      }
    }
  }

  const finalDecorations = Object.keys(decorations).length > 0 ? decorations : null;
  const baseLineHeight = baseStyle.lineHeightMm;
  const maxLines = baseLineHeight > 0 ? Math.floor(blockRect.heightMm / baseLineHeight) : 0;
  const linesRemaining = maxLines - allLines.length;

  return {
    blockId: block.id,
    blockType,
    lines: allLines,
    contentLeftMm: leftInsetMm,
    contentWidthMm,
    blockWidthMm: blockRect.widthMm,
    blockHeightMm: blockRect.heightMm,
    usedHeightMm,
    overflow,
    maxLines,
    linesRemaining,
    decorations: finalDecorations,
    kind: 'text',
    placement: 'placed',
    passthrough: undefined,
  };
}

/**
 * Build an empty line (consecutive hardBreaks / empty content) whose baseline matches
 * a real one-line text run of the same base style — CSS half-leading + ascent, NOT a
 * naive lineHeight/2 (which would make a caret/first char jump when text is added).
 * @param {Object} baseStyle
 * @param {number} runningYOffset
 * @returns {Object}
 */
function emptyLine(baseStyle, runningYOffset) {
  const run = resolveRunStyle(baseStyle, []);
  const ascentMm = (run.font.ascent / run.unitsPerEm) * baseStyle.fontSizeMm;
  const descentMm = Math.abs((run.font.descent / run.unitsPerEm) * baseStyle.fontSizeMm);
  const leadingAboveMm = (baseStyle.lineHeightMm - (ascentMm + descentMm)) / 2;
  return {
    glyphs: [],
    baselineYMm: runningYOffset + leadingAboveMm + ascentMm,
    ascentMm,
    descentMm,
    widthMm: 0,
    lineHeightMm: baseStyle.lineHeightMm,
  };
}

/**
 * Split flat inline nodes into segments at hardBreak boundaries.
 * @param {Array<any>} inlineNodes
 * @returns {Array<Array<any>>}
 */
function splitByHardBreak(inlineNodes) {
  const segments = [];
  let current = [];

  for (const node of inlineNodes) {
    if (node.type === 'hardBreak') {
      segments.push(current);
      current = [];
    } else {
      current.push(node);
    }
  }

  segments.push(current);
  return segments;
}

// ---------------------------------------------------------------------------
// Pass-through blocks
// ---------------------------------------------------------------------------

/**
 * Produce a pass-through LaidOutBlock for non-text canvas elements.
 *
 * @param {Object} block
 * @param {{leftMm:number,topMm:number,widthMm:number,heightMm:number}} blockRect
 * @returns {LaidOutBlock}
 */
export function passthroughBlock(block, blockRect) {
  return {
    blockId: block.id,
    blockType: block.type,
    lines: [],
    contentLeftMm: 0,
    contentWidthMm: blockRect.widthMm,
    blockWidthMm: blockRect.widthMm,
    blockHeightMm: blockRect.heightMm,
    usedHeightMm: blockRect.heightMm,
    overflow: false,
    maxLines: 0,
    linesRemaining: 0,
    decorations: null,
    kind: 'passthrough',
    placement: 'placed',
    passthrough: {
      elementType: block.elementType || block.type,
      imageData: block.imageData,
      barStyle: block.canvas?.barStyle || block.barStyle,
      barColor: block.canvas?.barColor || block.barColor,
    },
  };
}

// ---------------------------------------------------------------------------
// Unplaced blocks
// ---------------------------------------------------------------------------

/**
 * Produce an unplaced LaidOutBlock laid out at unconstrained width.
 *
 * @param {Object} block
 * @param {Object} ctx — { templateName, themeColors }
 * @returns {LaidOutBlock}
 */
export function unplacedBlock(block, ctx) {
  const { templateName, themeColors } = ctx;
  const blockType = block.type;
  const baseStyle = effectiveBaseStyle(templateName, blockType, themeColors);
  const paddingTopMm = baseStyle.paddingTopMm || 0;
  const paddingBottomMm = baseStyle.paddingBottomMm || 0;

  // Split by hardBreak, lay out each segment at unconstrained width
  const segments = splitByHardBreak(block.content || []);
  const allLines = [];
  let runningYOffset = paddingTopMm;

  for (const segment of segments) {
    if (segment.length === 0) {
      allLines.push(emptyLine(baseStyle, runningYOffset));
      runningYOffset += baseStyle.lineHeightMm;
      continue;
    }

    const runs = contentToRuns(segment, baseStyle);
    // Unconstrained width: use a very large number so no wrapping occurs
    const UNCONSTRAINED = 10000;
    const laidOut = layoutRuns(runs, UNCONSTRAINED, UNCONSTRAINED, {
      blockId: block.id,
      blockType,
    });

    for (const line of laidOut.lines) {
      line.baselineYMm += runningYOffset;
      allLines.push(line);
    }

    runningYOffset += laidOut.usedHeightMm;
  }

  const usedHeightMm = runningYOffset + paddingBottomMm;

  return {
    blockId: block.id,
    blockType,
    lines: allLines,
    contentLeftMm: 0,
    contentWidthMm: null,
    blockWidthMm: null,
    blockHeightMm: null,
    usedHeightMm,
    overflow: false,
    maxLines: null,
    linesRemaining: null,
    decorations: null,
    kind: 'text',
    placement: 'unplaced',
    passthrough: undefined,
  };
}

// ---------------------------------------------------------------------------
// Unplaced pass-through blocks
// ---------------------------------------------------------------------------

/**
 * Produce an unplaced LaidOutBlock for non-text canvas elements.
 *
 * @param {Object} block
 * @returns {LaidOutBlock}
 */
export function unplacedPassthrough(block) {
  return {
    blockId: block.id,
    blockType: block.type,
    lines: [],
    contentLeftMm: 0,
    contentWidthMm: null,
    blockWidthMm: null,
    blockHeightMm: null,
    usedHeightMm: 0,
    overflow: false,
    maxLines: null,
    linesRemaining: null,
    decorations: null,
    kind: 'passthrough',
    placement: 'unplaced',
    passthrough: {
      elementType: block.elementType || block.type,
      imageData: block.imageData,
      barStyle: block.canvas?.barStyle || block.barStyle,
      barColor: block.canvas?.barColor || block.barColor,
    },
  };
}
