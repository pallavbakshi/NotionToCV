/**
 * Download Google Fonts binaries for the layout engine whitelist.
 * Run: node scripts/download-fonts.cjs
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'vendor');

// Exact (family, weight, italic) combinations from index.html Google Fonts link
const FONTS = [
  // Fira Code
  { family: 'Fira Code', weights: [400, 500], italic: false },
  // Inter
  { family: 'Inter', weights: [400, 500, 600, 700], italic: false },
  // Lora
  { family: 'Lora', weights: [400, 700], italic: false },
  { family: 'Lora', weights: [400], italic: true },
  // Outfit
  { family: 'Outfit', weights: [400, 600, 700, 800], italic: false },
  // Playfair Display
  { family: 'Playfair Display', weights: [700], italic: false },
  { family: 'Playfair Display', weights: [400], italic: true },
  // Space Grotesk
  { family: 'Space Grotesk', weights: [400, 500, 700], italic: false },
  // Noto Serif
  { family: 'Noto Serif', weights: [400, 600, 700], italic: false },
  // Work Sans
  { family: 'Work Sans', weights: [400, 500, 600, 700], italic: false },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    // Minimal user-agent: Google Fonts serves single TTF files to non-browsers,
    // but WOFF2 subsets to browsers. We want the single complete TTF.
    const opts = {
      headers: {
        'User-Agent': 'Node.js'
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

async function downloadFont(family, weights, italic) {
  const spec = weightSpec(italic, weights);
  const cssUrl = `https://fonts.googleapis.com/css2?family=${slug(family)}:${spec}&display=swap`;
  console.log(`Fetching CSS: ${cssUrl}`);

  const css = await fetch(cssUrl);
  const cssText = css.toString('utf8');

  // Extract all src: url(...) URLs — with a non-browser user-agent Google
  // Fonts serves single complete TTF files (not WOFF2 subsets).
  const urlRegex = /src:\s*url\((https:\/\/[^)]+\.ttf)\)/g;
  const urls = [];
  let m;
  while ((m = urlRegex.exec(cssText)) !== null) {
    urls.push(m[1]);
  }

  if (urls.length === 0) {
    console.error(`  No font URLs found for ${family} ${italic ? 'italic' : ''} ${weights.join(',')}`);
    console.error(`  CSS snippet: ${cssText.slice(0, 400)}`);
    return;
  }

  for (const url of urls) {
    const fileName = url.split('/').pop();
    const outPath = path.join(OUT_DIR, fileName);

    if (fs.existsSync(outPath)) {
      console.log(`  Already have ${fileName}`);
      continue;
    }

    console.log(`  Downloading ${fileName}...`);
    const buf = await fetch(url);
    fs.writeFileSync(outPath, buf);
    console.log(`  Saved ${fileName} (${buf.length} bytes)`);
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { family, weights, italic } of FONTS) {
    await downloadFont(family, weights, italic);
  }
  console.log('Done.');
})();
