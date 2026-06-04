<!-- PolishedPane.svelte -->
<script>
  import CvPage from './CvPage.svelte';
  import ElementsDock from './ElementsDock.svelte';
  import { findOverlappingIds } from './canvasUtils.js';

  let {
    blocks,
    paddingMm = $bindable(15),
    draggedBlockId = $bindable(),
    updateBlockCanvas,
    updateBlockName,
    addCanvasElement = null,
    removeCanvasElement = null,
    updateBlockImageData = null,
    isExportMode = false,
    pageTitle = '',
    templateName = 'clean'
  } = $props();

  let selectedBlockId = $state(null);
  let downloading = $state(false);

  // Count unplaced blocks
  let unplacedCount = $derived(
    blocks.filter(b => b.canvas === null).length
  );

  // Compute column width (same formula used everywhere)
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);

  // Detect overlapping blocks across all pages
  let overlappingBlockIds = $derived(
    findOverlappingIds(blocks, colWidth, paddingMm)
  );
  let overlapCount = $derived(overlappingBlockIds.size);

  // Find the maximum page containing at least one placed block
  let maxPlacedPage = $derived.by(() => {
    let max = 1;
    for (const b of blocks) {
      if (b.canvas && b.canvas.page > max) {
        max = b.canvas.page;
      }
    }
    return max;
  });

  // Pages to render: 1 to maxPlacedPage, plus one extra blank page if dragging is active
  let pagesToRender = $derived.by(() => {
    let pages = [];
    for (let p = 1; p <= maxPlacedPage; p++) {
      pages.push(p);
    }
    if (draggedBlockId) {
      pages.push(maxPlacedPage + 1);
    }
    return pages;
  });

  // Handle global keyboard shortcuts for selection
  function handleKeyDown(e) {
    if (!selectedBlockId) return;

    // Ignore shortcut if user is typing in an input, textarea, or contenteditable element
    const active = document.activeElement;
    if (active && (
      active.tagName === 'INPUT' || 
      active.tagName === 'TEXTAREA' || 
      active.isContentEditable
    )) {
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      updateBlockCanvas(selectedBlockId, null);
      selectedBlockId = null;
      e.preventDefault();
    } else if (e.key === 'Escape') {
      selectedBlockId = null;
      e.preventDefault();
    }
  }

  // Click outside pages deselects block
  function handleContainerClick(e) {
    if (!e.target.closest('.canvas-block')) {
      selectedBlockId = null;
    }
  }

  // Trigger PDF download pipeline via Vite server /api/print endpoint
  async function downloadPdf() {
    if (downloading) return;
    downloading = true;
    try {
      const response = await fetch('/api/print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          blocks,
          pageTitle,
          paddingMm
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const sanitizedTitle = (pageTitle.trim() || 'Untitled').replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${sanitizedTitle}_resume.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Error generating PDF: ' + err.message);
    } finally {
      downloading = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="polished-container" 
  class:export-mode={isExportMode}
  onclick={handleContainerClick}
>
  {#if !isExportMode}
    <!-- Toolbar (Section 7.3) -->
    <div class="canvas-toolbar">
      <div class="toolbar-label">Polished View</div>
      <div class="toolbar-controls">
        <div class="slider-group">
          <span class="slider-label">Page Padding: {paddingMm}mm</span>
          <input 
            type="range" 
            min="10" 
            max="25" 
            step="1"
            bind:value={paddingMm} 
            class="padding-slider" 
          />
        </div>
        <button 
          type="button" 
          class="btn-download" 
          onclick={downloadPdf}
          disabled={downloading}
        >
          {#if downloading}
            <span class="spinner"></span> Generating PDF...
          {:else}
            Download PDF
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- Scroll area for A4 pages -->
  <div class="pages-scroll-area" class:export-scroll={isExportMode}>
    
    {#if !isExportMode && unplacedCount > 0}
      <!-- Unplaced Blocks Indicator (Section 8) -->
      <div class="unplaced-banner">
        <span class="banner-icon">💡</span>
        <span class="banner-text">{unplacedCount} block{unplacedCount > 1 ? 's' : ''} not yet placed on the CV. Drag them onto the page!</span>
      </div>
    {/if}

    {#if !isExportMode && overlapCount > 0}
      <!-- Overlap Warning Banner -->
      <div class="overlap-banner">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">{overlapCount} block{overlapCount > 1 ? 's' : ''} overlapping! Move or resize the highlighted blocks to fix.</span>
      </div>
    {/if}

    <div class="pages-list">
      {#each pagesToRender as pageNum}
        <div class="page-wrapper" class:is-ghost={pageNum > maxPlacedPage}>
          <CvPage
            page={pageNum}
            blocks={blocks}
            paddingMm={paddingMm}
            bind:selectedBlockId={selectedBlockId}
            {updateBlockCanvas}
            {updateBlockName}
            {updateBlockImageData}
            {overlappingBlockIds}
            bind:draggedBlockId={draggedBlockId}
            templateName={templateName}
          />
          {#if !isExportMode && pageNum > maxPlacedPage}
            <div class="ghost-page-label">Page {pageNum} (Drop block to add page)</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if !isExportMode && addCanvasElement}
    <ElementsDock
      {addCanvasElement}
      {removeCanvasElement}
      bind:draggedBlockId={draggedBlockId}
      {blocks}
    />
  {/if}
</div>

<style>
  .polished-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: #f1f5f9; /* grey background */
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
  }

  .polished-container.export-mode {
    background-color: #ffffff;
    height: auto;
    overflow: visible;
  }

  /* Fixed Toolbar */
  .canvas-toolbar {
    height: 44px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.09);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background-color: #ffffff;
    user-select: none;
    flex-shrink: 0;
    z-index: 100;
  }

  .toolbar-label {
    font-size: 11px;
    font-weight: 600;
    color: #878682;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .toolbar-controls {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .slider-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-label {
    font-size: 12px;
    font-weight: 500;
    color: #4b5563;
    min-width: 115px;
  }

  .padding-slider {
    width: 100px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: #e2e8f0;
    border-radius: 9999px;
    outline: none;
    cursor: pointer;
  }

  .padding-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #2383e2;
    cursor: pointer;
    border: none;
    transition: transform 0.1s ease;
  }

  .padding-slider::-webkit-slider-thumb:hover {
    transform: scale(1.15);
  }

  .btn-download {
    background-color: #2383e2;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: background-color 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-download:hover:not(:disabled) {
    background-color: #1a6fc2;
  }

  .btn-download:disabled {
    background-color: #94a3b8;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Pages Scroll Area */
  .pages-scroll-area {
    flex-grow: 1;
    overflow-y: auto;
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .pages-scroll-area.export-scroll {
    overflow: visible;
    padding: 0;
    gap: 0;
    background-color: #ffffff;
  }

  /* Unplaced Blocks Banner */
  .unplaced-banner {
    width: 210mm;
    background-color: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #1e3a8a;
    box-sizing: border-box;
  }

  /* Overlap Warning Banner */
  .overlap-banner {
    width: 210mm;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #991b1b;
    box-sizing: border-box;
  }

  .banner-icon {
    font-size: 16px;
  }

  .banner-text {
    font-weight: 500;
  }

  /* Pages List */
  .pages-list {
    display: flex;
    flex-direction: column;
    gap: 15mm; /* 15mm gap between pages */
  }

  .export-scroll .pages-list {
    gap: 0;
  }

  .page-wrapper {
    position: relative;
  }

  .page-wrapper.is-ghost {
    opacity: 0.65;
  }

  .page-wrapper.is-ghost :global(.cv-page) {
    border: 2px dashed #cbd5e1;
    box-shadow: none;
    background-color: rgba(255, 255, 255, 0.4);
  }

  .ghost-page-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: #64748b;
    pointer-events: none;
    text-shadow: 0 1px 2px #ffffff;
  }

  @media print {
    .polished-container {
      background-color: #ffffff !important;
      overflow: visible !important;
      height: auto !important;
    }
    .canvas-toolbar {
      display: none !important;
    }
    .pages-scroll-area {
      padding: 0 !important;
      gap: 0 !important;
      overflow: visible !important;
    }
    .pages-list {
      gap: 0 !important;
    }
    .unplaced-banner,
    .overlap-banner,
    .ghost-page-label {
      display: none !important;
    }
    .page-wrapper.is-ghost {
      display: none !important;
    }
  }
</style>
