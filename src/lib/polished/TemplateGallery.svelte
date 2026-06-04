<!-- TemplateGallery.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';

  let { onSelect, onImport, onBackToDashboard } = $props();

  onDestroy(() => stopFunLoaders());

  // Compute scale so the 210mm-wide preview-page fills its wrapper
  let previewWrappers = $state([]);
  let previewScale = $state(0.19);

  onMount(() => {
    function updateScale() {
      if (previewWrappers[0]) {
        const wrapperPx = previewWrappers[0].getBoundingClientRect().width;
        const pageWidthPx = 210 * (96 / 25.4);
        previewScale = wrapperPx / pageWidthPx;
      }
    }
    updateScale();
    const ro = new ResizeObserver(updateScale);
    previewWrappers.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  });

  const templates = [
    {
      id: 'clean',
      name: 'Clean',
      tagline: 'Minimal & Timeless',
      desc: 'Inter · Pure black on white · Uppercase section dividers'
    },
    {
      id: 'modern',
      name: 'Modern',
      tagline: 'Bold & Technical',
      desc: 'Space Grotesk · Navy blue accents · Left-border section style'
    },
    {
      id: 'elegant',
      name: 'Elegant',
      tagline: 'Classic & Refined',
      desc: 'Playfair Display · Lora body · Terracotta italic headings'
    },
    {
      id: 'compact',
      name: 'Compact',
      tagline: 'Efficient & Dense',
      desc: 'Outfit · Deep green accents · Tight line heights for more content'
    }
  ];

  // ── Import state ──────────────────────────────────────────────────────
  let fileInput;
  let importing = $state(false);
  let importStep = $state('');   // status message shown during import
  let importError = $state('');
  let isDragOver = $state(false);

  // Fun loading state
  let elapsed = $state(0);          // seconds since import started
  let funMessageIndex = $state(0);
  let elapsedTimer = null;
  let funMessageTimer = null;

  const funMessages = [
    "🔍 Reading every line of your CV…",
    "🎨 Studying your fonts and colors…",
    "✍️  Transcribing your experience…",
    "📐 Measuring your section styles…",
    "🧠 Teaching the AI your taste…",
    "🌈 Matching your exact color palette…",
    "📚 Organizing your achievements…",
    "✨ Recreating your design, pixel by pixel…",
    "🪄 Almost there — adding finishing touches…",
    "☕ Good time to stretch — nearly done…"
  ];

  function startFunLoaders() {
    elapsed = 0;
    funMessageIndex = 0;
    elapsedTimer = setInterval(() => { elapsed += 1; }, 1000);
    funMessageTimer = setInterval(() => {
      funMessageIndex = (funMessageIndex + 1) % funMessages.length;
    }, 4000);
  }

  function stopFunLoaders() {
    clearInterval(elapsedTimer);
    clearInterval(funMessageTimer);
    elapsedTimer = null;
    funMessageTimer = null;
  }

  function fmtElapsed(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (file) startImport(file);
  }

  function handleDropZoneClick() {
    if (!importing) fileInput?.click();
  }

  function handleDrop(e) {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      startImport(file);
    } else {
      importError = 'Please drop a PDF file.';
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave() {
    isDragOver = false;
  }

  async function startImport(file) {
    if (file.type !== 'application/pdf') {
      importError = 'Only PDF files are supported.';
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      importError = 'File is too large. Please use a PDF under 15 MB.';
      return;
    }

    importing = true;
    importError = '';
    importStep = 'Reading PDF…';
    startFunLoaders();

    try {
      // Read file as base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      importStep = 'Rendering pages…';

      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64 })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'Extraction failed');
      }

      importStep = 'Extracting content & design…';
      const result = await response.json();
      const { blocks, css, templateId } = result;

      if (!blocks?.length) throw new Error(result.error || 'No content could be extracted — check the Vite server console for details.');
      if (!css) throw new Error('No design could be extracted — check the Vite server console for details.');

      onImport?.({ blocks, css, templateId });
    } catch (err) {
      importError = err.message;
    } finally {
      importing = false;
      importStep = '';
      stopFunLoaders();
      // Reset the file input so the same file can be re-selected
      if (fileInput) fileInput.value = '';
    }
  }
</script>

