/**
 * fonts.js — Font registry, style resolution, and themeColors overlay.
 *
 * Single shaping authority: fontkit. The only code allowed to measure or
 * shape text anywhere in the system.
 */

import * as fontkit from 'fontkit';
import { getTypeStyle } from './template-metrics.js';

/**
 * @typedef {Object} BaseStyle
 * @property {string} fontFamily
 * @property {number} fontWeight
 * @property {string} fontStyle
 * @property {number} fontSizeMm
 * @property {number} lineHeightMm
 * @property {string} color
 * @property {number} letterSpacingPt
 * @property {string} textTransform
 * @property {{widthPt:number,color:string}|null} borderBottom
 * @property {{widthMm:number,color:string}|null} borderLeft
 * @property {number|null} paddingLeftMm
 * @property {number|null} paddingTopMm
 * @property {number|null} paddingBottomMm
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

// ---------------------------------------------------------------------------
// Font inventory from index.html Google Fonts <link>
// ---------------------------------------------------------------------------

/**
 * Whitelist of vendored (family, weight, style) combinations.
 * @type {Array<{family:string,weights:number[],italic:boolean}>}
 */
const FONT_INVENTORY = [
  { family: 'Fira Code', weights: [400, 500], italic: false },
  { family: 'Inter', weights: [400, 500, 600, 700], italic: false },
  { family: 'Lora', weights: [400, 700], italic: false },
  { family: 'Lora', weights: [400], italic: true },
  { family: 'Outfit', weights: [400, 600, 700, 800], italic: false },
  { family: 'Playfair Display', weights: [700], italic: false },
  { family: 'Playfair Display', weights: [400], italic: true },
  { family: 'Space Grotesk', weights: [400, 500, 700], italic: false },
  { family: 'Noto Serif', weights: [400, 600, 700], italic: false },
  { family: 'Work Sans', weights: [400, 500, 600, 700], italic: false },
];

/** @type {Set<string>} */
const VENDOR_WHITELIST = new Set();
/** @type {Set<string>} */
const VENDOR_FAMILIES = new Set();
for (const { family, weights, italic } of FONT_INVENTORY) {
  VENDOR_FAMILIES.add(family);
  for (const w of weights) {
    VENDOR_WHITELIST.add(`${family}__${w}__${italic ? 'italic' : 'normal'}`);
  }
}

/**
 * @param {string} family
 * @returns {boolean}
 */
