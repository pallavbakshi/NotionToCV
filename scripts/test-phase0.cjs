/**
 * Quick Phase 0 smoke test — run in Node.
 */
const { initFonts, getFont, effectiveBaseStyle, fontCategory, resolveRunStyle } = require('../src/lib/layout/fonts.js');
const { getTypeStyle } = require('../src/lib/layout/template-metrics.js');
const { blockRectMm } = require('../src/lib/layout/units.js');

(async () => {
  console.log('Loading fonts...');
  await initFonts();
  console.log('Fonts loaded.');

  // Test getFont exact match
  const inter400 = getFont('Inter', 400, 'normal');
  console.log('Inter 400:', inter400.usedFamily, inter400.usedWeight, inter400.usedStyle, 'faux:', inter400.faux);

  // Test nearest weight fallback
  const inter800 = getFont('Inter', 800, 'normal');
  console.log('Inter 800 (nearest):', inter800.usedFamily, inter800.usedWeight, inter800.usedStyle, 'faux:', inter800.faux);

  // Test faux italic
  const interItalic = getFont('Inter', 400, 'italic');
  console.log('Inter 400 italic (faux):', interItalic.usedFamily, interItalic.usedWeight, interItalic.usedStyle, 'faux:', interItalic.faux);

  // Test themeColors overlay
  const base = effectiveBaseStyle('clean', 'h1', {
    h1Font: 'Space Grotesk',
    h2Font: 'Inter',
    h3Font: 'Inter',
    textFont: 'Inter',
    h1Color: '#ff0000',
    h2Color: '#0000ff',
    h3Color: '#00ff00',
    textColor: '#111111',
    backgroundColor: '#ffffff'
  });
  console.log('Effective h1 base:', base.fontFamily, base.color, base.fontWeight, base.fontSizeMm);

  // Test custom template parse
  const custom = getTypeStyle('myCustom', 'h2', {
    myCustom: '.tmpl-myCustom.block-type-h2 { font-size: 10mm; line-height: 12mm; font-weight: 800; }'
  });
  console.log('Custom h2:', custom.fontSizeMm, custom.lineHeightMm, custom.fontWeight);

  // Test blockRectMm
  const rect = blockRectMm({ page: 1, col: 0, row: 0, colSpan: 4, rowSpan: 5 }, 15);
  console.log('Block rect:', rect);

  console.log('\nPhase 0 smoke test passed.');
})();
