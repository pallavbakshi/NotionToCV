/**
 * render-pdf.js — Generate a canonical PDF from blocks using pdf-lib + fontkit.
 *
 * Each block is laid out via computeLayout; glyphs are drawn at exact x/y/baseline
 * coordinates. No width-based text wrapping API is used.
 */

import { PDFDocument, rgb, degrees } from 'pdf-lib';
// pdf-lib's font subsetting requires ITS OWN fontkit (@pdf-lib/fontkit), not the
// standalone `fontkit` v2 the layout engine shapes with — that one throws
// "subset.encodeStream is not a function" on subset:true. They coexist fine:
// the engine keeps using standalone fontkit; pdf-lib uses this one for embedding.
import pdfLibFontkit from '@pdf-lib/fontkit';
import { mmToPt, PAGE_W_MM, PAGE_H_MM } from './units.js';
import { computeLayout, blockRectMm } from './index.js';
import { getFontBufferForFont } from './fonts.js';

/**
 * @typedef {Object} LaidOutBlock
 */

/**
 * Generate a canonical PDF for the given blocks.
 *
 * @param {Array<Object>} blocks
 * @param {Object} ctx — { templateName, paddingMm, themeColors }
 * @returns {Promise<Uint8Array>}
 */
export async function renderResumePDF(blocks, ctx) {
  const pdfDoc = await PDFDocument.create();
  // @ts-ignore — @types/fontkit and pdf-lib's Fontkit types differ at compile time,
  // but the runtime object is compatible.
  pdfDoc.registerFontkit(pdfLibFontkit);
  const { paddingMm } = ctx;
  // Page background is engine-owned (parity with the on-screen .cv-page fill).
  const pageBgColor = hexToRgb((ctx.themeColors && ctx.themeColors.backgroundColor) || '#ffffff');

  // Track embedded fonts: key = `${family}__${style}` -> pdf-lib PDFFont
  const embeddedFonts = new Map();

  // Pre-compute layouts for all placed blocks to know which fonts we need
  const layouts = [];
  for (const block of blocks) {
    if (!block.canvas) continue;
    const rect = blockRectMm(block.canvas, paddingMm);
    const lo = computeLayout(block, rect, ctx);
    layouts.push({ block, rect, lo });
  }

  // Embed required fonts as the FULL binary (subset: false). pdf-lib's bundled
  // @pdf-lib/fontkit subsetter mangles these vendored TrueType binaries (Inter,
  // Outfit, …) — it fails to copy the glyf outlines of many glyphs, so they embed
  // as blank/.notdef and the PDF renders e.g. "Pallav BAKSHI" as "alla S".
  // Verified by rasterizing both paths: subset:true → blank glyphs; subset:false →
  // perfect. Full embedding costs ~150–330 KB per weight, which is fine for a CV.
  for (const { lo } of layouts) {
    if (lo.kind !== 'text') continue;
    for (const line of lo.lines) {
      for (const glyph of line.glyphs) {
        const key = `${glyph.font.familyName}__${glyph.font.subfamilyName || 'normal'}`;
        if (!embeddedFonts.has(key)) {
          // Pull the binary from the engine's font registry by reference identity —
          // robust to fonts whose familyName embeds the weight (e.g. "Fira Code
          // Medium"), which broke filename reconstruction.
          const fontBuffer = getFontBufferForFont(glyph.font);
          if (fontBuffer) {
            const pdfFont = await pdfDoc.embedFont(fontBuffer, { subset: false });
            embeddedFonts.set(key, pdfFont);
          }
        }
      }
    }
  }

  // Group blocks by page
  const pagesMap = new Map();
  for (const { block, rect, lo } of layouts) {
    const pageNum = block.canvas.page || 1;
    if (!pagesMap.has(pageNum)) pagesMap.set(pageNum, []);
    pagesMap.get(pageNum).push({ block, rect, lo });
  }

  // Sort page numbers and render each page
  const sortedPages = [...pagesMap.keys()].sort((a, b) => a - b);
  for (const pageNum of sortedPages) {
    const pageBlocks = pagesMap.get(pageNum);
    const page = pdfDoc.addPage([mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)]);

    // Fill the whole page with the theme background before drawing anything,
    // so a non-white page color prints identically to the screen.
    page.drawRectangle({
      x: 0,
      y: 0,
      width: mmToPt(PAGE_W_MM),
      height: mmToPt(PAGE_H_MM),
      color: pageBgColor,
    });

    for (const { rect, lo } of pageBlocks) {
      if (lo.kind === 'passthrough') {
        await renderPassthroughToPDF(page, lo, rect, pdfDoc);
        continue;
      }

      // Draw text lines
      for (const line of lo.lines) {
        for (const glyph of line.glyphs) {
          const key = `${glyph.font.familyName}__${glyph.font.subfamilyName || 'normal'}`;
          const pdfFont = embeddedFonts.get(key);
          if (!pdfFont) continue;

          const xPt = mmToPt(rect.leftMm + glyph.xMm);
          const yPt = mmToPt(PAGE_H_MM - (rect.topMm + line.baselineYMm));

          try {
            const opts = {
              x: xPt,
              y: yPt,
              font: pdfFont,
              size: mmToPt(glyph.fontSizeMm),
              color: hexToRgb(glyph.color),
            };
            // Apply faux-italic skew (-12°) per glyph
            if (glyph.faux && glyph.faux.italic) {
              opts.xSkew = degrees(-12);
            }
            page.drawText(glyph.char, opts);
            // Faux bold: binary is lighter than requested — overprint with a small
            // horizontal offset (2% em) to synthetically thicken the stroke.
            if (glyph.faux && glyph.faux.bold) {
              page.drawText(glyph.char, { ...opts, x: xPt + mmToPt(glyph.fontSizeMm * 0.02) });
            }
          } catch (e) {
            // Some glyphs may not be drawable; skip
          }
        }
      }

      // Draw decorations
      if (lo.decorations && lo.decorations.borderBottom) {
        const { widthPt, color, yMm } = lo.decorations.borderBottom;
        const y = mmToPt(PAGE_H_MM - (rect.topMm + yMm + (widthPt * 25.4 / 72) / 2));
        page.drawLine({
          start: { x: mmToPt(rect.leftMm), y },
          end: { x: mmToPt(rect.leftMm + rect.widthMm), y },
          thickness: mmToPt((widthPt * 25.4) / 72),
          color: hexToRgb(color),
        });
      }
      if (lo.decorations && lo.decorations.borderLeft) {
        const { widthMm, color } = lo.decorations.borderLeft;
        const contentHeightMm = lo.lines.reduce((sum, line) => sum + line.lineHeightMm, 0);
        page.drawRectangle({
          x: mmToPt(rect.leftMm),
          y: mmToPt(PAGE_H_MM - (rect.topMm + contentHeightMm)),
          width: mmToPt(widthMm),
          height: mmToPt(contentHeightMm),
          color: hexToRgb(color),
        });
      }
    }
  }

  return pdfDoc.save();
}

