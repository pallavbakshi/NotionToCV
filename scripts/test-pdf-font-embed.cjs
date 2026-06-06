/**
 * test-pdf-font-embed.cjs — Preflight: every vendored font must be embeddable AND
 * serializable by @pdf-lib/fontkit with { subset: false }.
 *
 * Why this exists: @pdf-lib/fontkit's bundled (old) fontkit can fail to RE-SERIALIZE
 * an otherwise-valid TTF at PDFDocument.save() — e.g. a malformed glyf bounding box
 * throws "Trying to access beyond buffer length". That crash only surfaces at save(),
 * not at embedFont(), so this script embeds + draws + SAVES each font. Space Grotesk
 * shipped with this defect and was sanitized via pyftsubset (--recalc-bounds); this
 * guards against a future bad font asset reintroducing it.
 *
 * Run: node scripts/test-pdf-font-embed.cjs
 */

const { PDFDocument } = require('pdf-lib');
const pdfFontkit = require('@pdf-lib/fontkit');
const fs = require('fs/promises');
const path = require('path');

// Mirrors FONT_INVENTORY in src/lib/layout/fonts.js (family/weight/style → slug).
const fonts = [
  'fira-code-400.ttf', 'fira-code-500.ttf',
  'inter-400.ttf', 'inter-500.ttf', 'inter-600.ttf', 'inter-700.ttf',
  'lora-400.ttf', 'lora-700.ttf', 'lora-400-italic.ttf',
  'outfit-400.ttf', 'outfit-600.ttf', 'outfit-700.ttf', 'outfit-800.ttf',
  'playfair-display-700.ttf', 'playfair-display-400-italic.ttf',
  'space-grotesk-400.ttf', 'space-grotesk-500.ttf', 'space-grotesk-700.ttf',
  'noto-serif-400.ttf', 'noto-serif-600.ttf', 'noto-serif-700.ttf',
  'work-sans-400.ttf', 'work-sans-500.ttf', 'work-sans-600.ttf', 'work-sans-700.ttf',
];

// A broad probe string so glyf outlines for common glyphs are actually serialized.
const PROBE = 'Experience & Skills fi fl Tg 0123456789 ABCDEFxyz';

(async () => {
  const dir = path.join(__dirname, '../src/assets/fonts/vendor');
  let failed = 0;
  for (const file of fonts) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(pdfFontkit);
    try {
      const bytes = await fs.readFile(path.join(dir, file));
      const font = await pdfDoc.embedFont(bytes, { subset: false });
      pdfDoc.addPage([400, 80]).drawText(PROBE, { font, size: 14, x: 10, y: 40 });
      await pdfDoc.save(); // the step that exposes the serialization defect
      console.log(`✓ ${file}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${file} — ${err.message}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} font(s) cannot be embedded. Sanitize with: ` +
      `pyftsubset <in> --output-file=<out> --glyphs='*' --layout-features='*' ` +
      `--no-hinting --recalc-bounds --recalc-timestamp`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${fonts.length} fonts embed + save cleanly.`);
  }
})();