function isVendoredFamily(family) {
  return VENDOR_FAMILIES.has(family);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** @type {Map<string, import('fontkit').Font>} */
const REGISTRY = new Map();
/** @type {Map<string, ArrayBuffer>} Font binary buffers for SVG embedding */
const FONT_BUFFERS = new Map();

let warnedUnknownFamily = new Set();

// ---------------------------------------------------------------------------
// Init latch — ensures a single load regardless of how many callers invoke
// initFonts() concurrently or sequentially.
// ---------------------------------------------------------------------------

/** @type {Promise<void>|null} */
let _initPromise = null;
/** @type {boolean} */
let _initDone = false;

/**
 * True once initFonts() has successfully completed at least once.
 * Components can read this to avoid triggering computeLayout before fonts exist.
 * @type {boolean}
 */
export let fontsReady = false;

/**
 * Build a filename slug for the vendored binary.
 * @param {string} family
 * @param {number} weight
 * @param {boolean} italic
 * @returns {string}
 */
function binarySlug(family, weight, italic) {
  const f = family.replace(/\s+/g, '-').toLowerCase();
  const i = italic ? '-italic' : '';
  return `${f}-${weight}${i}.ttf`;
}

/**
 * Async load all vendored font binaries. Works in browser (fetch) and Node (fs).
 * Idempotent: concurrent or repeated calls share one in-flight load and resolve
 * immediately once the first load completes.
 */
export async function initFonts() {
  if (_initDone) return;
  if (_initPromise) return _initPromise;

  _initPromise = _doInit();
  return _initPromise;
}

async function _doInit() {
  const isNode = typeof window === 'undefined';
  // In the browser we must also hand the binaries to the CSS font system, or the
  // on-screen SVG <text font-family="Inter"> falls back to a system font whose
  // metrics differ from the fontkit-shaped positions — drawing each glyph at the
  // right x but with the wrong width, which collides/gaps dense lines. Register a
  // FontFace per binary (keyed by the font's OWN familyName/weight/style so it
  // matches exactly what render-svg emits).
  const canRegisterFontFaces = !isNode && typeof FontFace !== 'undefined'
    && typeof document !== 'undefined' && document.fonts;
  const fontFaceLoads = [];

  for (const { family, weights, italic } of FONT_INVENTORY) {
    for (const w of weights) {
      const slug = binarySlug(family, w, italic);
      const key = `${family}__${w}__${italic ? 'italic' : 'normal'}`;

      // Already loaded (should not happen with the latch, but be defensive)
      if (REGISTRY.has(key)) continue;

      let buffer;
      const fontUrl = new URL(`../../assets/fonts/vendor/${slug}`, import.meta.url);
      if (isNode) {
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        buffer = await readFile(fileURLToPath(fontUrl));
      } else {
        const res = await fetch(fontUrl.href);
        if (!res.ok) {
          throw new Error(`Failed to load font: ${slug} from ${fontUrl.href}`);
        }
        buffer = await res.arrayBuffer();
      }

      const buf = new Uint8Array(buffer);
      // @ts-ignore — fontkit.create accepts Uint8Array at runtime (type defs want Buffer)
      const created = fontkit.create(buf);
      // Our vendored binaries are single fonts, not collections.
      const font = /** @type {import('fontkit').Font} */ (created);
      REGISTRY.set(key, font);
      FONT_BUFFERS.set(key, /** @type {ArrayBuffer} */ (buffer));

      if (canRegisterFontFaces) {
        // Use the binary's own metadata so the registered (family, weight, style)
        // exactly matches the <text> attributes render-svg derives from the font.
        const regFamily = font.familyName || family;
        const weightClass = font['OS/2']?.usWeightClass || w;
        const style = (font.subfamilyName || '').toLowerCase().includes('italic') || italic
          ? 'italic' : 'normal';
        try {
          const face = new FontFace(regFamily, buffer, { weight: String(weightClass), style });
          fontFaceLoads.push(
            face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {})
          );
        } catch (e) {
          // FontFace construction can throw on malformed input — non-fatal; the
          // block simply renders with a fallback until the font is available.
        }
      }
    }
  }

  // Let callers (and the first paint) benefit once faces are ready; failures here
  // are non-fatal (shaping already works regardless of the CSS font system).
  if (fontFaceLoads.length > 0) {
    await Promise.allSettled(fontFaceLoads);
  }

  _initDone = true;
  fontsReady = true;
}

// ---------------------------------------------------------------------------
// Whitelist helpers
// ---------------------------------------------------------------------------

/**
 * Check if a font family exists in the vendored whitelist (any weight/style).
 * @param {string} family
 * @returns {boolean}
 */
