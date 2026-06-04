import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import puppeteer from 'puppeteer'
import fs from 'fs'

const printCache = new Map();

function mainPlugin(env) {
  return {
    name: 'vite-plugin-notion-cv',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {

        // ── /api/print ──────────────────────────────────────────────────
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
              const printId = Math.random().toString(36).substring(2, 9);
              printCache.set(printId, data);

              const browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
              });
              const page = await browser.newPage();

              const address = server.httpServer.address();
              const url = `http://127.0.0.1:${address.port}/?export=true&printId=${printId}`;

              await page.goto(url, { waitUntil: 'networkidle0' });

              const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
              });

              try {
                await browser.close();
              } finally {
                printCache.delete(printId);
              }

              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="${data.pageTitle || 'resume'}.pdf"`);
              res.end(pdfBuffer);
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
              // model choose them. We only extract constrained design tokens and build
              // the CSS ourselves. Fonts are restricted to the 6 we load in index.html.
              const ALLOWED_FONTS = ['Inter', 'Lora', 'Playfair Display', 'Space Grotesk', 'Fira Code', 'Outfit'];

              const themePrompt =
                `Analyze the typography and visual design of this CV/resume and return a JSON object describing its style as design tokens.

You MUST pick fonts ONLY from this list (choose the closest match to what you see):
${ALLOWED_FONTS.map(f => `  - ${f}`).join('\n')}

Schema (return exactly this shape):
{
  "bodyFont": "<one font from the list — for body/paragraph text>",
  "headingFont": "<one font from the list — for h1/h2/h3>",
  "textColor": "<hex, e.g. #333333 — body text color>",
  "headingColor": "<hex — h1 & h3 color>",
  "accentColor": "<hex — used for h2 section headings & dividers>",
  "h1Weight": <300-900 number>,
  "h2Weight": <300-900 number>,
  "h3Weight": <300-900 number>,
  "bodyWeight": <300-900 number>,
  "h2Transform": "uppercase" | "none",
  "h2Italic": true | false,
  "h2Divider": "underline" | "left-border" | "none",
  "h2LetterSpacing": "<e.g. 1.5pt or 0>"
}

Match the original's serif vs sans-serif feel, font weights, whether section headings are UPPERCASE, italic, and whether they use an underline or left bar.
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

              function validFont(f) {
                return ALLOWED_FONTS.includes(f) ? f : 'Inter';
              }
              function validHex(c, fallback) {
                return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : fallback;
              }
              function validWeight(w, fallback) {
                const n = parseInt(w);
                return (Number.isFinite(n) && n >= 300 && n <= 900) ? n : fallback;
              }
              // Generic fallback family so text still renders if a webfont is slow
              function fontStack(f) {
                const serif = ['Lora', 'Playfair Display'];
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

              const bodyFont = validFont(t.bodyFont);
              const headingFont = validFont(t.headingFont);
              const textColor = validHex(t.textColor, '#333333');
              const headingColor = validHex(t.headingColor, '#111111');
              const accentColor = validHex(t.accentColor, headingColor);
              const h1Weight = validWeight(t.h1Weight, 800);
              const h2Weight = validWeight(t.h2Weight, 700);
              const h3Weight = validWeight(t.h3Weight, 600);
              const bodyWeight = validWeight(t.bodyWeight, 400);
              const h2Transform = t.h2Transform === 'uppercase' ? 'uppercase' : 'none';
              const h2Italic = t.h2Italic === true;
              const h2Divider = ['underline', 'left-border', 'none'].includes(t.h2Divider) ? t.h2Divider : 'none';
              const h2LetterSpacing = (typeof t.h2LetterSpacing === 'string' && /^[\d.]+(pt|mm|px)$/.test(t.h2LetterSpacing.trim()))
                ? t.h2LetterSpacing.trim() : '0';

              // h2 divider style → border rule
              let h2Border = '';
              if (h2Divider === 'underline') h2Border = `border-bottom: 0.75pt solid ${accentColor};`;
              else if (h2Divider === 'left-border') h2Border = `border-left: 2mm solid ${accentColor}; padding-left: 3mm;`;

              // LOCKED grid sizes: line-height = rows × 5mm (h1=4, h2=3, h3=2, p=1)
              const css = `
.tmpl-${templateId} {
  font-family: ${fontStack(bodyFont)};
  color: ${textColor};
  background-color: #ffffff;
}
.tmpl-${templateId}.block-type-h1 {
  font-family: ${fontStack(headingFont)};
  font-size: 16mm; line-height: 20mm;
  font-weight: ${h1Weight};
  color: ${headingColor};
  letter-spacing: -0.5pt;
  margin: 0; display: block;
}
.tmpl-${templateId}.block-type-h2 {
  font-family: ${fontStack(headingFont)};
  font-size: 12mm; line-height: 15mm;
  font-weight: ${h2Weight};
  color: ${accentColor};
  text-transform: ${h2Transform};
  ${h2Italic ? 'font-style: italic;' : ''}
  letter-spacing: ${h2LetterSpacing};
  ${h2Border}
  margin: 0; display: block; width: 100%; box-sizing: border-box;
}
.tmpl-${templateId}.block-type-h3 {
  font-family: ${fontStack(headingFont)};
  font-size: 8mm; line-height: 10mm;
  font-weight: ${h3Weight};
  color: ${headingColor};
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

              console.log(`[extract] Built CSS from tokens — body:${bodyFont} heading:${headingFont} accent:${accentColor} divider:${h2Divider}`);

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ blocks, css, templateId, pageCount }));

            } catch (err) {
              console.error('CV extraction error:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Extraction failed: ' + err.message }));
            }
          });

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