{#if importing}
  <!-- ── Full-screen fun loading overlay ─────────────────────────────── -->
  <div class="import-overlay">
    <div class="overlay-card">
      <!-- Animated scanning document -->
      <div class="scan-doc">
        <div class="scan-page">
          <span class="scan-line w1"></span>
          <span class="scan-line w2"></span>
          <span class="scan-line w3"></span>
          <span class="scan-line w2"></span>
          <span class="scan-line w1"></span>
          <span class="scan-line w3"></span>
          <span class="scan-line w2"></span>
        </div>
        <div class="scan-beam"></div>
      </div>

      <div class="overlay-title">Importing your CV</div>
      <div class="overlay-message">{funMessages[funMessageIndex]}</div>

      <div class="overlay-progress">
        <div class="overlay-progress-bar"></div>
      </div>

      <div class="overlay-meta">
        <span class="overlay-elapsed">⏱ {fmtElapsed(elapsed)}</span>
        <span class="overlay-hint">This can take a minute or two — hang tight</span>
      </div>
    </div>
  </div>
{/if}

<div class="gallery-backdrop">
  <div class="gallery-content">
    <div class="gallery-header">
      {#if onBackToDashboard}
        <button type="button" class="btn-back-dashboard" onclick={onBackToDashboard}>
          ← Back to Dashboard
        </button>
      {/if}
      <h1 class="gallery-title">Choose a template</h1>
      <p class="gallery-subtitle">You can change this any time from the toolbar</p>
    </div>

    <!-- ── Existing templates ──────────────────────────────────────── -->
    <div class="gallery-grid">
      {#each templates as tmpl, i}
        <button class="template-card" onclick={() => onSelect(tmpl.id)} type="button">
          <div class="preview-wrapper" bind:this={previewWrappers[i]}>
            <div class="preview-page" style="--preview-scale: {previewScale}">
              <div style="padding: 15mm;">
                <div class="block-type-h1 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Jane Smith</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}" style="margin-bottom: 6mm;">Product Designer · San Francisco, CA</div>
                <div class="block-type-h2 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Experience</div>
                <div class="block-type-h3 tmpl-{tmpl.id}" style="margin-bottom: 2mm;">Senior Designer, Acme Corp</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}" style="margin-bottom: 6mm;">Led product design across mobile platforms. Collaborated with engineers to ship features used by 2M+ users.</div>
                <div class="block-type-h2 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Education</div>
                <div class="block-type-h3 tmpl-{tmpl.id}" style="margin-bottom: 2mm;">BSc Computer Science, MIT</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}">2015 — 2019 · GPA 3.9/4.0</div>
              </div>
            </div>
          </div>

          <div class="card-info">
            <span class="card-name">{tmpl.name}</span>
            <span class="card-tagline">{tmpl.tagline}</span>
            <span class="card-desc">{tmpl.desc}</span>
          </div>

          <div class="card-cta">Use template →</div>
        </button>
      {/each}
    </div>

    <!-- ── Import divider ──────────────────────────────────────────── -->
    <div class="import-divider">
      <span class="import-divider-line"></span>
      <span class="import-divider-label">or import from an existing CV</span>
      <span class="import-divider-line"></span>
    </div>

    <!-- ── Drop zone ──────────────────────────────────────────────── -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="drop-zone"
      class:drag-over={isDragOver}
      class:loading={importing}
      onclick={handleDropZoneClick}
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
    >
      <input
        bind:this={fileInput}
        type="file"
        accept="application/pdf"
        onchange={handleFileInputChange}
        style="display: none;"
      />

      {#if importing}
        <div class="dz-loading">
          <span class="dz-spinner"></span>
          <span class="dz-step">{importStep}</span>
        </div>
      {:else}
        <div class="dz-idle">
          <span class="dz-icon">📄</span>
          <div class="dz-text">
            <span class="dz-primary">Drop your CV here or click to upload</span>
            <span class="dz-secondary">PDF only · max 3 pages · max 15 MB</span>
          </div>
        </div>
      {/if}
    </div>

    {#if importError}
      <p class="import-error">{importError}</p>
    {/if}
  </div>
</div>

<style>
  /* ── Fun loading overlay ─────────────────────────────────────────── */
  .import-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 90, 0.92));
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    animation: overlay-fade 0.3s ease-out;
  }

  @keyframes overlay-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .overlay-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 40px;
    max-width: 420px;
    text-align: center;
  }

  /* Animated scanning document */
  .scan-doc {
    position: relative;
    width: 90px;
    height: 116px;
    margin-bottom: 6px;
  }

  .scan-page {
    position: absolute;
    inset: 0;
    background: #ffffff;
    border-radius: 6px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    overflow: hidden;
  }

  .scan-line {
    height: 5px;
    border-radius: 2px;
    background: #e2e8f0;
  }
  .scan-line.w1 { width: 60%; }
  .scan-line.w2 { width: 90%; }
  .scan-line.w3 { width: 75%; }

  .scan-beam {
    position: absolute;
    left: 0;
    right: 0;
    height: 22px;
    background: linear-gradient(180deg, rgba(35, 131, 226, 0) 0%, rgba(35, 131, 226, 0.55) 50%, rgba(35, 131, 226, 0) 100%);
    border-radius: 4px;
    animation: scan-move 1.8s ease-in-out infinite;
    filter: blur(1px);
  }

  @keyframes scan-move {
    0%   { top: -22px; opacity: 0; }
    15%  { opacity: 1; }
    85%  { opacity: 1; }
    100% { top: 116px; opacity: 0; }
  }

  .overlay-title {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.3px;
  }

  .overlay-message {
    font-size: 14px;
    color: #cbd5e1;
    min-height: 20px;
    animation: msg-fade 0.5s ease-out;
  }

  @keyframes msg-fade {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .overlay-progress {
    width: 260px;
    height: 5px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    overflow: hidden;
  }

  .overlay-progress-bar {
    height: 100%;
    width: 40%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2383e2, #60a5fa);
    animation: indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0%   { transform: translateX(-120%); }
    100% { transform: translateX(360%); }
  }

  .overlay-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    margin-top: 2px;
  }

  .overlay-elapsed {
    font-size: 13px;
    font-weight: 600;
    color: #93c5fd;
    font-variant-numeric: tabular-nums;
  }

  .overlay-hint {
    font-size: 12px;
    color: #64748b;
  }

  .gallery-backdrop {
    position: fixed;
    inset: 0;
    background-color: #f8fafc;
    overflow-y: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 60px 24px 80px;
    z-index: 1000;
  }

  .gallery-content {
    width: 100%;
    max-width: 960px;
  }

  .gallery-header {
    text-align: center;
    margin-bottom: 48px;
  }

  .gallery-title {
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.5px;
    margin: 0 0 8px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .gallery-subtitle {
    font-size: 14px;
    color: #64748b;
    margin: 0;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  /* Template grid */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }

  @media (max-width: 860px) {
    .gallery-grid { grid-template-columns: repeat(2, 1fr); }
  }

  .template-card {
    background: #ffffff;
    border: 1.5px solid rgba(55, 53, 47, 0.1);
    border-radius: 12px;
    padding: 16px 16px 20px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .template-card:hover {
    border-color: #2383e2;
    box-shadow: 0 4px 20px rgba(35, 131, 226, 0.12);
    transform: translateY(-2px);
  }

  .template-card:focus-visible {
    outline: 2px solid #2383e2;
    outline-offset: 2px;
  }

  /* Scaled A4 preview */
  .preview-wrapper {
    width: 100%;
    aspect-ratio: 210 / 297;
    overflow: hidden;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    position: relative;
  }

  .preview-page {
    width: 210mm;
    height: 297mm;
    background: #ffffff;
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    transform: scale(var(--preview-scale, 0.19));
    pointer-events: none;
  }

  .card-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .card-name {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
  }

  .card-tagline {
    font-size: 12px;
    font-weight: 600;
    color: #2383e2;
    line-height: 1.3;
  }

  .card-desc {
    font-size: 11px;
    color: #64748b;
    line-height: 1.4;
    margin-top: 2px;
  }

  .card-cta {
    font-size: 12px;
    font-weight: 600;
    color: #2383e2;
    padding: 6px 12px;
    border-radius: 6px;
    background-color: rgba(35, 131, 226, 0.08);
    text-align: center;
    transition: background-color 0.15s;
  }

  .template-card:hover .card-cta {
    background-color: rgba(35, 131, 226, 0.15);
  }

  /* Import divider */
  .import-divider {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 40px 0 24px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .import-divider-line {
    flex: 1;
    height: 1px;
    background-color: rgba(55, 53, 47, 0.1);
  }

  .import-divider-label {
    font-size: 12px;
    color: #94a3b8;
    white-space: nowrap;
    font-weight: 500;
  }

  /* Drop zone */
  .drop-zone {
    border: 2px dashed rgba(55, 53, 47, 0.15);
    border-radius: 12px;
    padding: 32px 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: #ffffff;
    transition: border-color 0.15s, background-color 0.15s;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    min-height: 110px;
  }

  .drop-zone:hover:not(.loading) {
    border-color: #2383e2;
    background-color: rgba(35, 131, 226, 0.03);
  }

  .drop-zone.drag-over {
    border-color: #2383e2;
    background-color: rgba(35, 131, 226, 0.06);
  }

  .drop-zone.loading {
    cursor: default;
    border-color: rgba(55, 53, 47, 0.1);
  }

  .dz-idle {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .dz-icon {
    font-size: 28px;
    flex-shrink: 0;
  }

  .dz-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .dz-primary {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
  }

  .dz-secondary {
    font-size: 12px;
    color: #94a3b8;
  }

  .dz-loading {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .dz-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(35, 131, 226, 0.2);
    border-top-color: #2383e2;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .dz-step {
    font-size: 14px;
    font-weight: 500;
    color: #475569;
  }

  .import-error {
    margin-top: 12px;
    font-size: 13px;
    color: #ef4444;
    text-align: center;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .btn-back-dashboard {
    background: transparent;
    border: none;
    color: #2383e2;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 16px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    transition: background-color 0.15s;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .btn-back-dashboard:hover {
    background-color: rgba(35, 131, 226, 0.08);
  }
</style>
