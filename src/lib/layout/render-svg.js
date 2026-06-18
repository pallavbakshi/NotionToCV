/**
 * render-svg.js — Render a LaidOutBlock as an SVG element (string).
 *
 * glyphMode:'text' (default): <text> per line with explicit per-glyph x list. This
 *   is the only mode the app uses and the one that supports faux bold/italic,
 *   underline, and strike.
 * glyphMode:'path': <path> per glyph (true glyph outlines, no font needed). NOTE:
 *   this mode does not currently emit faux bold/italic skew, underline, or strike —
 *   it is not wired into the app and exists for outline export experiments only.
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
  // overflow="visible": an SVG's UA default is overflow:hidden, which would clip a
  // faux-italic ascender skewed past the right edge — but pdf-lib never clips, so
  // clipping here would break screen/print parity. Parents are already overflow:visible.
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidthMm}mm" height="${blockHeightMm}mm" viewBox="0 0 ${blockWidthMm} ${blockHeightMm}" overflow="visible">`);

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
    const { widthMm, color, heightMm } = decorations.borderLeft;
    const h = heightMm !== undefined ? heightMm : lines.reduce((sum, line) => sum + line.lineHeightMm, 0);
    parts.push(`<rect x="0" y="0" width="${widthMm}" height="${h}" fill="${escapeXml(color)}" />`);
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
    parts.push(`<line x1="0" y1="${yMm + widthMm / 2}" x2="${blockWidthMm}" y2="${yMm + widthMm / 2}" stroke="${escapeXml(color)}" stroke-width="${widthMm}" />`);
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

    // Approach B: skip whitespace glyphs. Spaces carry no ink — their
    // horizontal offset is already baked into the next visible glyph's xMm.
    // Emitting them forces the browser's whitespace-collapsing behavior into
    // play. The PDF renderer draws each visible glyph at its absolute x
    // without spaces; SVG matches that model.
    if (/\s/.test(g.char)) continue;

    currentSpan.glyphs.push(g);
    currentSpan.xList.push(g.xMm.toFixed(3));
    // SVG <text x="..."> assigns one x per UTF-16 code unit, not per glyph.
    // Pad the x-list so the count matches char.length for multi-unit glyphs
    // (astral base characters, ZWJ sequences, combining marks not stripped
    // by the shaper).  Repeating the same x is correct: every code unit of
    // one glyph occupies the same pen position.
    for (let j = 1; j < g.char.length; j++) {
      currentSpan.xList.push(g.xMm.toFixed(3));
    }
  }

  if (currentSpan) spans.push(currentSpan);

  // Dev guard: verify that per-span x-list length equals the total UTF-16 code
  // units of the visible (non-whitespace) glyph chars.  Whitespace glyphs are
  // skipped — both glyphs[] and xList[] exclude them, so the count stays in sync.
  // A mismatch means a multi-unit visible char slipped through and the browser
  // will assign x-values to the wrong characters.
  for (const s of spans) {
    const totalUnits = s.glyphs.reduce((n, g) => n + g.char.length, 0);
    if (totalUnits !== s.xList.length) {
      console.warn(
        '[render-svg] x-list desync — x entries:', s.xList.length,
        'utf-16 units:', totalUnits,
        'glyphs:', s.glyphs.map(g => [...g.char].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join('+')),
      );
    }
  }

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
    const chars = span.glyphs.map(g => escapeXml(g.char)).join('');

    // The engine already shaped this run (one absolute x per glyph, GPOS kerning
    // baked in) and deliberately did NOT form ligatures. The browser, however,
    // re-shapes <text> content by default: if it forms a ligature (e.g. "fl"),
    // two characters collapse into one glyph and the per-character x list desyncs,
    // shifting every glyph after it. Disable browser kerning/ligatures so our
    // explicit positions are honored verbatim — and so screen matches the PDF. The
    // PDF draws each glyph's char individually at the engine's absolute x (it does no
    // GSUB shaping), and the shaper now disables ligatures, so neither path ligates.
    const NO_RESHAPE = ` font-kerning="none" style="font-variant-ligatures:none;font-feature-settings:'liga' 0,'clig' 0,'dlig' 0,'calt' 0"`;

    // Emit the span as a <text> with the given per-glyph x list.
    // Single parts.push() keeps the text content inline with the tag — no
    // formatting whitespace that could be interpreted as renderable characters.
    const emit = (xs) => {
      parts.push(`<text x="${xs}" y="${line.baselineYMm.toFixed(3)}" font-family="${escapeXml(span.fontName)}" font-size="${fontSize}" font-weight="${span.weight}"${fontStyleAttr} fill="${escapeXml(span.color)}"${transform}${NO_RESHAPE}>${chars}</text>`);
    };

    emit(xAttr);
    // Faux bold: resolved binary is lighter than requested (no real bold in the
    // family). Synthesize bold by overprinting at +2% em — IDENTICAL to the PDF
    // renderer, so screen and print thicken the same way (horizontal overprint)
    // instead of a stroke that would also expand vertically and diverge from print.
    if (span.isFauxBold) {
      const offMm = span.fontSizeMm * 0.02;
      emit(span.xList.map((x) => (parseFloat(x) + offMm).toFixed(3)).join(' '));
    }
  }

  // Underline / strike as drawn lines
  for (const g of line.glyphs) {
    if (g.underline) {
      const y = line.baselineYMm + (g.fontSizeMm * 0.15);
      parts.push(`<line x1="${g.xMm.toFixed(3)}" y1="${y.toFixed(3)}" x2="${(g.xMm + g.advanceMm).toFixed(3)}" y2="${y.toFixed(3)}" stroke="${escapeXml(g.color)}" stroke-width="${(g.fontSizeMm * 0.05).toFixed(3)}" />`);
    }
    if (g.strike) {
      const y = line.baselineYMm - (g.fontSizeMm * 0.25);
      parts.push(`<line x1="${g.xMm.toFixed(3)}" y1="${y.toFixed(3)}" x2="${(g.xMm + g.advanceMm).toFixed(3)}" y2="${y.toFixed(3)}" stroke="${escapeXml(g.color)}" stroke-width="${(g.fontSizeMm * 0.05).toFixed(3)}" />`);
    }
  }
}

/**
 * Render one line using <path> per glyph (true glyph outlines). NOTE: does not emit
 * faux bold/italic, underline, or strike — see the glyphMode note in the file header.
 * Unused by the app (the 'text' mode is authoritative); kept for outline export.
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

    parts.push(`<path d="${svgPath}" transform="${transform}" fill="${escapeXml(g.color)}" />`);
  }
}

/**
 * Build an SVG <line> (or pair of lines for double) that mirrors drawDividerLine
 * in render-pdf.js — solid/dashed/dotted/double, matching the CSS border the
 * BlockRenderer renders on screen.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {string} [barStyle]
 * @param {string} [barColor]
 * @returns {string}
 */