/**
 * Embed an image from a data URL (data:image/jpeg;base64,...) into a PDFDocument.
 * @param {any} pdfDoc
 * @param {string} dataUrl
 * @returns {Promise<any>}
 */
async function embedImageFromDataUrl(pdfDoc, dataUrl) {
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
  if (!match) {
    // pdf-lib only embeds PNG/JPEG. Uploads are normalized to PNG client-side, but
    // legacy/imported data could still carry e.g. webp — skip it (drop the image)
    // rather than throwing and aborting the whole PDF.
    console.warn('[render-pdf] Skipped unsupported image format (expected PNG/JPEG).');
    return null;
  }
  const format = match[1].toLowerCase();
  const base64 = match[2];
  // atob is browser-only; this renderer also runs server-side (Node /api/print).
  const bytes = typeof atob !== 'undefined'
    ? Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    : new Uint8Array(Buffer.from(base64, 'base64'));

  if (format === 'png') {
    return pdfDoc.embedPng(bytes);
  } else {
    return pdfDoc.embedJpg(bytes);
  }
}

/**
 * Draw a divider line honoring barStyle — mirrors BlockRenderer.svelte, which uses a
 * CSS border (1px, or 3px for `double`) with style solid/dashed/dotted/double.
 * @param {any} page
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {string} [barStyle] — 'solid' | 'dashed' | 'dotted' | 'double'
 * @param {string} [barColor]
 * @param {boolean} isHorizontal
 */
