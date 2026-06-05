/**
 * units.js — Grid constants and unit conversions for the layout engine.
 * mm is canonical; px and pt are derived.
 */

// A4 page
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;

// Grid
export const COLUMNS = 4;
export const GUTTER_MM = 4;
export const ROW_MM = 5;

/**
 * Column width in mm for a given page padding.
 * @param {number} paddingMm
 * @returns {number}
 */
export function colWidthMm(paddingMm) {
  return (PAGE_W_MM - 2 * paddingMm - GUTTER_MM * (COLUMNS - 1)) / COLUMNS;
}

// Conversions
/** @param {number} mm */
export const mmToPt = (mm) => mm * 72 / 25.4;

/** @param {number} mm */
export const mmToPx = (mm) => mm * 96 / 25.4;

/** @param {number} pt */
export const ptToMm = (pt) => pt * 25.4 / 72;

/**
 * Convert a fontkit advance (font units) → mm, given font size in mm.
 * @param {number} advanceUnits
 * @param {number} unitsPerEm
 * @param {number} fontSizeMm
 * @returns {number}
 */
export function advanceToMm(advanceUnits, unitsPerEm, fontSizeMm) {
  return (advanceUnits / unitsPerEm) * fontSizeMm;
}

/**
 * Compute a block's physical mm rectangle from its canvas placement.
 * MUST match canvasToRect / CanvasBlock.svelte math exactly.
 *
 * @param {{page:number,col:number,row:number,colSpan:number,rowSpan:number}} canvas
 * @param {number} paddingMm
 * @returns {{leftMm:number,topMm:number,widthMm:number,heightMm:number}}
 */
export function blockRectMm(canvas, paddingMm) {
  const cw = colWidthMm(paddingMm);
  const left = canvas.colSpan === 0
    ? paddingMm + canvas.col * (cw + GUTTER_MM) + cw
    : paddingMm + canvas.col * (cw + GUTTER_MM);
  const width = canvas.colSpan === 0 ? GUTTER_MM : canvas.colSpan * cw + (canvas.colSpan - 1) * GUTTER_MM;
  const top = paddingMm + canvas.row * ROW_MM;
  const height = canvas.rowSpan * ROW_MM;
  return { leftMm: left, topMm: top, widthMm: width, heightMm: height };
}