function svgDividerLine(x1, y1, x2, y2, barStyle, barColor) {
  const style = barStyle || 'solid';
  const color = escapeXml(barColor || '#000000');
  const w = 0.265; // 1 CSS px @96dpi in mm

  const baseAttrs = `stroke="${color}" stroke-width="${w}" fill="none"`;

  if (style === 'double') {
    const isH = y1 === y2;
    // Two 1px strokes offset by ±1px (≈3px total), identical to drawDividerLine in
    // render-pdf.js (off = onePx). Was w*2, which spaced the SVG twins wider than the PDF.
    const off = w;
    const [a1, a2] = isH
      ? [`x1="${x1}" y1="${y1 - off}" x2="${x2}" y2="${y2 - off}"`,
         `x1="${x1}" y1="${y1 + off}" x2="${x2}" y2="${y2 + off}"`]
      : [`x1="${x1 - off}" y1="${y1}" x2="${x2 - off}" y2="${y2}"`,
         `x1="${x1 + off}" y1="${y1}" x2="${x2 + off}" y2="${y2}"`];
    return `<line ${a1} ${baseAttrs} /><line ${a2} ${baseAttrs} />`;
  }

  let dashAttr = '';
  if (style === 'dashed') dashAttr = ` stroke-dasharray="${w * 3.4} ${w * 2.3}"`;
  else if (style === 'dotted') dashAttr = ` stroke-dasharray="${w} ${w * 1.9}"`;

  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${baseAttrs}${dashAttr} />`;
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
  // overflow="visible": an SVG's UA default is overflow:hidden, which would clip a
  // faux-italic ascender skewed past the right edge — but pdf-lib never clips, so
  // clipping here would break screen/print parity. Parents are already overflow:visible.
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidthMm}mm" height="${blockHeightMm}mm" viewBox="0 0 ${blockWidthMm} ${blockHeightMm}" overflow="visible">`);

  if (pt.elementType === 'horizontal_divider' || pt.elementType === 'horizontal divider') {
    const y = blockHeightMm / 2;
    parts.push(svgDividerLine(0, y, blockWidthMm, y, pt.barStyle, pt.barColor));
  } else if (pt.elementType === 'vertical_divider' || pt.elementType === 'vertical divider') {
    const x = blockWidthMm / 2;
    parts.push(svgDividerLine(x, 0, x, blockHeightMm, pt.barStyle, pt.barColor));
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
  return String(str ?? '')
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
  // Node: Buffer.from is O(1) copy + native base64 encode — much faster than looping.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  // Browser: chunked apply avoids call-stack overflow on large (300KB+) font binaries
  // while still being significantly faster than string concatenation in a loop.
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000; // 32KB — safe well below V8's argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
