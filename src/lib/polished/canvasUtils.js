/**
 * Shared canvas utilities for collision detection across all block types.
 * Uses physical mm-based rectangle overlap so gutter elements, column blocks,
 * and any future element types are all checked uniformly.
 */

import { ROW_MM } from '../layout/index.js';

/**
 * Convert a canvas placement to a physical mm rectangle.
 * Works for both column blocks (colSpan >= 1) and gutter elements (colSpan === 0).
 */
export function canvasToRect(canvas, colWidth, paddingMm) {
  let left, width;

  if (canvas.colSpan === 0) {
    // Gutter element: positioned in the 4mm gap after column `col`
    left = paddingMm + canvas.col * (colWidth + 4) + colWidth;
    width = 4;
  } else {
    // Column element: standard grid positioning
    left = paddingMm + canvas.col * (colWidth + 4);
    width = canvas.colSpan * colWidth + (canvas.colSpan - 1) * 4;
  }

  const top = paddingMm + canvas.row * ROW_MM;
  const height = canvas.rowSpan * ROW_MM;

  return { left, top, right: left + width, bottom: top + height };
}

/**
 * Check if two mm-rectangles overlap (exclusive edges — touching is not overlap).
 */
export function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left &&
         a.top  < b.bottom && a.bottom > b.top;
}

/**
 * Check if placing a candidate block would overlap any existing block on the same page.
 * @returns {boolean} true if there is a collision
 */
export function anyOverlap(blocksList, candidateId, pageNum, candidateCanvas, colWidth, paddingMm) {
  const candidateRect = canvasToRect(candidateCanvas, colWidth, paddingMm);

  for (const b of blocksList) {
    if (!b.canvas || b.id === candidateId) continue;
    if (b.canvas.page !== pageNum) continue;
    const existingRect = canvasToRect(b.canvas, colWidth, paddingMm);
    if (rectsOverlap(candidateRect, existingRect)) return true;
  }
  return false;
}

/**
 * Find ALL block IDs that overlap with at least one other block on the same page.
 * Returns a Set of overlapping block IDs.
 */
export function findOverlappingIds(blocksList, colWidth, paddingMm) {
  const overlapping = new Set();
  const placed = blocksList.filter(b => b.canvas !== null && b.canvas !== undefined);

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.canvas.page !== b.canvas.page) continue;
      const rectA = canvasToRect(a.canvas, colWidth, paddingMm);
      const rectB = canvasToRect(b.canvas, colWidth, paddingMm);
      if (rectsOverlap(rectA, rectB)) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }

  return overlapping;
}
