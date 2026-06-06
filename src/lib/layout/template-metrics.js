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
      borderBottom: null, // headings never auto-underline; underline is user-driven (text mark) only
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
      borderBottom: null, // headings never auto-underline; underline is user-driven (text mark) only
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
      borderBottom: null, // headings never auto-underline; underline is user-driven (text mark) only
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the raw TypeStyle (geometry) for a (templateName, blockType).
 * Geometry comes solely from the built-in presets; an unknown template falls
 * back to `clean`. The returned fontFamily/color are DEFAULTS ONLY —
 * effectiveBaseStyle() in fonts.js applies the themeColors overlay.
 *
 * @param {string} templateName
 * @param {string} blockType
 * @returns {TypeStyle}
 */
export function getTypeStyle(templateName, blockType) {
  const preset = BUILT_IN[templateName] || BUILT_IN.clean;
  return preset[blockType] || BUILT_IN.clean[blockType] || BUILT_IN.clean.paragraph;
}
