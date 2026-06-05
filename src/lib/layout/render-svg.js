/**
 * render-svg.js — Render a LaidOutBlock as an SVG element (string).
 *
 * glyphMode:'text' (default): <text> per line with explicit per-glyph x list.
 * glyphMode:'path': <path> per glyph for pixel-identical rendering.
 */

import { getFontBufferForFont } from './fonts.js';

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
 * @typedef {Object} LaidOutBlock
 * @property {string} blockId
 * @property {string} blockType
 * @property {LaidOutLine[]} lines
 * @property {number|null} blockWidthMm
 * @property {number|null} blockHeightMm
 * @property {number} usedHeightMm
 * @property {Object|null} decorations
 * @property {string} kind
 * @property {Object} passthrough
 */

/**
 * Render a LaidOutBlock as an SVG string.
 *
 * @param {LaidOutBlock} laidOutBlock
 * @param {{glyphMode?:'text'|'path', embedFonts?:boolean}} [opts]
 * @returns {string}
 */
export function renderBlockSVG(laidOutBlock, opts = {}) {
  const { glyphMode = 'text', embedFonts = false } = opts;
  const { blockWidthMm, blockHeightMm, lines, decorations, kind, passthrough } = laidOutBlock;

  // Unplaced blocks have no dimensions — nothing to render
  if (blockWidthMm == null || blockHeightMm == null) {
    return '';
  }

  if (kind === 'passthrough') {
    return renderPassthrough(laidOutBlock);
  }

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidthMm}mm" height="${blockHeightMm}mm" viewBox="0 0 ${blockWidthMm} ${blockHeightMm}">`);

  if (embedFonts) {
    // Embed font binaries as base64 data URLs for self-contained SVG
    const uniqueFonts = new Set();
    for (const line of lines) {
      for (const glyph of line.glyphs) {
        uniqueFonts.add(glyph.font);
      }
    }
    if (uniqueFonts.size > 0) {
      const defs = [];
      for (const font of uniqueFonts) {
        const buffer = getFontBufferForFont(font);
        if (buffer) {
          const base64 = arrayBufferToBase64(buffer);
          const family = escapeXml(font.familyName || 'sans-serif');
          const subfamily = font.subfamilyName || 'normal';
          const weight = font['OS/2']?.usWeightClass || 400;
          const fontStyle = subfamily.toLowerCase().includes('italic') ? 'italic' : 'normal';
          defs.push(`  <style>
    @font-face {
      font-family: "${family}";
      font-weight: ${weight};
      font-style: ${fontStyle};
      src: url("data:font/truetype;base64,${base64}") format("truetype");
    }
  </style>`);
        }
      }
      if (defs.length > 0) {
        parts.push('<defs>');
        parts.push(...defs);
        parts.push('</defs>');
      }
    }
  }

  // Decorations: border-left — drawn BEFORE text so it sits behind it
  // (SVG paints in document order; later elements are on top).
  if (decorations && decorations.borderLeft) {
    const { widthMm, color } = decorations.borderLeft;
    const contentHeightMm = lines.reduce((sum, line) => sum + line.lineHeightMm, 0);
    parts.push(`<rect x="0" y="0" width="${widthMm}" height="${contentHeightMm}" fill="${color}" />`);
  }

  // Render each line
  for (const line of lines) {
    if (glyphMode === 'text') {
      renderLineText(parts, line);
    } else {
      renderLinePath(parts, line);
    }
  }

  // Decorations: border-bottom
  if (decorations && decorations.borderBottom) {
    const { widthPt, color, yMm } = decorations.borderBottom;
    const widthMm = (widthPt * 25.4) / 72;
    parts.push(`<line x1="0" y1="${yMm + widthMm / 2}" x2="${blockWidthMm}" y2="${yMm + widthMm / 2}" stroke="${color}" stroke-width="${widthMm}" />`);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * Render one line using <text> with per-glyph x list.
 * @param {string[]} parts
 * @param {LaidOutLine} line
 */
function renderLineText(parts, line) {
  if (line.glyphs.length === 0) return;

  // Group contiguous glyphs with identical style into <text> spans.
  // Key insight: font binary identity matters — Inter Regular and Inter Bold
  // share the same familyName but must be in separate spans with different
  // font-weight values. We use g.font reference identity + size + color.
  const spans = [];
  let currentSpan = null;

  for (const g of line.glyphs) {
    const fontName = g.font.familyName || 'sans-serif';
    // Derive weight from the font binary's OS/2 table (usWeightClass), not faux.bold.
    const os2 = g.font['OS/2'];
    const weight = os2 ? String(os2.usWeightClass) : (g.faux.bold ? '700' : '400');
    // faux.italic / faux.bold are part of the grouping key: a faux run uses the
    // same (upright / lighter) binary but must be in a separate span so the
    // synthetic skew / stroke is applied only to it.
    const isFauxItalic = g.faux.italic;
    const isFauxBold = g.faux.bold;

    if (!currentSpan ||
        currentSpan.font !== g.font ||
        currentSpan.fontSizeMm !== g.fontSizeMm ||
        currentSpan.color !== g.color ||
        currentSpan.isFauxItalic !== isFauxItalic ||
        currentSpan.isFauxBold !== isFauxBold) {

      if (currentSpan) spans.push(currentSpan);
      currentSpan = {
        font: g.font, fontName, weight,
        isFauxItalic, isFauxBold,
        fontSizeMm: g.fontSizeMm,
        color: g.color,
        glyphs: [],
        xList: [],
      };
    }

    currentSpan.glyphs.push(g);
    currentSpan.xList.push(g.xMm.toFixed(3));
  }

  if (currentSpan) spans.push(currentSpan);

  for (const span of spans) {
    const xAttr = span.xList.join(' ');
    // Font size in USER UNITS (= mm here, matching the viewBox and the x list).
    const fontSize = span.fontSizeMm.toFixed(3);
    // Real italic binary (subfamily includes "italic") gets font-style="italic".
    // Faux italic gets a skewX transform instead — but pinned to the baseline via
    // an explicit matrix rather than the transform-origin attribute (which SVG
    // renderers honor inconsistently). matrix(1 0 c 1 e 0): x' = x + c·y + e, with
    // c = tan(-12°) and e = -c·baseline, so points on the baseline don't move.
    const isRealItalic = (span.font.subfamilyName || '').toLowerCase().includes('italic');
    let transform = '';
    if (span.isFauxItalic) {
      const c = Math.tan(-12 * Math.PI / 180);
      const e = -c * line.baselineYMm;
      transform = ` transform="matrix(1 0 ${c.toFixed(6)} 1 ${e.toFixed(4)} 0)"`;
    }
    const fontStyleAttr = isRealItalic ? ' font-style="italic"' : '';
    // Faux bold: the resolved binary is lighter than requested (no real bold in the
    // family). Thicken strokes synthetically with a same-color stroke over the fill.
    const strokeAttr = span.isFauxBold
      ? ` stroke="${span.color}" stroke-width="${(span.fontSizeMm * 0.03).toFixed(4)}"`
      : '';

    parts.push(`<text x="${xAttr}" y="${line.baselineYMm.toFixed(3)}" font-family="${span.fontName}" font-size="${fontSize}" font-weight="${span.weight}"${fontStyleAttr} fill="${span.color}"${strokeAttr}${transform}>`);

    // For <text> with x list, the characters are placed at the given x positions
    const chars = span.glyphs.map(g => escapeXml(g.char)).join('');
    parts.push(chars);
    parts.push('</text>');
  }

  // Underline / strike as drawn lines
  for (const g of line.glyphs) {
    if (g.underline) {
      const y = line.baselineYMm + (g.fontSizeMm * 0.15);
      parts.push(`<line x1="${g.xMm.toFixed(3)}" y1="${y.toFixed(3)}" x2="${(g.xMm + g.advanceMm).toFixed(3)}" y2="${y.toFixed(3)}" stroke="${g.color}" stroke-width="${(g.fontSizeMm * 0.05).toFixed(3)}" />`);
    }
    if (g.strike) {
      const y = line.baselineYMm - (g.fontSizeMm * 0.25);
      parts.push(`<line x1="${g.xMm.toFixed(3)}" y1="${y.toFixed(3)}" x2="${(g.xMm + g.advanceMm).toFixed(3)}" y2="${y.toFixed(3)}" stroke="${g.color}" stroke-width="${(g.fontSizeMm * 0.05).toFixed(3)}" />`);
    }
  }
}

/**
 * Render one line using <path> per glyph (pixel-identical).
 * @param {string[]} parts
 * @param {LaidOutLine} line
 */
function renderLinePath(parts, line) {
  for (const g of line.glyphs) {
    const fontGlyph = g.font.getGlyph(g.glyphId);
    if (!fontGlyph || !fontGlyph.path) continue;

    const svgPath = fontGlyph.path.toSVG();
    const scale = g.fontSizeMm / g.unitsPerEm;
    // fontkit glyph paths are Y-up (typographic); SVG is Y-down. Negate Y to flip,
    // so the baseline (y=0 in font space) lands on baselineYMm and ascenders go up.
    const transform = `translate(${g.xMm.toFixed(3)}, ${line.baselineYMm.toFixed(3)}) scale(${scale.toFixed(6)}, ${(-scale).toFixed(6)})`;

    parts.push(`<path d="${svgPath}" transform="${transform}" fill="${g.color}" />`);
  }
}

/**
 * Render a pass-through block (divider / headshot).
 * @param {LaidOutBlock} laidOutBlock
 * @returns {string}
 */
function renderPassthrough(laidOutBlock) {
  const { blockWidthMm, blockHeightMm, passthrough } = laidOutBlock;
  const pt = passthrough || {};

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidthMm}mm" height="${blockHeightMm}mm" viewBox="0 0 ${blockWidthMm} ${blockHeightMm}">`);

  if (pt.elementType === 'horizontal_divider' || pt.elementType === 'horizontal divider') {
    const y = blockHeightMm / 2;
    const color = pt.barColor || '#000000';
    const width = pt.barStyle === 'thick' ? 0.5 : 0.25;
    parts.push(`<line x1="0" y1="${y}" x2="${blockWidthMm}" y2="${y}" stroke="${color}" stroke-width="${width}" />`);
  } else if (pt.elementType === 'vertical_divider' || pt.elementType === 'vertical divider') {
    const x = blockWidthMm / 2;
    const color = pt.barColor || '#000000';
    const width = pt.barStyle === 'thick' ? 0.5 : 0.25;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${blockHeightMm}" stroke="${color}" stroke-width="${width}" />`);
  } else if (pt.elementType === 'headshot') {
    // Only allow data: image URLs — never an arbitrary (e.g. javascript:) href.
    if (pt.imageData && /^data:image\//i.test(pt.imageData)) {
      parts.push(`<image href="${escapeXml(pt.imageData)}" x="0" y="0" width="${blockWidthMm}" height="${blockHeightMm}" preserveAspectRatio="xMidYMid slice" />`);
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * Escape XML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert an ArrayBuffer to a base64 string.
 * Works in both browser and Node.js.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  // Node.js fallback
  return Buffer.from(binary, 'binary').toString('base64');
}
