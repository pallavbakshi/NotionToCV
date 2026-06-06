// Node-host provider implementations for the Agentic Resume SDK.
//
// These are the environment-specific counterparts to providers/browser.js.
// Two model providers are available:
//   nodeModelProvider        — direct Anthropic SDK, requires ANTHROPIC_API_KEY
//   openRouterModelProvider  — OpenAI-compatible OpenRouter API, requires OPENROUTER_API_KEY
//
// Use pickNodeModelProvider() to auto-select based on available env vars.
// The screenshotProvider delegates to the running dev server's /api/screenshot.
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
          try {
            input = JSON.parse(tc.function.arguments || '{}');
          } catch (e) {
            console.warn(`Failed to parse tool arguments for ${tc.function.name}:`, e.message);
          }
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
        result.push({ role: 'assistant', content });
      } else {
        // Anthropic rejects empty-string content — use null for content-less turns.
        const text = typeof msg.content === 'string' ? msg.content : null;
        result.push({ role: 'assistant', content: text || null });
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
// openRouterModelProvider
// ---------------------------------------------------------------------------

/**
 * OpenRouter model provider — streams normalized Deltas via OpenRouter's
 * OpenAI-compatible API. Requires OPENROUTER_API_KEY. The engine already
 * uses OpenAI-style message/tool format internally, so no conversion is needed.
 *
 * @type {import('../types.js').ModelProvider}
 */
export async function* openRouterModelProvider({ messages, systemPrompt, model, tools, signal }) {
  if (signal?.aborted) {
    const err = new Error('AbortError');
    err.name = 'AbortError';
    throw err;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  // Prepend system prompt as the first message (OpenAI convention)
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const body = JSON.stringify({
    model: model || 'anthropic/claude-sonnet-4-5',
    messages: allMessages,
    tools: tools || undefined,
    stream: true,
    max_tokens: 4096
  });

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://notion-to-cv.local',
      'X-Title': 'NotionToCV'
    },
    body,
    signal
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${text.slice(0, 500)}`);
  }

  // Parse the SSE stream — same format as the browser provider parses from /api/chat
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const clean = line.trim();
        if (!clean || !clean.startsWith('data: ')) continue;
        const data = clean.slice(6);
        if (data === '[DONE]') continue;

        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { continue; }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        const content = delta.content || undefined;
        const toolCalls = delta.tool_calls?.length ? delta.tool_calls : undefined;
        if (content || toolCalls) yield { content, tool_calls: toolCalls };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Auto-select the right node model provider based on available env vars.
 * Prefers ANTHROPIC_API_KEY; falls back to OPENROUTER_API_KEY.
 * Throws if neither is set.
 *
 * @returns {import('../types.js').ModelProvider}
 */
export function pickNodeModelProvider() {
  if (process.env.ANTHROPIC_API_KEY) return nodeModelProvider;
  if (process.env.OPENROUTER_API_KEY) return openRouterModelProvider;
  throw new Error('No API key found. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.');
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

  // Delegates to the same POST /api/screenshot endpoint the browser provider uses.
  // The server endpoint accepts the full resume state, loads it into a Puppeteer
  // page via printCache, and returns a base64 JPEG of the target block. This is
  // identical to the browser provider path — no separate Puppeteer launch needed.
  // Requires a running dev server at the configured port (same as before).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ blocks, pageTitle, paddingMm, templateName, themeColors, blockId })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Screenshot API error (${res.status}): ${text.slice(0, 200)}`);
    }

    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return { screenshot: result.screenshot };
  } catch (err) {
    throw new Error(`Screenshot unavailable (${err.message}). Ensure a dev server is running at port ${port}.`);
  } finally {
    clearTimeout(timeout);
  }
}
