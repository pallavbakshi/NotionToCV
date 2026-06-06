/**
 * Rename downloaded TTF files using fontkit metadata.
 */
const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');

const VENDOR_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'vendor');

function binarySlug(family, weight, italic) {
  const f = family.replace(/\s+/g, '-').toLowerCase();
  const i = italic ? '-italic' : '';
  return `${f}-${weight}${i}.ttf`;
}

const files = fs.readdirSync(VENDOR_DIR).filter(f => f.endsWith('.ttf'));

for (const file of files) {
  const fullPath = path.join(VENDOR_DIR, file);
  try {
    const font = fontkit.create(fs.readFileSync(fullPath));
    const family = font.familyName;
    const subfamily = font.subfamilyName || '';
    const weight = font['OS/2'] ? font['OS/2'].usWeightClass : 400;
    const isItalic = subfamily.toLowerCase().includes('italic') ||
                     (font['OS/2'] && font['OS/2'].fsSelection & 0x01);

    const newName = binarySlug(family, weight, isItalic);
    const newPath = path.join(VENDOR_DIR, newName);

    if (fullPath !== newPath) {
      fs.renameSync(fullPath, newPath);
      console.log(`Renamed ${file} -> ${newName} (${family} ${weight} ${isItalic ? 'italic' : 'normal'})`);
    }
  } catch (e) {
    console.error(`Failed to process ${file}: ${e.message}`);
  }
}

console.log('Done.');