function isFamilyInWhitelist(family) {
  for (const key of VENDOR_WHITELIST) {
    if (key.startsWith(`${family}__`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Font resolution with fallback policy
// ---------------------------------------------------------------------------

/**
 * Get the original binary buffer for a font key.
 * @param {string} key — "family__weight__style"
 * @returns {ArrayBuffer|null}
 */
export function getFontBufferByKey(key) {
  return FONT_BUFFERS.get(key) || null;
}

/**
 * Get the binary buffer for a given fontkit font object (by reference identity).
 * @param {import('fontkit').Font} font
 * @returns {ArrayBuffer|null}
 */
export function getFontBufferForFont(font) {
  for (const [key, f] of REGISTRY) {
    if (f === font) return FONT_BUFFERS.get(key) || null;
  }
  return null;
}

/**
 * Resolve a fontkit font for a desired (family, weight, style).
 *
 * Fallback policy:
 * 1. Exact (family, weight, style) present → use it, no faux.
 * 2. Missing weight → nearest available weight of same family/style.
 *    faux.bold = true when nearest.weight < requested weight. The flag signals
 *    "render bolder than the binary" but the exact delta (e.g. 400→700 vs
 *    600→700) is not encoded downstream; renderers apply a uniform stroke.
 * 3. Missing italic for the family → use upright binary, faux.italic = true.
 * 4. Missing family entirely → fall back to Inter, log warning.
 *
 * @param {string} family
 * @param {number} weight
 * @param {string} style — 'normal' | 'italic'
 * @returns {{font:import('fontkit').Font, usedFamily:string, usedWeight:number, usedStyle:string, faux:{italic:boolean,bold:boolean}}}
 */
export function getFont(family, weight, style) {
  const isItalic = style === 'italic';
  const key = `${family}__${weight}__${isItalic ? 'italic' : 'normal'}`;

  if (REGISTRY.has(key)) {
    return { font: REGISTRY.get(key), usedFamily: family, usedWeight: weight, usedStyle: style, faux: { italic: false, bold: false } };
  }

  // Collect available weights for this family+style
  const availableWeights = [];
  for (const [k, font] of REGISTRY) {
    const parts = k.split('__');
    if (parts[0] === family && parts[2] === (isItalic ? 'italic' : 'normal')) {
      availableWeights.push({ weight: parseInt(parts[1]), font });
    }
  }

  if (availableWeights.length > 0) {
    // Nearest weight
    availableWeights.sort((a, b) => a.weight - b.weight);
    let nearest = availableWeights[0];
    let minDiff = Math.abs(nearest.weight - weight);
    for (const aw of availableWeights) {
      const diff = Math.abs(aw.weight - weight);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = aw;
      }
    }
    return {
      font: nearest.font,
      usedFamily: family,
      usedWeight: nearest.weight,
      usedStyle: isItalic ? 'italic' : 'normal',
      faux: { italic: false, bold: nearest.weight < weight },
    };
  }

  // Missing italic → use upright with faux
  if (isItalic) {
    const uprightKey = `${family}__${weight}__normal`;
    if (REGISTRY.has(uprightKey)) {
      return {
        font: REGISTRY.get(uprightKey),
        usedFamily: family,
        usedWeight: weight,
        usedStyle: 'normal',
        faux: { italic: true, bold: false },
      };
    }

    // Also try nearest upright weight
    const uprightWeights = [];
    for (const [k, font] of REGISTRY) {
      const parts = k.split('__');
      if (parts[0] === family && parts[2] === 'normal') {
        uprightWeights.push({ weight: parseInt(parts[1]), font });
      }
    }
    if (uprightWeights.length > 0) {
      uprightWeights.sort((a, b) => a.weight - b.weight);
      let nearest = uprightWeights[0];
      let minDiff = Math.abs(nearest.weight - weight);
      for (const aw of uprightWeights) {
        const diff = Math.abs(aw.weight - weight);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = aw;
        }
      }
      return {
        font: nearest.font,
        usedFamily: family,
        usedWeight: nearest.weight,
        usedStyle: 'normal',
        faux: { italic: true, bold: nearest.weight < weight },
      };
    }
  }

  // Missing family entirely → Inter fallback. Guard against infinite recursion:
  // if the registry is empty (initFonts not called) or Inter itself is missing,
  // nothing usable exists — fail loudly instead of recursing forever.
  if (REGISTRY.size === 0) {
    throw new Error('[layout-engine] Font registry is empty — call initFonts() before getFont().');
  }
  if (family === 'Inter') {
    throw new Error('[layout-engine] Base font "Inter" is not registered — vendored fonts are missing or initFonts() did not complete.');
  }
  if (!warnedUnknownFamily.has(family)) {
    warnedUnknownFamily.add(family);
    console.warn(`[layout-engine] Unknown font family "${family}" — falling back to Inter. Only vendored families are supported.`);
  }
  return getFont('Inter', weight, style);
}

// ---------------------------------------------------------------------------
// themeColors overlay
// ---------------------------------------------------------------------------

/**
 * Map a block type to its themeColors category.
 * @param {string} blockType
 * @returns {'h1'|'h2'|'h3'|'text'}
 */
export function fontCategory(blockType) {
  if (blockType === 'h1' || blockType === 'h2' || blockType === 'h3') {
    return blockType;
  }
  return 'text';
}

/**
 * Produce the block's EFFECTIVE base style.
 * Template metrics provide geometry (size, weight, line-height, etc).
 * themeColors provide family and color.
 *
 * @param {string} templateName
 * @param {string} blockType
 * @param {Object} themeColors
 * @returns {BaseStyle}
 */
export function effectiveBaseStyle(templateName, blockType, themeColors) {
  const raw = getTypeStyle(templateName, blockType);
  const cat = fontCategory(blockType);

  // Resolve font family from themeColors — sole authority, template CSS is dead
  let family = themeColors[`${cat}Font`];
  if (!family || family === 'Default') {
    family = 'Inter';
  }
  if (!isFamilyInWhitelist(family)) {
    if (!warnedUnknownFamily.has(family)) {
      warnedUnknownFamily.add(family);
      console.warn(`[layout-engine] Font family "${family}" is not in the vendored whitelist — falling back to Inter.`);
    }
    family = 'Inter';
  }

  // Resolve color from themeColors — sole authority, template CSS is dead
  const color = themeColors[`${cat}Color`] || '#111111';

  return {
    fontFamily: family,
    fontWeight: raw.fontWeight,
    fontStyle: raw.fontStyle,
    fontSizeMm: raw.fontSizeMm,
    lineHeightMm: raw.lineHeightMm,
    color,
    letterSpacingPt: raw.letterSpacingPt,
    textTransform: raw.textTransform,
    borderBottom: raw.borderBottom,
    // The left accent bar (e.g. modern H2) is conceptually the heading's color, so it
    // must follow the themed category color — otherwise changing h2Color leaves the bar
    // frozen at the template default. Screen (SVG) and PDF both read this, so they stay
    // in sync; this only makes the decoration track the theme.
    borderLeft: raw.borderLeft ? { ...raw.borderLeft, color } : null,
    paddingLeftMm: raw.paddingLeftMm,
    paddingTopMm: raw.paddingTopMm || 0,
    paddingBottomMm: raw.paddingBottomMm || 0,
  };
}

// ---------------------------------------------------------------------------
// Run style resolution (used by Phase 2)
// ---------------------------------------------------------------------------

/**
 * Given the block's effective BaseStyle and a run's marks, produce the
 * effective RunStyle including the resolved fontkit font.
 *
 * @param {BaseStyle} baseStyle
 * @param {Array<{type:string,attrs?:Object}>} [marks]
 * @returns {RunStyle}
 */
export function resolveRunStyle(baseStyle, marks = []) {
  let family = baseStyle.fontFamily;
  let weight = baseStyle.fontWeight;
  let style = baseStyle.fontStyle;
  let color = baseStyle.color;
  let underline = false;
  let strike = false;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        // Step up to 700 minimum, but never below the base weight — avoids
        // ironically lightening an 800-weight heading when bolding a word inside it.
        weight = Math.max(weight, 700);
        break;
      case 'italic':
        style = 'italic';
        break;
      case 'underline':
        underline = true;
        break;
      case 'strike':
        strike = true;
        break;
      case 'textStyle':
        if (mark.attrs) {
          if (mark.attrs.fontFamily && mark.attrs.fontFamily !== 'Default') {
            const candidate = mark.attrs.fontFamily;
            if (isFamilyInWhitelist(candidate)) {
              family = candidate;
            } else {
              if (!warnedUnknownFamily.has(candidate)) {
                warnedUnknownFamily.add(candidate);
                console.warn(`[layout-engine] Mark fontFamily "${candidate}" is not vendored — falling back to Inter.`);
              }
              family = 'Inter';
            }
          }
          if (mark.attrs.color) {
            color = mark.attrs.color;
          }
        }
        break;
    }
  }

  const fontResult = getFont(family, weight, style);

  return {
    font: fontResult.font,
    unitsPerEm: fontResult.font.unitsPerEm || 1000,
    fontSizeMm: baseStyle.fontSizeMm,
    lineHeightMm: baseStyle.lineHeightMm,
    color,
    letterSpacingMm: (baseStyle.letterSpacingPt * 25.4) / 72,
    textTransform: baseStyle.textTransform,
    underline,
    strike,
    faux: fontResult.faux,
  };
}
