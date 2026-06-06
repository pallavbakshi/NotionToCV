import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import { enqueue, getJob, canAccess, cancelJob } from './server/agent/queue.js'
import { dehydrateState } from './server/agent/imageStore.js'
import { start as startWorker } from './server/agent/worker.js'

const printCache = new Map();

const ANTHROPIC_KEYWORDS = ['claude', 'anthropic', 'opus', 'sonnet', 'haiku'];

function isAnthropicModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return ANTHROPIC_KEYWORDS.some(kw => lower.includes(kw));
}

function resolveModelName(requestedModel, env) {
  if (!requestedModel) return 'anthropic/claude-3.5-sonnet';
  const lower = requestedModel.toLowerCase();
  if (lower.includes('opus')) {
    return env.ANTHROPIC_DEFAULT_OPUS_MODEL || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || requestedModel;
  }
  if (lower.includes('sonnet') || requestedModel === 'anthropic/claude-3.5-sonnet') {
    return env.ANTHROPIC_DEFAULT_SONNET_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || requestedModel;
  }
  if (lower.includes('haiku')) {
    return env.ANTHROPIC_DEFAULT_HAIKU_MODEL || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || requestedModel;
  }
  return requestedModel;
}

function mapOpenAiMessagesToAnthropic(messages) {
  return messages.map(msg => {
    if (msg.role === 'assistant') {
      const content = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedArgs = {};
          const tcFunc = tc.function || {};
          try {
            parsedArgs = typeof tcFunc.arguments === 'string' ? JSON.parse(tcFunc.arguments) : tcFunc.arguments;
          } catch (e) {
            console.error('Failed to parse tool arguments:', tcFunc.arguments, e);
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tcFunc.name,
            input: parsedArgs
          });
        }
      }
      return {
        role: 'assistant',
        content: content.length > 0 ? content : undefined
      };
    } else if (msg.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content
          }
        ]
      };
    } else {
      // role: 'user'
      if (typeof msg.content === 'string') {
        return {
          role: 'user',
          content: msg.content
        };
      } else if (Array.isArray(msg.content)) {
        const content = msg.content.map(part => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          } else if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: match[1],
                    data: match[2]
                  }
                };
              }
            }
            return { type: 'text', text: `[Image URL: ${url}]` };
          }
          return part;
        });
        return {
          role: 'user',
          content
        };
      }
      return {
        role: 'user',
        content: String(msg.content || '')
      };
    }
  }).filter(m => m.content !== undefined);
}

function mergeConsecutiveRoles(messages) {
  if (messages.length === 0) return [];
  const merged = [];
  let currentMsg = null;

  for (const msg of messages) {
    if (!currentMsg) {
      currentMsg = { role: msg.role, content: Array.isArray(msg.content) ? [...msg.content] : [msg.content] };
    } else if (currentMsg.role === msg.role) {
      const additionalParts = Array.isArray(msg.content) ? msg.content : [msg.content];
      const currentParts = currentMsg.content.map(p => typeof p === 'string' ? { type: 'text', text: p } : p);
      const newParts = additionalParts.map(p => typeof p === 'string' ? { type: 'text', text: p } : p);
      currentMsg.content = [...currentParts, ...newParts];
    } else {
      merged.push(currentMsg);
      currentMsg = { role: msg.role, content: Array.isArray(msg.content) ? [...msg.content] : [msg.content] };
    }
  }
  if (currentMsg) {
    merged.push(currentMsg);
  }

  return merged.map(m => {
    if (m.content.length === 1 && typeof m.content[0] === 'string') {
      return { role: m.role, content: m.content[0] };
    }
    return {
      role: m.role,
      content: m.content.map(c => typeof c === 'string' ? { type: 'text', text: c } : c)
    };
  });
}

