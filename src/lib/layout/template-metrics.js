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
 * @property {number|null} paddingTopMm
 * @property {number|null} paddingBottomMm
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
      fontSizeMm: 19,
      lineHeightMm: 24,
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
      fontSizeMm: 14.0,
      lineHeightMm: 18.0,
      color: '#111111',
      letterSpacingPt: 1.5,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Inter',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 9.5,
      lineHeightMm: 12.0,
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
      fontSizeMm: 3.8,
      lineHeightMm: 5.0,
      color: '#4b4b4b',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
      paddingTopMm: 0.5,
      paddingBottomMm: 0.5,
    },
  },

  compact: {
    h1: {
      fontFamily: 'Outfit',
      fontWeight: 800,
      fontStyle: 'normal',
      fontSizeMm: 16.5,
      lineHeightMm: 20.5,
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
      fontSizeMm: 7.0,
      lineHeightMm: 11.0,
      color: '#065f46',
      letterSpacingPt: 1.5,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Outfit',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 6.5,
      lineHeightMm: 9.0,
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
      lineHeightMm: 5.0,
      color: '#334155',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
      paddingTopMm: 0.5,
      paddingBottomMm: 0.5,
    },
  },

  elegant: {
    h1: {
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 19,
      lineHeightMm: 24,
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
      fontSizeMm: 9.5,
      lineHeightMm: 15.5,
      color: '#78350f',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
    },
    h3: {
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 7.0,
      lineHeightMm: 10.5,
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
      fontSizeMm: 3.8,
      lineHeightMm: 5.0,
      color: '#44403c',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
      paddingTopMm: 0.5,
      paddingBottomMm: 0.5,
    },
  },

  modern: {
    h1: {
      fontFamily: 'Space Grotesk',
      fontWeight: 700,
      fontStyle: 'normal',
      fontSizeMm: 18.0,
      lineHeightMm: 21.5,
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
      fontSizeMm: 7.5,
      lineHeightMm: 14.5,
      color: '#1e3a8a',
      letterSpacingPt: 2,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: { widthMm: 2, color: '#1e3a8a' },
      paddingLeftMm: 3,
    },
    h3: {
      fontFamily: 'Space Grotesk',
      fontWeight: 600,
      fontStyle: 'normal',
      fontSizeMm: 7.0,
      lineHeightMm: 10.5,
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
      fontSizeMm: 3.7,
      lineHeightMm: 5.0,
      color: '#475569',
      letterSpacingPt: 0,
      textTransform: 'none',
      borderBottom: null,
      borderLeft: null,
      paddingLeftMm: null,
      paddingTopMm: 0.5,
      paddingBottomMm: 0.5,
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
