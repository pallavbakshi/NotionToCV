// Browser-host provider implementations for the Agentic Resume SDK.
// These are thin wrappers around the existing /api/chat and /api/screenshot
// endpoints — they extract the fetch+parse logic so the engine never touches
// the network or the DOM.
//
// Each provider conforms to the interface defined in ../types.js so the
// engine can be injected with Node equivalents without any engine change.

/**
 * Browser model provider — streams normalized Deltas from the server /api/chat endpoint via SSE.
 *
 * @type {import('../types.js').ModelProvider}
 */
export async function* browserModelProvider({ messages, systemPrompt, model, tools, signal }) {
  const payload = {
    messages,
    systemPrompt,
    model
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat API error (${response.status}): ${text.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine || !cleanLine.startsWith('data: ')) continue;
        const dataStr = cleanLine.substring(6);
        if (dataStr === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch (_e) {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        const content = delta.content || undefined;
        const toolCalls = delta.tool_calls?.length ? delta.tool_calls : undefined;

        if (content || toolCalls) {
          yield { content, tool_calls: toolCalls };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Browser screenshot provider — captures a block as base64 via the server
 * /api/screenshot endpoint. Extracted from agentTools.js:219–248.
 *
 * @type {import('../types.js').ScreenshotProvider}
 */
export async function browserScreenshotProvider({ blocks, pageTitle, paddingMm, templateName, themeColors, blockId }) {
  const screenshotAbort = new AbortController();
  const timeout = setTimeout(() => screenshotAbort.abort(), 30000);

  try {
    const response = await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: screenshotAbort.signal,
      body: JSON.stringify({ blocks, pageTitle, paddingMm, templateName, themeColors, blockId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Screenshot failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const result = await response.json();
    return { screenshot: result.screenshot };
  } finally {
    clearTimeout(timeout);
  }
}
