/**
 * templateFonts.js — Single source of truth for per-template default fonts and
 * template-name normalization. Shared by App.svelte and NotionPane.svelte so
 * imported resumes that omit explicit font fields default to their template's
 * fonts (e.g. elegant → Playfair/Lora) rather than a blanket Inter.
 *
 * Geometry is engine-owned (template-metrics.js); these are only the font-family
 * defaults the themeColors overlay falls back to.
 */

/** @type {Record<string, {h1:string,h2:string,h3:string,text:string}>} */
export const templateDefaultFonts = {
  clean: { h1: 'Inter', h2: 'Inter', h3: 'Inter', text: 'Inter' },
  modern: { h1: 'Space Grotesk', h2: 'Space Grotesk', h3: 'Space Grotesk', text: 'Space Grotesk' },
  elegant: { h1: 'Playfair Display', h2: 'Playfair Display', h3: 'Playfair Display', text: 'Lora' },
  compact: { h1: 'Outfit', h2: 'Outfit', h3: 'Outfit', text: 'Outfit' },
};

/**
 * Normalize any (possibly custom/legacy) template id to a built-in preset.
 * Only the built-in presets carry valid engine geometry; unknown ids fall back
 * to `clean`.
 * @param {string} name
 * @returns {string}
 */
export function normalizeTemplateName(name) {
  return templateDefaultFonts[name] ? name : 'clean';
}
