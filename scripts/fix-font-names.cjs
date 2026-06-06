/**
 * Normalize font filenames to the binarySlug convention.
 */
const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'vendor');

const RENAMES = {
  'fira-code-medium-500.ttf': 'fira-code-500.ttf',
  'inter-medium-500.ttf': 'inter-500.ttf',
  'inter-semibold-600.ttf': 'inter-600.ttf',
  'noto-serif-semibold-600.ttf': 'noto-serif-600.ttf',
  'outfit-semibold-600.ttf': 'outfit-600.ttf',
  'outfit-extrabold-800.ttf': 'outfit-800.ttf',
  'space-grotesk-medium-500.ttf': 'space-grotesk-500.ttf',
  'work-sans-medium-500.ttf': 'work-sans-500.ttf',
  'work-sans-semibold-600.ttf': 'work-sans-600.ttf',
};

for (const [oldName, newName] of Object.entries(RENAMES)) {
  const oldPath = path.join(VENDOR_DIR, oldName);
  const newPath = path.join(VENDOR_DIR, newName);
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) {
      console.warn(`Skipping ${oldName} -> ${newName}: target already exists`);
    } else {
      fs.renameSync(oldPath, newPath);
      console.log(`Renamed ${oldName} -> ${newName}`);
    }
  }
}

console.log('Done.');
