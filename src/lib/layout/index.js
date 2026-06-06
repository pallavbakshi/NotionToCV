/**
 * index.js — Public entry point for the layout engine (Phases 0–3).
 *
 * Usage:
 *   await initFonts();
 *   const lo = computeLayout(block, blockRect, ctx);
 */

import { composeBlock, passthroughBlock, unplacedBlock, unplacedPassthrough } from './block.js';

/**
 * @typedef {Object} LaidOutBlock
 * @property {string} blockId
 * @property {string} blockType
 * @property {any[]} lines
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

export { initFonts, getFont, resolveRunStyle, effectiveBaseStyle, fontCategory } from './fonts.js';
export { getTypeStyle } from './template-metrics.js';
export { blockRectMm, colWidthMm, mmToPt, mmToPx, ptToMm, advanceToMm, PAGE_W_MM, PAGE_H_MM, COLUMNS, GUTTER_MM, ROW_MM } from './units.js';
export { emptyBlock, EPSILON } from './model.js';
export { shapeRun } from './shape.js';
export { breakLines } from './linebreak.js';
export { layoutSingleRun, layoutRuns } from './paragraph.js';
export { contentToRuns } from './runs.js';
export { renderBlockSVG } from './render-svg.js';
export { renderResumePDF } from './render-pdf.js';

/**
 * Compute the deterministic layout for any block.
 *
 * @param {Object} block
 * @param {{leftMm:number,topMm:number,widthMm:number,heightMm:number}|null} blockRect
 * @param {Object} ctx — { templateName, paddingMm, themeColors }
 * @returns {LaidOutBlock}
 */
export function computeLayout(block, blockRect, ctx) {
  const isTextBlock = ['paragraph', 'h1', 'h2', 'h3'].includes(block.type);
  const isCanvas = block.source === 'canvas';

  if (isCanvas || !isTextBlock) {
    if (blockRect == null) {
      return unplacedPassthrough(block);
    }
    return passthroughBlock(block, blockRect);
  }

  if (blockRect == null) {
    return unplacedBlock(block, ctx);
  }

  return composeBlock(block, blockRect, ctx);
}
