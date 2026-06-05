/**
 * runs.js — Convert flat inline Tiptap content into StyleRun[].
 *
 * Iterates text nodes, resolves per-node RunStyle via resolveRunStyle,
 * and coalesces adjacent nodes with structurally equal styles.
 */

import { resolveRunStyle } from './fonts.js';

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
 * Convert a flat inline node array (hardBreak-free) into StyleRun[].
 *
 * @param {Array<{type:string,text:string,marks?:Array}>} inlineNodes
 * @param {Object} baseStyle — effective base style from effectiveBaseStyle()
 * @returns {StyleRun[]}
 */
export function contentToRuns(inlineNodes, baseStyle) {
  const runs = [];

  for (const node of inlineNodes) {
    if (node.type !== 'text' || !node.text) continue;
    if (node.text.length === 0) continue;

    const style = resolveRunStyle(baseStyle, node.marks || []);

    // Try to coalesce with the previous run if styles match
    if (runs.length > 0) {
      const prev = runs[runs.length - 1];
      if (runStylesEqual(prev.style, style)) {
        prev.text += node.text;
        continue;
      }
    }

    runs.push({ text: node.text, style });
  }

  return runs;
}

/**
 * Check two RunStyles for structural equality (same font identity, size, color, flags).
 * @param {RunStyle} a
 * @param {RunStyle} b
 * @returns {boolean}
 */
function runStylesEqual(a, b) {
  return (
    a.font === b.font &&
    a.unitsPerEm === b.unitsPerEm &&
    a.fontSizeMm === b.fontSizeMm &&
    a.lineHeightMm === b.lineHeightMm &&
    a.color === b.color &&
    a.letterSpacingMm === b.letterSpacingMm &&
    a.textTransform === b.textTransform &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.faux.italic === b.faux.italic &&
    a.faux.bold === b.faux.bold
  );
}
