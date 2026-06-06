// server/agent/imageStore.js — Image storage for media dehydration/rehydration.
//
// ResumeState blocks carry inline base64 image data (block.imageData). Before
// enqueue, these are dehydrated: base64 → storage URI. The worker rehydrates
// on demand when rendering screenshots. Most jobs never rehydrate.
//
// Starter implementation uses the local filesystem. Swap for S3/R2/etc. by
// implementing the same interface. No queue or engine change required.

import { randomUUID } from 'node:crypto';
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const STORE_DIR = join(__dirname, 'uploads');

// Ensure the store directory exists at module load
mkdir(STORE_DIR, { recursive: true }).catch(() => {});

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Dehydrate all imageData fields in a ResumeState, replacing base64 URIs
 * with storage references. Returns the dehydrated state (shallow copy).
 *
 * @param {Object} state - ResumeState
 * @returns {Promise<Object>} dehydrated state
 */
export async function dehydrateState(state) {
  if (!state.blocks) return state;

  const blocks = await Promise.all(state.blocks.map(async (block) => {
    if (block.imageData && block.imageData.startsWith('data:')) {
      const uri = await storeImage(block.imageData);
      return { ...block, imageData: uri };
    }
    // Reject any pre-existing file:// URIs — only our own storeImage output is
    // trusted. An attacker injecting "file:///etc/passwd" is stripped here so
    // it never reaches rehydrateState / fetchImage.
    if (block.imageData && block.imageData.startsWith('file:')) {
      const { imageData: _stripped, ...rest } = block;
      return rest;
    }
    return block;
  }));

  return { ...state, blocks };
}

/**
 * Rehydrate all imageData fields in a ResumeState: storage URI → base64.
 * Used by the worker before rendering if screenshot tool is invoked.
 *
 * @param {Object} state - dehydrated ResumeState
 * @returns {Promise<Object>} rehydrated state
 */
export async function rehydrateState(state) {
  if (!state.blocks) return state;

  const blocks = await Promise.all(state.blocks.map(async (block) => {
    if (block.imageData && !block.imageData.startsWith('data:')) {
      const dataUri = await fetchImage(block.imageData);
      return { ...block, imageData: dataUri };
    }
    return block;
  }));

  return { ...state, blocks };
}

// ---------------------------------------------------------------------------
// Low-level image operations (filesystem-backed)
// ---------------------------------------------------------------------------

/**
 * Store a base64 data URI and return a storage reference.
 * @param {string} dataUri
 * @returns {Promise<string>} storage URI (e.g. "file://uploads/<uuid>.jpg")
 */
async function storeImage(dataUri) {
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  const ext = match?.[1] || 'png';
  const b64 = match?.[2] || dataUri;
  const buffer = Buffer.from(b64, 'base64');

  const filename = `${randomUUID()}.${ext}`;
  const filepath = join(STORE_DIR, filename);
  await writeFile(filepath, buffer);

  return `file://${STORE_DIR}/${filename}`;
}

/**
 * Fetch a stored image and return as base64 data URI.
 * @param {string} uri - storage URI
 * @returns {Promise<string>} base64 data URI
 */
async function fetchImage(uri) {
  const match = uri.match(/^file:\/\/(.+)$/);
  if (!match) throw new Error(`Unsupported storage URI: ${uri}`);

  const filepath = match[1];
  // Guard against path traversal — only files inside STORE_DIR may be read.
  const resolved = resolve(filepath);
  if (!resolved.startsWith(STORE_DIR + '/') && resolved !== STORE_DIR) {
    throw new Error(`Invalid storage path (outside store directory): ${uri}`);
  }
  const buffer = await readFile(filepath);

  const ext = filepath.split('.').pop() || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Clean up all stored images for a dehydrated state.
 * @param {Object} state - dehydrated ResumeState
 */
export async function cleanupState(state) {
  if (!state.blocks) return;
  for (const block of state.blocks) {
    if (block.imageData && !block.imageData.startsWith('data:')) {
      const match = block.imageData.match(/^file:\/\/(.+)$/);
      if (match) {
        // Guard against path traversal before deleting.
        const resolved = resolve(match[1]);
        if (!resolved.startsWith(STORE_DIR + '/') && resolved !== STORE_DIR) continue;
        await unlink(match[1]).catch(() => {});
      }
    }
  }
}
