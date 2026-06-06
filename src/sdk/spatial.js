// Pure spatial helpers used by the AI agent's read_block tool.
// Zero Svelte or browser dependencies — just geometry over block canvas coords.
// Grid constants imported from the layout engine (single source of truth).

import { GUTTER_MM, ROW_MM } from '../lib/layout/index.js';

export function canvasToRect(canvas, colWidth, paddingMm) {
  let left, width;
  if (canvas.colSpan === 0) {
    left = paddingMm + canvas.col * (colWidth + GUTTER_MM) + colWidth;
    width = GUTTER_MM;
  } else {
    left = paddingMm + canvas.col * (colWidth + GUTTER_MM);
    width = canvas.colSpan * colWidth + (canvas.colSpan - 1) * GUTTER_MM;
  }
  const top = paddingMm + canvas.row * ROW_MM;
  const height = canvas.rowSpan * ROW_MM;
  return { left, top, right: left + width, bottom: top + height };
}

export function findNeighbors(blockId, blocksList, colWidth, paddingMm) {
  const block = blocksList.find(b => b.id === blockId);
  if (!block || !block.canvas) return { above: null, below: null, left: null, right: null };

  const pageNum = block.canvas.page;
  const rect = canvasToRect(block.canvas, colWidth, paddingMm);

  let bestAbove = null, bestBelow = null, bestLeft = null, bestRight = null;

  for (const b of blocksList) {
    if (!b.canvas || b.id === blockId || b.canvas.page !== pageNum) continue;
    const r = canvasToRect(b.canvas, colWidth, paddingMm);

    // Check above
    if (r.bottom <= rect.top && r.right > rect.left && r.left < rect.right) {
      if (!bestAbove || r.bottom > bestAbove.rect.bottom) {
        bestAbove = { block: b, rect: r };
      }
    }
    // Check below
    if (r.top >= rect.bottom && r.right > rect.left && r.left < rect.right) {
      if (!bestBelow || r.top < bestBelow.rect.top) {
        bestBelow = { block: b, rect: r };
      }
    }
    // Check left
    if (r.right <= rect.left && r.bottom > rect.top && r.top < rect.bottom) {
      if (!bestLeft || r.right > bestLeft.rect.right) {
        bestLeft = { block: b, rect: r };
      }
    }
    // Check right
    if (r.left >= rect.right && r.bottom > rect.top && r.top < rect.bottom) {
      if (!bestRight || r.left < bestRight.rect.left) {
        bestRight = { block: b, rect: r };
      }
    }
  }

  const formatNeighbor = (nb) => {
    if (!nb) return null;
    const text = nb.block.content?.map(n => n.text || '').join('') || '';
    return {
      id: nb.block.id,
      type: nb.block.type,
      name: nb.block.name,
      content_plaintext_snippet: text.slice(0, 60)
    };
  };

  return {
    above: formatNeighbor(bestAbove),
    below: formatNeighbor(bestBelow),
    left: formatNeighbor(bestLeft),
    right: formatNeighbor(bestRight)
  };
}
