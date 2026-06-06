/**
 * Rename downloaded Google Fonts files to our slug convention.
 * Maps each @font-face block to family/weight/style, then renames.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const VENDOR_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'vendor');

const FONTS = [
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

function fetch(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetch(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function slug(family) {
  return family.replace(/\s+/g, '+');
}

function weightSpec(italic, weights) {
  if (italic) {
    return 'ital,wght@' + weights.map(w => `1,${w}`).join(';');
  }
  return 'wght@' + weights.join(';');
}

function binarySlug(family, weight, italic) {
  const f = family.replace(/\s+/g, '-').toLowerCase();
  const i = italic ? '-italic' : '';
  return `${f}-${weight}${i}.woff2`;
}

(async () => {
  for (const { family, weights, italic } of FONTS) {
    const spec = weightSpec(italic, weights);
    const cssUrl = `https://fonts.googleapis.com/css2?family=${slug(family)}:${spec}&display=swap`;
    const css = await fetch(cssUrl);
    const cssText = css.toString('utf8');

    // Parse each @font-face block
    const faceRegex = /@font-face\s*\{([^}]+)\}/g;
    let m;
    while ((m = faceRegex.exec(cssText)) !== null) {
      const block = m[1];
      const srcMatch = block.match(/src:\s*url\((https:\/\/[^)]+\.woff2)\)/);
      if (!srcMatch) continue;

      const url = srcMatch[1];
      const origName = url.split('/').pop();
      const origPath = path.join(VENDOR_DIR, origName);

      const weightMatch = block.match(/font-weight:\s*(\d+)/);
      const styleMatch = block.match(/font-style:\s*(\w+)/);
      const w = weightMatch ? parseInt(weightMatch[1]) : 400;
      const s = styleMatch ? styleMatch[1] : 'normal';
      const isItalic = s === 'italic';

      const newName = binarySlug(family, w, isItalic);
      const newPath = path.join(VENDOR_DIR, newName);

      if (fs.existsSync(origPath)) {
        if (origPath !== newPath) {
          if (fs.existsSync(newPath)) {
            console.warn(`Skipping ${origName} -> ${newName}: target already exists (subset collision)`);
          } else {
            fs.renameSync(origPath, newPath);
            console.log(`Renamed ${origName} -> ${newName}`);
          }
        }
      }
    }
  }
  console.log('Done renaming.');
})();
