// Node-host provider implementations for the Agentic Resume SDK.
//
// These are the environment-specific counterparts to providers/browser.js.
// The modelProvider uses the direct Anthropic SDK (streaming) and normalises
// responses into the Phase-1 Delta shape. The screenshotProvider uses Puppeteer
// to render block screenshots, falling back gracefully when unavailable.
//
// Both conform to the interfaces in ../types.js so the engine runs identically
// regardless of which host injects them.

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// OpenRouter/OpenAI ↔ Anthropic message & tool format converters
// ---------------------------------------------------------------------------

/**
 * Convert an OpenRouter/OpenAI-format message array to Anthropic format.
 * @param {Array<Object>} messages
 * @returns {Array<Object>}
 */
function toAnthropicMessages(messages) {
  const result = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // system prompt is separate
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
        result.push({ role: 'assistant', content });
      } else {
        result.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '' });
      }
    } else if (msg.role === 'tool') {
      result.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }]
      });
    }
  }
  return result;
}

/**
 * Convert OpenRouter/OpenAI-format tool definitions to Anthropic format.
 * @param {Array<Object>} tools
 * @returns {Array<Object>}
 */
function toAnthropicTools(tools) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));
}

// ---------------------------------------------------------------------------
// nodeModelProvider
// ---------------------------------------------------------------------------

/**
 * Node model provider — streams normalized Deltas from Anthropic's API.
 *
 * Converts the engine's OpenRouter-style message/tool format to Anthropic
 * format, calls the streaming API, and normalises text + tool_use blocks
 * into the Phase-1 Delta shape.
 *
 * @type {import('../types.js').ModelProvider}
 */
export async function* nodeModelProvider({ messages, systemPrompt, model, tools, signal }) {
  if (signal?.aborted) {
    const err = new Error('AbortError');
    err.name = 'AbortError';
    throw err;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const client = new Anthropic({ apiKey });

  // Strip "anthropic/" prefix if present (the engine uses OpenRouter-style IDs).
  // Fallback matches engine default (anthropic/claude-sonnet-4-5 → claude-sonnet-4-5).
  const anthropicModel = (model || 'anthropic/claude-sonnet-4-5').replace(/^anthropic\//, '');

  const stream = client.messages.stream({
    model: anthropicModel,
    max_tokens: 4096,
    system: systemPrompt,
    messages: toAnthropicMessages(messages),
    tools: tools ? toAnthropicTools(tools) : undefined,
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      try { stream.controller.abort(); } catch (_) {}
    }, { once: true });
  }

  // Bridge callback-based stream to async generator via a promise queue
  const queue = [];
  let resolveNext = null;
  let done = false;
  let streamError = null;
  let toolCallIndex = 0;

  stream.on('text', (delta) => {
    queue.push({ content: delta });
    if (resolveNext) { const r = resolveNext; resolveNext = null; r(); }
  });

  stream.on('contentBlock', (block) => {
    if (block.type === 'tool_use') {
      queue.push({
        tool_calls: [{
          index: toolCallIndex++,
          id: block.id,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        }]
      });
      if (resolveNext) { const r = resolveNext; resolveNext = null; r(); }
    }
  });

  stream.on('end', () => { done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } });
  stream.on('error', (err) => { streamError = err; done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } });
  stream.on('abort', () => { done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } });

  while (!done || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift();
    } else if (!done) {
      await new Promise(r => { resolveNext = r; });
    }
  }

  if (streamError) throw streamError;
}

// ---------------------------------------------------------------------------
// nodeScreenshotProvider
// ---------------------------------------------------------------------------

/**
 * Node screenshot provider — renders a single block via Puppeteer.
 *
 * Reuses the same pattern as the /api/screenshot endpoint (vite.config.js:793):
 * launch Puppeteer, navigate to the dev-server-hosted CV page, locate the
 * target block element by data-block-id, and capture a JPEG screenshot.
 *
 * If Puppeteer is unavailable or the dev server is not running, the provider
 * throws a structured error. Screenshots are advisory — the engine loop
 * continues past screenshot failures (per FR3.7).
 *
 * @type {import('../types.js').ScreenshotProvider}
 */
export async function nodeScreenshotProvider({ blocks, pageTitle, paddingMm, templateName, themeColors, blockId }) {
  // The dev server port can be set explicitly or defaults to 5173 (Vite default).
  // In a CI/server context this may be supplied via env.
  const port = process.env.DEV_SERVER_PORT || process.env.PORT || '5173';

  let browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Navigate to the CV page in export mode with the block data.
    // The screenshot endpoint pattern uses a print cache, but for headless we
    // pass data via query params or just take a plain page screenshot.
    // For now we target the dev server; a fully offline render (canvas-based)
    // is a future enhancement.
    const url = `http://127.0.0.1:${port}/?export=true`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

    const el = await page.$(`[data-block-id="${blockId}"]`);
    if (!el) {
      throw new Error(`Block ${blockId} not found on page`);
    }

    const buffer = await el.screenshot({ type: 'jpeg', quality: 80 });
    return { screenshot: buffer.toString('base64') };
  } catch (err) {
    // Puppeteer unavailable, dev server not running, or block not found.
    // The tool returns a structured error; the engine loop continues.
    throw new Error(`Screenshot unavailable (${err.message}). Ensure a dev server is running at port ${port} with Puppeteer installed.`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}