function drawDividerLine(page, x1, y1, x2, y2, barStyle, barColor, isHorizontal) {
  const style = barStyle || 'solid';
  const color = hexToRgb(barColor || '#000000');
  const onePx = mmToPt(25.4 / 96); // 1 CSS px @96dpi ≈ 0.265mm ≈ 0.75pt

  if (style === 'double') {
    // Two 1px lines separated by a 1px gap (total ~3px), matching the CSS double border.
    const off = isHorizontal ? { x: 0, y: onePx } : { x: onePx, y: 0 };
    page.drawLine({ start: { x: x1 - off.x, y: y1 - off.y }, end: { x: x2 - off.x, y: y2 - off.y }, thickness: onePx, color });
    page.drawLine({ start: { x: x1 + off.x, y: y1 + off.y }, end: { x: x2 + off.x, y: y2 + off.y }, thickness: onePx, color });
    return;
  }

  const opts = { start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: onePx, color };
  if (style === 'dashed') opts.dashArray = [mmToPt(0.9), mmToPt(0.6)];
  else if (style === 'dotted') opts.dashArray = [onePx, mmToPt(0.5)];
  page.drawLine(opts);
}

/**
 * Draw a pass-through block onto a PDF page.
 * @param {any} page — pdf-lib PDFPage
 * @param {LaidOutBlock} lo
 * @param {{leftMm:number,topMm:number,widthMm:number,heightMm:number}} rect
 * @param {any} pdfDoc — pdf-lib PDFDocument (for embedding images)
 */
async function renderPassthroughToPDF(page, lo, rect, pdfDoc) {
  const pt = lo.passthrough || {};
  const leftPt = mmToPt(rect.leftMm);
  const topPt = mmToPt(PAGE_H_MM - rect.topMm);
  const widthPt = mmToPt(rect.widthMm);
  const heightPt = mmToPt(rect.heightMm);

  if (pt.elementType === 'horizontal_divider' || pt.elementType === 'horizontal divider') {
    const y = topPt - heightPt / 2;
    drawDividerLine(page, leftPt, y, leftPt + widthPt, y, pt.barStyle, pt.barColor, true);
  } else if (pt.elementType === 'vertical_divider' || pt.elementType === 'vertical divider') {
    const x = leftPt + widthPt / 2;
    drawDividerLine(page, x, topPt, x, topPt - heightPt, pt.barStyle, pt.barColor, false);
  } else if (pt.elementType === 'headshot') {
    if (pt.imageData) {
      try {
        const img = await embedImageFromDataUrl(pdfDoc, pt.imageData);
        if (img) {
          page.drawImage(img, {
            x: leftPt,
            y: topPt - heightPt,
            width: widthPt,
            height: heightPt,
          });
        }
      } catch (e) {
        console.warn('[render-pdf] Failed to embed headshot:', e.message);
      }
    }
  }
}

/**
 * Convert a hex color string to pdf-lib RGB object.
 * @param {string} hex
 * @returns {any}
 */
function hexToRgb(hex) {
  if (!hex || hex.length < 4) return rgb(0, 0, 0); // default to black on invalid/short hex
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}