function mainPlugin(env) {
  return {
    name: 'vite-plugin-notion-cv',
    configureServer(server) {
      startWorker();

      server.middlewares.use((req, res, next) => {

        // ── /api/print ──────────────────────────────────────────────────
        // Canonical PDF generation: uses the layout engine's renderResumePDF
        // directly (no headless browser). Same code path as agent measurement.
        if (req.url === '/api/print' && req.method === 'POST') {
          let body = '';
          const MAX_BODY_SIZE = 10 * 1024 * 1024;
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_BODY_SIZE) {
              res.statusCode = 413;
              res.end('Payload too large');
              req.destroy();
            }
          });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              // Dynamic import of the layout engine (Node-only server context)
              const layout = await import('./src/lib/layout/index.js');
              await layout.initFonts();

              const ctx = {
                templateName: data.templateName || 'clean',
                paddingMm: data.paddingMm || 15,
                themeColors: data.themeColors || {},
                // Honor manually-added blank trailing pages (pages with no blocks).
                pageCount: data.pageCount || 1,
              };

              const pdfBytes = await layout.renderResumePDF(data.blocks || [], ctx);

              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="${data.pageTitle || 'resume'}.pdf"`);
              res.end(Buffer.from(pdfBytes));
            } catch (err) {
              console.error('Error generating PDF:', err);
              res.statusCode = 500;
              res.end('Error generating PDF: ' + err.message);
            }
          });

        // ── /api/print-data ─────────────────────────────────────────────
        } else if (req.url.startsWith('/api/print-data') && req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost');
          const id = url.searchParams.get('id');
          const data = printCache.get(id);
          if (data) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } else {
            res.statusCode = 404;
            res.end('Not found');
          }

        // ── /api/extract ────────────────────────────────────────────────
        } else if (req.url === '/api/extract' && req.method === 'POST') {
          let body = '';
          const MAX_BODY_SIZE = 20 * 1024 * 1024;
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_BODY_SIZE) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'File too large (max 20 MB)' }));
              req.destroy();
            }
          });
          req.on('end', async () => {
            try {
              const { pdfBase64 } = JSON.parse(body);
              if (!pdfBase64) throw new Error('No PDF data received');

              const OPENROUTER_KEY = env.OPENROUTER_API_KEY;
              if (!OPENROUTER_KEY) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not set in .env' }));
                return;
              }

              const pdfBuffer = Buffer.from(pdfBase64, 'base64');

              // ── Steps 1+2: Render pages with pdfjs-dist + @napi-rs/canvas ─
              // No browser launch, no temp files, no sleeps — programmatic render
              const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
              GlobalWorkerOptions.workerSrc = new URL(
                './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
                import.meta.url
              ).href;

              const { createCanvas } = await import('@napi-rs/canvas');

              // getDocument() returns a PDFDocumentLoadingTask — keep ref for proper cleanup
              const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) });
              const pdfDoc = await loadingTask.promise;
              const pageCount = pdfDoc.numPages;

              if (pageCount > 3) {
                await loadingTask.destroy(); // destroy() lives on the loading task, not the doc
                res.statusCode = 400;
                res.end(JSON.stringify({
                  error: `Your CV has ${pageCount} pages. Only CVs with 3 pages or fewer can be imported.`
                }));
                return;
              }

              // Render all pages in parallel at 1.5× scale (~108 dpi — sharp enough
              // for vision OCR, ~45% smaller payload than 2× → faster upload + inference)
              const screenshots = await Promise.all(
                Array.from({ length: pageCount }, async (_, i) => {
                  const page = await pdfDoc.getPage(i + 1);
                  const viewport = page.getViewport({ scale: 1.5 });
                  const canvas = createCanvas(viewport.width, viewport.height);
                  const ctx = canvas.getContext('2d');
                  await page.render({ canvasContext: ctx, viewport }).promise;
                  page.cleanup(); // cleanup() on PDFPageProxy, returns boolean (not async)
                  return canvas.toBuffer('image/jpeg', 75).toString('base64');
                })
              );

              await loadingTask.destroy(); // frees the worker thread
              console.log(`[extract] Rendered ${screenshots.length} page(s) with pdfjs`);

              // ── Step 3: Parallel OpenRouter calls ───────────────────
              // One CONTENT call per page (each sees only its own image → far fewer
              // output tokens per call, and all run concurrently) plus ONE THEME call
              // that only needs page 1 (design is consistent across pages).
              const imageFor = (b64) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'auto' }
              });

              const orHeaders = {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:5173',
                'X-Title': 'NotionToCV'
              };

              // Helper: strip markdown fences that models often wrap responses in
              function stripFences(text) {
                const m = text.match(/```(?:json|css)?\s*([\s\S]*?)```/);
                return m ? m[1].trim() : text.trim();
              }

              // Helper: escape raw control chars that appear INSIDE JSON string
              // literals. LLMs frequently emit literal newlines/tabs inside strings
              // instead of \n / \t, which makes JSON.parse throw.
              function sanitizeJsonControlChars(str) {
                let out = '';
                let inString = false;
                let escaped = false;
                for (let i = 0; i < str.length; i++) {
                  const ch = str[i];
                  const code = str.charCodeAt(i);
                  if (escaped) { out += ch; escaped = false; continue; }
                  if (ch === '\\') { out += ch; escaped = true; continue; }
                  if (ch === '"') { inString = !inString; out += ch; continue; }
                  if (inString && code < 0x20) {
                    if (ch === '\n') out += '\\n';
                    else if (ch === '\r') out += '\\r';
                    else if (ch === '\t') out += '\\t';
                    else out += '\\u' + code.toString(16).padStart(4, '0');
                    continue;
                  }
                  out += ch;
                }
                return out;
              }

              // Helper: normalize LLM inline content to exactly what Tiptap expects.
              function normalizeInlineContent(raw) {
                if (!Array.isArray(raw)) return [];
                const out = [];
                for (const node of raw) {
                  if (!node || typeof node !== 'object') continue;
                  if (node.type === 'text') {
                    const text = String(node.text ?? '');
                    if (!text) continue;
                    const validTypes = new Set(['bold', 'italic', 'underline', 'strike']);
                    const marks = (node.marks ?? []).filter(m => m && validTypes.has(m.type));
                    out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
                  } else if (node.type === 'hardBreak') {
                    out.push({ type: 'hardBreak' });
                  } else if (['paragraph', 'heading', 'doc'].includes(node.type)) {
                    out.push(...normalizeInlineContent(node.content));
                  } else if (typeof node.text === 'string' && node.text) {
                    out.push({ type: 'text', text: node.text });
                  }
                }
                return out;
              }

              // Helper: make one OpenRouter call and return the raw text content
              async function orCall(model, userContent) {
                const raw = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                  method: 'POST',
                  headers: orHeaders,
                  body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: userContent }]
                  })
                });
                const json = await raw.json();
                if (json.error) throw new Error(`OpenRouter error: ${json.error.message ?? JSON.stringify(json.error)}`);
                const text = json.choices?.[0]?.message?.content;
                if (!text) throw new Error(`Empty response from ${model}. Full response: ${JSON.stringify(json).slice(0, 400)}`);
                return text;
              }

              const MODEL = 'google/gemini-2.5-flash';

              const contentPromptFor = (pageNum, total) =>
                `This is page ${pageNum} of ${total} of a CV/resume. Extract all text visible on THIS page and return a JSON object.

Schema: { "blocks": [ { "type": "h1"|"h2"|"h3"|"paragraph", "content": [ { "type": "text", "text": "...", "marks": [] } ] } ] }

Rules:
- h1: The person's full name — only if shown as the main title on this page (usually only page 1). Otherwise do not emit an h1.
- h2: Section headings (EXPERIENCE, EDUCATION, SKILLS, etc.)
- h3: Sub-section titles (job titles, companies, degree names, school names)
- paragraph: Descriptions, dates, locations, bullet points, contact info, all other text
- Bold text → marks: [{"type":"bold"}]; Italic → marks: [{"type":"italic"}]; Plain → marks: []

Extract ALL content on this page, top-to-bottom left-to-right.
Respond with valid JSON only. You may wrap it in \`\`\`json fences.`;

              // Font sizes & line-heights are LOCKED to the canvas grid (1 row = 5mm:
              // paragraph 1 row, h3 2 rows, h2 3 rows, h1 4 rows) so we do NOT let the
              const themePrompt =
                `Analyze the color scheme of this CV/resume and return a JSON object containing its color tokens.

Schema (return exactly this shape):
{
  "textColor": "<hex, e.g. #333333 — body/paragraph text color>",
  "h1Color": "<hex, e.g. #111111 — primary main title/name color (h1)>",
  "h2Color": "<hex, e.g. #0a2463 — section headings & dividers color (h2)>",
  "h3Color": "<hex, e.g. #1e293b — sub-section/role title color (h3)>",
  "backgroundColor": "<hex, e.g. #ffffff — paper background color>"
}

Return ONLY valid JSON. You may wrap it in \`\`\`json fences.`;

              console.log(`[extract] Firing ${pageCount} content call(s) + 1 theme call in parallel...`);
              const t0 = Date.now();

              // Per-page content promises (in page order) + one theme promise (page 1)
              const contentPromises = screenshots.map((b64, i) =>
                orCall(MODEL, [imageFor(b64), { type: 'text', text: contentPromptFor(i + 1, pageCount) }])
              );
              const themePromise =
                orCall(MODEL, [imageFor(screenshots[0]), { type: 'text', text: themePrompt }]);

              const [themeRaw, ...contentRaws] = await Promise.all([themePromise, ...contentPromises]);
              console.log(`[extract] All LLM calls done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

              // ── Parse content (merge pages in order) ────────────────
              let blocks = [];
              contentRaws.forEach((contentRaw, pageIdx) => {
                try {
                  const parsed = JSON.parse(sanitizeJsonControlChars(stripFences(contentRaw)));
                  const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
                  for (const b of rawBlocks) {
                    blocks.push({
                      id: 'b_' + Math.random().toString(36).substring(2, 9),
                      type: ['h1', 'h2', 'h3', 'paragraph'].includes(b.type) ? b.type : 'paragraph',
                      content: normalizeInlineContent(b.content),
                      canvas: null,
                      name: null
                    });
                  }
                } catch (e) {
                  console.error(`[extract] Failed to parse page ${pageIdx + 1} JSON:`, e.message);
                  console.error('[extract] Stripped:', stripFences(contentRaw).slice(0, 300));
                }
              });
              console.log(`[extract] Parsed ${blocks.length} blocks across ${pageCount} page(s)`);

              // ── Build CSS from validated design tokens ──────────────
              // Sizes/line-heights are GRID-LOCKED here, never from the model.
              const templateId = `custom-${Date.now().toString(36)}`;

              function validHex(c, fallback) {
                return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : fallback;
              }
              // Generic fallback family so text still renders if a webfont is slow
              function fontStack(f) {
                const serif = ['Noto Serif', 'Lora', 'Playfair Display'];
                const mono = ['Fira Code'];
                const generic = serif.includes(f) ? 'serif' : mono.includes(f) ? 'monospace' : 'sans-serif';
                return `'${f}', ${generic}`;
              }

              let t = {};
              try {
                t = JSON.parse(sanitizeJsonControlChars(stripFences(themeRaw))) || {};
              } catch (e) {
                console.error('[extract] Failed to parse theme tokens:', e.message);
                console.error('[extract] Theme raw:', stripFences(themeRaw).slice(0, 300));
              }

              const bodyFont = 'Inter';
              const headingFont = 'Inter';
              const textColor = validHex(t.textColor, '#1e1b18');
              const h1Color = validHex(t.h1Color, '#0a2463');
              const h2Color = validHex(t.h2Color, '#0a2463');
              const h3Color = validHex(t.h3Color, '#1e1b18');
              const backgroundColor = validHex(t.backgroundColor, '#ffffff');

              const h1Weight = 800;
              const h2Weight = 700;
              const h3Weight = 600;
              const bodyWeight = 400;
              const h2Transform = 'uppercase';
              const h2LetterSpacing = '1.5pt';
              const h2Border = `border-bottom: 0.75pt solid ${h2Color};`;

              // LOCKED grid sizes: line-height = rows × 5mm (h1=4, h2=3, h3=2, p=1)
              const css = `
.tmpl-${templateId} {
  font-family: ${fontStack(bodyFont)};
  color: ${textColor};
  background-color: ${backgroundColor};
}
.tmpl-${templateId}.block-type-h1 {
  font-family: ${fontStack(headingFont)};
  font-size: 16mm; line-height: 20mm;
  font-weight: ${h1Weight};
  color: ${h1Color};
  letter-spacing: -0.5pt;
  margin: 0; display: block;
}
.tmpl-${templateId}.block-type-h2 {
  font-family: ${fontStack(headingFont)};
  font-size: 12mm; line-height: 15mm;
  font-weight: ${h2Weight};
  color: ${h2Color};
  text-transform: ${h2Transform};
  letter-spacing: ${h2LetterSpacing};
  ${h2Border}
  margin: 0; display: block; width: 100%; box-sizing: border-box;
}
.tmpl-${templateId}.block-type-h3 {
  font-family: ${fontStack(headingFont)};
  font-size: 8mm; line-height: 10mm;
  font-weight: ${h3Weight};
  color: ${h3Color};
  margin: 0; display: block;
}
.tmpl-${templateId}.block-type-paragraph {
  font-family: ${fontStack(bodyFont)};
  font-size: 4mm; line-height: 5mm;
  font-weight: ${bodyWeight};
  color: ${textColor};
  margin: 0; white-space: pre-wrap; display: block;
}
.tmpl-${templateId} strong, .tmpl-${templateId} b { font-weight: 700; }
.tmpl-${templateId} em, .tmpl-${templateId} i { font-style: italic; }
.tmpl-${templateId} u { text-decoration: underline; }
.tmpl-${templateId} s, .tmpl-${templateId} strike { text-decoration: line-through; }`.trim();

              console.log(`[extract] Built CSS from colors — body:${bodyFont} heading:${headingFont} text:${textColor} h1:${h1Color} h2:${h2Color} h3:${h3Color} bg:${backgroundColor}`);

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                blocks,
                css,
                templateId,
                pageCount,
                themeColors: {
                  h1Color: h1Color,
                  h2Color: h2Color,
                  h3Color: h3Color,
                  textColor: textColor,
                  backgroundColor: backgroundColor
                }
              }));

            } catch (err) {
              console.error('CV extraction error:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Extraction failed: ' + err.message }));
            }
          });

        } else if (req.url === '/api/chat' && req.method === 'POST') {
          let body = '';
          const MAX_BODY_SIZE = 10 * 1024 * 1024;
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_BODY_SIZE) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'Payload too large' }));
              req.destroy();
            }
          });
          req.on('end', async () => {
            let timeoutId = null;
            const cleanup = () => {
              if (timeoutId) clearTimeout(timeoutId);
            };

            try {
              const { messages, systemPrompt, model, tools, tool_choice } = JSON.parse(body);

              const OPENROUTER_KEY = env.OPENROUTER_API_KEY;
              if (!OPENROUTER_KEY) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY not set in .env' }));
                return;
              }

              const isAnthropic = isAnthropicModel(model);

              if (isAnthropic) {
                const baseURL = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://openrouter.ai/api';
                const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
                const timeout = parseInt(env.API_TIMEOUT_MS || process.env.API_TIMEOUT_MS) || 120000;

                const anthropic = new Anthropic({
                  apiKey,
                  baseURL,
                  timeout
                });

                const resolvedModel = resolveModelName(model, env);
                const mappedMessages = mergeConsecutiveRoles(mapOpenAiMessagesToAnthropic(messages));

                const anthropicTools = tools ? tools.map(t => ({
                  name: t.function.name,
                  description: t.function.description,
                  input_schema: t.function.parameters
                })) : undefined;

                let anthropicToolChoice = undefined;
                if (tool_choice) {
                  if (tool_choice === 'auto') {
                    anthropicToolChoice = { type: 'auto' };
                  } else if (tool_choice === 'any') {
                    anthropicToolChoice = { type: 'any' };
                  } else if (typeof tool_choice === 'object' && tool_choice.function?.name) {
                    anthropicToolChoice = { type: 'tool', name: tool_choice.function.name };
                  }
                }

                const controller = new AbortController();
                timeoutId = setTimeout(() => {
                  console.log('Anthropic stream generation timeout');
                  controller.abort();
                }, timeout);

                req.on('aborted', () => {
                  controller.abort();
                });
                res.on('close', () => {
                  if (!res.writableEnded) {
                    controller.abort();
                  }
                });

                const stream = await anthropic.messages.create({
                  model: resolvedModel,
                  max_tokens: 4096,
                  system: systemPrompt,
                  messages: mappedMessages,
                  tools: anthropicTools,
                  tool_choice: anthropicToolChoice,
                  stream: true
                }, {
                  signal: controller.signal
                });

                cleanup();

                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                for await (const event of stream) {
                  if (controller.signal.aborted) {
                    break;
                  }

                  if (event.type === 'content_block_start') {
                    const index = event.index;
                    if (event.content_block?.type === 'tool_use') {
                      const toolUse = event.content_block;
                      const chunk = {
                        choices: [{
                          delta: {
                            tool_calls: [{
                              index: index,
                              id: toolUse.id,
                              type: 'function',
                              function: {
                                name: toolUse.name,
                                arguments: ''
                              }
                            }]
                          }
                        }]
                      };
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }
                  } else if (event.type === 'content_block_delta') {
                    if (event.delta?.type === 'text_delta') {
                      const text = event.delta.text;
                      const chunk = {
                        choices: [{
                          delta: {
                            content: text
                          }
                        }]
                      };
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    } else if (event.delta?.type === 'input_json_delta') {
                      const partialJson = event.delta.partial_json;
                      const chunk = {
                        choices: [{
                          delta: {
                            tool_calls: [{
                              index: event.index,
                              function: {
                                arguments: partialJson
                              }
                            }]
                          }
                        }]
                      };
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }
                  }
                }

                res.write('data: [DONE]\n\n');
                res.end();

              } else {
                // OpenAI-compatible fetch fallback
                const orHeaders = {
                  'Authorization': `Bearer ${OPENROUTER_KEY}`,
                  'Content-Type': 'application/json',
                  'HTTP-Referer': 'http://localhost:5173',
                  'X-Title': 'NotionToCV'
                };

                const timeout = parseInt(env.API_TIMEOUT_MS || process.env.API_TIMEOUT_MS) || 120000;

                const controller = new AbortController();
                timeoutId = setTimeout(() => {
                  console.log('OpenRouter stream generation timeout');
                  controller.abort();
                }, timeout);

                req.on('aborted', () => {
                  controller.abort();
                });
                res.on('close', () => {
                  if (!res.writableEnded) {
                    controller.abort();
                  }
                });

                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                  method: 'POST',
                  headers: orHeaders,
                  body: JSON.stringify({
                    model: model || 'google/gemini-2.5-flash',
                    messages: [
                      { role: 'system', content: systemPrompt },
                      ...messages
                    ],
                    tools,
                    tool_choice,
                    stream: true
                  }),
                  signal: controller.signal
                });

                if (!response.ok) {
                  cleanup();
                  const errText = await response.text();
                  res.statusCode = response.status;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'OpenRouter error: ' + errText }));
                  return;
                }

                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                let reader = null;
                try {
                  // Read response body as stream and stream to client
                  if (response.body) {
                    if (typeof response.body.getReader === 'function') {
                      reader = response.body.getReader();
                      while (true) {
                        if (controller.signal.aborted) {
                          break;
                        }
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (controller.signal.aborted) {
                          break;
                        }
                        res.write(value);
                      }
                    } else {
                      for await (const chunk of response.body) {
                        if (controller.signal.aborted) {
                          break;
                        }
                        res.write(chunk);
                      }
                    }
                  }
                } catch (streamErr) {
                  console.log('Stream generation aborted or closed:', streamErr.message);
                } finally {
                  cleanup();
                  if (reader) {
                    try {
                      await reader.cancel();
                    } catch (e) {}
                    try {
                      reader.releaseLock();
                    } catch (e) {}
                  }
                  res.end();
                }
              }
            } catch (err) {
              cleanup();
              console.error('Chat API error:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Chat API failed: ' + err.message }));
            }
          });

        } else if (req.url === '/api/screenshot' && req.method === 'POST') {
          let body = '';
          const MAX_BODY_SIZE = 10 * 1024 * 1024;
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_BODY_SIZE) {
              res.statusCode = 413;
              res.end('Payload too large');
              req.destroy();
            }
          });
          req.on('end', async () => {
            let browser;
            const printId = Math.random().toString(36).substring(2, 9);
            try {
              const data = JSON.parse(body);
              printCache.set(printId, data);

              // Dynamic import (Node-only, on demand) — keeps puppeteer out of the
              // module top-level and fixes the missing-import ReferenceError.
              const puppeteer = (await import('puppeteer')).default;
              browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
              });
              const page = await browser.newPage();

              const address = server.httpServer.address();
              const url = `http://127.0.0.1:${address.port}/?export=true&printId=${printId}`;

              await page.goto(url, { waitUntil: 'networkidle0' });

              if (data.blockId) {
                const el = await page.$(`[data-block-id="${data.blockId}"]`);
                if (el) {
                  const buffer = await el.screenshot({ type: 'jpeg', quality: 80 });
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ screenshot: buffer.toString('base64') }));
                } else {
                  res.statusCode = 404;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: `Block ${data.blockId} not found` }));
                }
              } else {
                const pageElements = await page.$$('.cv-page');
                const screenshots = [];
                for (const el of pageElements) {
                  const buffer = await el.screenshot({ type: 'jpeg', quality: 80 });
                  screenshots.push(buffer.toString('base64'));
                }

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ screenshots }));
              }
            } catch (err) {
              console.error('Error generating screenshots:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Error generating screenshots: ' + err.message }));
            } finally {
              printCache.delete(printId);
              if (browser) {
                try {
                  await browser.close();
                } catch (e) {
                  console.error('Failed to close browser:', e);
                }
              }
            }
          });

        // ── Agent queue routes (Phase 5) ───────────────────────────────────
        } else if (req.url === '/api/agent/queue' && req.method === 'POST') {
          let body = '';
          const MAX_BODY = 10 * 1024 * 1024; // 10 MB (matches print endpoint cap)
          req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > MAX_BODY) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: 'Payload too large' }));
              req.destroy();
            }
          });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const userId = req.headers['x-user-id'] || 'anonymous';

              // Validate ResumeState
              if (!data.state || !data.state.title || !Array.isArray(data.state.blocks)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid ResumeState' }));
                return;
              }

              // Dehydrate imageData before enqueue (FR5.8)
              const dehydratedState = await dehydrateState(data.state);

              const jobId = enqueue(userId, dehydratedState, data.instruction || 'Optimize my resume.', data.opts || {});

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ jobId }));
            } catch (err) {
              console.error('[agent/queue] Enqueue error:', err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });

        } else if (req.url.startsWith('/api/agent/job/') && req.method === 'GET') {
          const jobId = req.url.slice('/api/agent/job/'.length).split('?')[0];
          const userId = req.headers['x-user-id'] || 'anonymous';

          if (!canAccess(userId, jobId)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Job not found' }));
            return;
          }

          const job = getJob(jobId);
          if (!job) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Job not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(job));

        } else if (req.url.startsWith('/api/agent/job/') && req.method === 'DELETE') {
          const jobId = req.url.slice('/api/agent/job/'.length).split('?')[0];
          const userId = req.headers['x-user-id'] || 'anonymous';

          if (!canAccess(userId, jobId)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Job not found' }));
            return;
          }

          const ok = cancelJob(jobId);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ cancelled: ok, jobId }));

        } else {
          next();
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [svelte(), mainPlugin(env)]
  };
});
