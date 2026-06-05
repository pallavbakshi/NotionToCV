/**
 * template-metrics.js — Per-template, per-block-type type-style data.
 *
 * The `fontFamily` and `color` fields are TEMPLATE DEFAULTS ONLY.
 * At render time, App.svelte injects CSS variables that override them
 * from themeColors. The engine must resolve the effective font/color
 * via effectiveBaseStyle() in fonts.js, not use these raw values.
 */

/**
 * @typedef {Object} TypeStyle
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
 */

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const BUILT_IN = {
  clean: {
    h1: {
      fontFamily: 'Inter',
      fontWeight: 800,
      fontStyle: 'normal',
      fontSizeMm: 16,
      lineHeightMm: 20,
      color: '#111111',
      letterSpacingPt: -0.5,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h2: {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 12,
      lineHeightMm: 15,
      color: '#111111',
      letterSpacingPt: 1.5,
      textTransform: 'uppercase',
      borderBottom: { widthPt: 0.75, color: '#111111' },
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 8,
      lineHeightMm: 10,
      color: '#111111',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    paragraph: {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizeMm: 4,
      lineHeightMm: 5,
      color: '#4b4b4b',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
  },

  compact: {
    h1: {
      fontFamily: 'Outfit',
      fontWeight: 800,
      fontStyle: 'normal',
      fontSizeMm: 14,
      lineHeightMm: 17,
      color: '#0f172a',
      letterSpacingPt: -0.5,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h2: {
      fontFamily: 'Outfit',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 5.5,
      lineHeightMm: 9,
      color: '#065f46',
      letterSpacingPt: 1.5,
      textTransform: 'uppercase',
      borderBottom: { widthPt: 0.75, color: '#065f46' },
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Outfit',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 5.5,
      lineHeightMm: 7.5,
      color: '#0f172a',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    paragraph: {
      fontFamily: 'Outfit',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizeMm: 3.6,
      lineHeightMm: 4.8,
      color: '#334155',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
  },

  elegant: {
    h1: {
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 16,
      lineHeightMm: 20,
      color: '#292524',
      letterSpacingPt: 0.5,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h2: {
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontStyle: 'italic',
      fontSizeMm: 8,
      lineHeightMm: 13,
      color: '#78350f',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: { widthPt: 0.5, color: '#78350f' },
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 6,
      lineHeightMm: 9,
      color: '#292524',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    paragraph: {
      fontFamily: 'Lora',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizeMm: 4,
      lineHeightMm: 5.5,
      color: '#44403c',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
  },

  modern: {
    h1: {
      fontFamily: 'Space Grotesk',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 15,
      lineHeightMm: 18,
      color: '#1e3a8a',
      letterSpacingPt: -0.3,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h2: {
      fontFamily: 'Space Grotesk',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 6,
      lineHeightMm: 12,
      color: '#1e3a8a',
      letterSpacingPt: 2,
      textTransform: 'uppercase',
      borderBottom: null,
      borderLeft: { widthMm: 2, color: '#1e3a8a' },
      paddingLeftMm: 3,
    },
    h3: {
      fontFamily: 'Space Grotesk',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 6,
      lineHeightMm: 9,
      color: '#1e293b',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    paragraph: {
      fontFamily: 'Space Grotesk',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizeMm: 3.8,
      lineHeightMm: 5,
      color: '#475569',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
  },
};

// ---------------------------------------------------------------------------
// Custom template CSS parse
// ---------------------------------------------------------------------------

/**
 * Extract one typographic property from a CSS declaration block.
 * Returns null if not found.
 * @param {string} cssBlock
 * @param {string} prop
 * @returns {string|null}
 */
function extractProp(cssBlock, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+);`);
  const m = cssBlock.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse a raw CSS string for a custom template and extract the geometric
 * properties per block type. Missing properties fall back to clean template.
 * Family and color are NOT extracted — themeColors wins.
 *
 * @param {string} cssString
 * @param {string} templateId
 * @returns {Record<string, TypeStyle>}
 */
function parseCustomTemplate(cssString, templateId) {
  /** @type {Record<string, TypeStyle>} */
  const result = Object.create(null);
  const clean = BUILT_IN.clean;

  for (const blockType of ['h1', 'h2', 'h3', 'paragraph']) {
    const selector = `.tmpl-${templateId}.block-type-${blockType}`;
    const idx = cssString.indexOf(selector);
    let block = null;

    if (idx !== -1) {
      const start = cssString.indexOf('{', idx);
      const end = cssString.indexOf('}', start);
      if (start !== -1 && end !== -1) {
        block = cssString.slice(start + 1, end);
      }
    }

    const fallback = clean[blockType];

    /** @param {string} prop */
    const get = (prop) => {
      if (!block) return null;
      const val = extractProp(block, prop);
      return val || null;
    };

    /** @param {string} val */
    const parseMm = (val) => {
      if (!val) return null;
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    };

    /** @param {string} val */
    const parsePt = (val) => {
      if (!val) return null;
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    };

    const sizeMm = parseMm(get('font-size')) ?? fallback.fontSizeMm;
    const lhMm   = parseMm(get('line-height')) ?? fallback.lineHeightMm;
    const lsPt   = parsePt(get('letter-spacing')) ?? fallback.letterSpacingPt;
    const transform = get('text-transform') || fallback.textTransform;
    const style  = get('font-style') || fallback.fontStyle;

    // font-weight: handle numeric values and CSS keywords
    let weight = fallback.fontWeight;
    const weightRaw = get('font-weight');
    if (weightRaw) {
      const weightMap = { normal: 400, bold: 700, '100':100, '200':200, '300':300, '400':400, '500':500, '600':600, '700':700, '800':800, '900':900 };
      if (weightMap[weightRaw.toLowerCase()]) {
        weight = weightMap[weightRaw.toLowerCase()];
      } else {
        const parsed = parseInt(weightRaw);
        if (!isNaN(parsed)) weight = parsed;
      }
    }

    // Parse border-bottom: e.g. "0.75pt solid #111111" or "0.75pt #111111"
    let border = fallback.borderBottom;
    const borderRaw = get('border-bottom');
    if (borderRaw) {
      const bm = borderRaw.match(/([\d.]+)pt(?:\s+solid)?\s+([^;\s]+)/);
      if (bm) {
        border = { widthPt: parseFloat(bm[1]), color: bm[2] };
      }
    }

    // Parse border-left: e.g. "2mm solid #1e3a8a"
    let borderLeft = fallback.borderLeft;
    const borderLeftRaw = get('border-left');
    if (borderLeftRaw) {
      const blm = borderLeftRaw.match(/([\d.]+)mm(?:\s+solid)?\s+([^;\s]+)/);
      if (blm) {
        borderLeft = { widthMm: parseFloat(blm[1]), color: blm[2] };
      }
    }

    const paddingLeftMm = parseMm(get('padding-left')) ?? fallback.paddingLeftMm;

    result[blockType] = {
      fontFamily: fallback.fontFamily, // dead default; themeColors overrides
      fontWeight: weight,
      fontStyle: style,
      fontSizeMm: sizeMm,
      lineHeightMm: lhMm,
      color: fallback.color, // dead default; themeColors overrides
      letterSpacingPt: lsPt,
      textTransform: transform,
      borderBottom: border,
      borderLeft,
      paddingLeftMm,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the raw TypeStyle for a (templateName, blockType).
 * For custom templates, parses CSS with clean-template fallback per property.
 * The returned fontFamily/color are DEFAULTS ONLY — effectiveBaseStyle()
 * in fonts.js applies the themeColors overlay.
 *
 * @param {string} templateName
 * @param {string} blockType
 * @param {Record<string, string>} [customTemplates]
 * @returns {TypeStyle}
 */
export function getTypeStyle(templateName, blockType, customTemplates) {
  if (BUILT_IN[templateName]) {
    return BUILT_IN[templateName][blockType] || BUILT_IN.clean[blockType];
  }

  // Custom template
  if (customTemplates && customTemplates[templateName]) {
    const parsed = parseCustomTemplate(customTemplates[templateName], templateName);
    return parsed[blockType] || BUILT_IN.clean[blockType];
  }

  // Unknown template -> clean fallback
  return BUILT_IN.clean[blockType];
}
