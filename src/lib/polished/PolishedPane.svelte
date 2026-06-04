<!-- PolishedPane.svelte -->
<script>
  import ColorPicker from 'svelte-awesome-color-picker';
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
    templateName = 'clean',
    customTemplates = {},
    themeColors = $bindable(),
    onGoToDashboard,
    onChangeTemplate
  } = $props();

  let isDrawerOpen = $state(false);
  let activePicker = $state(null); // 'h1' | 'h2' | 'h3' | 'text' | 'bg'
  let originalStyle = null;

  function openStyleDrawer() {
    originalStyle = JSON.parse(JSON.stringify(themeColors));
    isDrawerOpen = true;
    activePicker = null;
  }

  function saveStyle() {
    originalStyle = null;
    isDrawerOpen = false;
  }

  function discardStyle() {
    if (originalStyle) {
      themeColors.h1Color = originalStyle.h1Color;
      themeColors.h2Color = originalStyle.h2Color;
      themeColors.h3Color = originalStyle.h3Color;
      themeColors.textColor = originalStyle.textColor;
      themeColors.backgroundColor = originalStyle.backgroundColor;
      themeColors.h1Font = originalStyle.h1Font;
      themeColors.h2Font = originalStyle.h2Font;
      themeColors.h3Font = originalStyle.h3Font;
      themeColors.textFont = originalStyle.textFont;
    }
    originalStyle = null;
    isDrawerOpen = false;
  }

  const colorPresets = [
    {
      name: 'Corporate Navy',
      h1Color: '#0a2463',
      h2Color: '#0a2463',
      h3Color: '#1e293b',
      textColor: '#1e1b18',
      backgroundColor: '#ffffff',
      h1Font: 'Inter',
      h2Font: 'Inter',
      h3Font: 'Inter',
      textFont: 'Inter'
    },
    {
      name: 'Modern Bloom',
      h1Color: '#d8315b',
      h2Color: '#d8315b',
      h3Color: '#1e293b',
      textColor: '#1e1b18',
      backgroundColor: '#fbf5f3',
      h1Font: 'Space Grotesk',
      h2Font: 'Space Grotesk',
      h3Font: 'Space Grotesk',
      textFont: 'Space Grotesk'
    },
    {
      name: 'Warm Editorial',
      h1Color: '#006466',
      h2Color: '#006466',
      h3Color: '#212529',
      textColor: '#212529',
      backgroundColor: '#f4efe6',
      h1Font: 'Playfair Display',
      h2Font: 'Playfair Display',
      h3Font: 'Playfair Display',
      textFont: 'Lora'
    },
    {
      name: 'Classic Ink',
      h1Color: '#1b1b1b',
      h2Color: '#1b1b1b',
      h3Color: '#3f3f3f',
      textColor: '#3f3f3f',
      backgroundColor: '#ffffff',
      h1Font: 'Inter',
      h2Font: 'Inter',
      h3Font: 'Inter',
      textFont: 'Inter'
    }
  ];

  let selectedBlockId = $state(null);
  let downloading = $state(false);
  let manualPageCount = $state(1);
  let isMenuOpen = $state(false);

  // Overlap detection (mm-based, covers all block types including gutter)
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);
  let overlappingBlockIds = $derived(findOverlappingIds(blocks, colWidth, paddingMm));
  let overlapCount = $derived(overlappingBlockIds.size);

  // Count unplaced notion blocks (exclude canvas-sourced elements)
  let unplacedCount = $derived(
    blocks.filter(b => b.source !== 'canvas' && b.canvas === null).length
  );

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

  // Total pages = whichever is higher: user-added pages or blocks-derived pages
  let totalPages = $derived(Math.max(manualPageCount, maxPlacedPage));

  function addPage() {
    manualPageCount = totalPages + 1;
  }

  // Pages to render: 1 to totalPages, plus one extra blank page if dragging is active
  let pagesToRender = $derived.by(() => {
    let pages = [];
    for (let p = 1; p <= totalPages; p++) {
      pages.push(p);
    }
    if (draggedBlockId) {
      pages.push(totalPages + 1);
    }
    return pages;
  });

  // Handle global keyboard shortcuts for selection.
  // Guard: only act when focus is NOT inside the Notion pane (contenteditable / inputs).
  function handleKeyDown(e) {
    if (!selectedBlockId) return;

    const active = document.activeElement;
    const isEditingText =
      active &&
      (active.isContentEditable ||
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT');

    if (isEditingText) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      updateBlockCanvas(selectedBlockId, null);
      selectedBlockId = null;
      e.preventDefault();
    } else if (e.key === 'Escape') {
      selectedBlockId = null;
      e.preventDefault();
    }
  }

  // Click outside pages deselects block; also closes hamburger menu
  function handleContainerClick(e) {
    if (!e.target.closest('.canvas-block')) {
      selectedBlockId = null;
    }
    if (!e.target.closest('.hamburger-menu-wrap')) {
      isMenuOpen = false;
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
          paddingMm,
          templateName,
          customTemplates,
          themeColors
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
    <!-- Toolbar -->
    <div class="canvas-toolbar">
      <!-- Left cluster: nav + view label + template -->
      <div class="toolbar-left">
        {#if onGoToDashboard}
          <button type="button" class="btn-goto-dashboard" onclick={onGoToDashboard}>
            ← Dashboard
          </button>
          <div class="toolbar-divider-v"></div>
        {/if}
        <div class="toolbar-label">Polished View</div>
        {#if onChangeTemplate}
          <button type="button" class="btn-change-template" onclick={onChangeTemplate}>
            ⊞ {templateName.charAt(0).toUpperCase() + templateName.slice(1)}
          </button>
        {/if}
      </div>

      <!-- Right: hamburger menu -->
      <div class="hamburger-menu-wrap">
        <button
          type="button"
          class="btn-hamburger"
          class:open={isMenuOpen}
          onclick={(e) => { e.stopPropagation(); isMenuOpen = !isMenuOpen; }}
          aria-label="Canvas options"
        >
          <span class="ham-line"></span>
          <span class="ham-line"></span>
          <span class="ham-line"></span>
        </button>

        {#if isMenuOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ham-dropdown" onclick={(e) => e.stopPropagation()}>

            <!-- Add Page -->
            <div class="ham-section">
              <button type="button" class="ham-btn" onclick={() => { addPage(); isMenuOpen = false; }}>
                + Add Page
              </button>
            </div>

            <div class="ham-divider"></div>

            <!-- 🎨 Style -->
            <div class="ham-section">
              <span class="ham-section-label">Theme</span>
              <button
                type="button"
                class="ham-btn"
                class:active={isDrawerOpen}
                onclick={() => { if (isDrawerOpen) { saveStyle(); } else { openStyleDrawer(); } isMenuOpen = false; }}
              >
                🎨 {isDrawerOpen ? 'Close Style' : 'Style Settings'}
              </button>
            </div>

            <div class="ham-divider"></div>

            <!-- Padding slider -->
            <div class="ham-section">
              <span class="ham-section-label">Page Padding: {paddingMm}mm</span>
              <input
                type="range"
                min="10"
                max="25"
                step="1"
                bind:value={paddingMm}
                class="ham-slider"
              />
            </div>

            <div class="ham-divider"></div>

            <!-- Download PDF -->
            <div class="ham-section">
              <button
                type="button"
                class="ham-btn ham-btn-primary"
                onclick={() => { downloadPdf(); isMenuOpen = false; }}
                disabled={downloading}
              >
                {#if downloading}
                  <span class="spinner"></span> Generating...
                {:else}
                  ↓ Download PDF
                {/if}
              </button>
            </div>

          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if !isExportMode && isDrawerOpen}
    <div class="theme-drawer" onclick={(e) => e.stopPropagation()}>
      <div class="drawer-header">
        <h3>🎨 Style Settings</h3>
        <button type="button" class="btn-close-drawer" onclick={saveStyle}>✕</button>
      </div>
      
      <div class="drawer-content">
        <div class="drawer-section">
          <h4>Presets</h4>
          <div class="presets-grid">
            {#each colorPresets as preset}
              <button
                type="button"
                class="preset-card"
                onclick={() => {
                  themeColors.h1Color = preset.h1Color;
                  themeColors.h2Color = preset.h2Color;
                  themeColors.h3Color = preset.h3Color;
                  themeColors.textColor = preset.textColor;
                  themeColors.backgroundColor = preset.backgroundColor;
                  themeColors.h1Font = preset.h1Font;
                  themeColors.h2Font = preset.h2Font;
                  themeColors.h3Font = preset.h3Font;
                  themeColors.textFont = preset.textFont;
                }}
              >
                <span class="preset-name">{preset.name}</span>
                <div class="preset-swatches">
                  <span class="swatch" style="background-color: {preset.h1Color}; border: 1px solid rgba(0,0,0,0.1);" title="H1 Title"></span>
                  <span class="swatch" style="background-color: {preset.h2Color}; border: 1px solid rgba(0,0,0,0.1);" title="H2 Header"></span>
                  <span class="swatch" style="background-color: {preset.h3Color}; border: 1px solid rgba(0,0,0,0.1);" title="H3 Role"></span>
                  <span class="swatch" style="background-color: {preset.textColor}; border: 1px solid rgba(0,0,0,0.1);" title="Text"></span>
                  <span class="swatch" style="background-color: {preset.backgroundColor}; border: 1px solid rgba(0,0,0,0.1);" title="Background"></span>
                </div>
              </button>
            {/each}
          </div>
        </div>

        <div class="drawer-section">
          <h4>Custom Colors</h4>
          
          <!-- H1 Title -->
          <div class="picker-group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h1' ? null : 'h1')}>
              <span>Name / H1 Title</span>
              <div class="swatch-preview-wrapper">
                <span class="swatch-preview" style="background-color: {themeColors.h1Color}"></span>
                <span class="swatch-hex">{themeColors.h1Color}</span>
              </div>
            </div>
            {#if activePicker === 'h1'}
              <div class="inline-picker-container">
                <div class="inline-color-wrapper">
                  <ColorPicker bind:hex={themeColors.h1Color} isAlpha={false} isDialog={false} />
                </div>
              </div>
            {/if}
          </div>

          <!-- H2 Headers -->
          <div class="picker-group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h2' ? null : 'h2')}>
              <span>Section Header / H2</span>
              <div class="swatch-preview-wrapper">
                <span class="swatch-preview" style="background-color: {themeColors.h2Color}"></span>
                <span class="swatch-hex">{themeColors.h2Color}</span>
              </div>
            </div>
            {#if activePicker === 'h2'}
              <div class="inline-picker-container">
                <div class="inline-color-wrapper">
                  <ColorPicker bind:hex={themeColors.h2Color} isAlpha={false} isDialog={false} />
                </div>
              </div>
            {/if}
          </div>

          <!-- H3 Sub-headers -->
          <div class="picker-group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h3' ? null : 'h3')}>
              <span>Role Title / H3</span>
              <div class="swatch-preview-wrapper">
                <span class="swatch-preview" style="background-color: {themeColors.h3Color}"></span>
                <span class="swatch-hex">{themeColors.h3Color}</span>
              </div>
            </div>
            {#if activePicker === 'h3'}
              <div class="inline-picker-container">
                <div class="inline-color-wrapper">
                  <ColorPicker bind:hex={themeColors.h3Color} isAlpha={false} isDialog={false} />
                </div>
              </div>
            {/if}
          </div>

          <!-- Body Text -->
          <div class="picker-group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="picker-summary" onclick={() => activePicker = (activePicker === 'text' ? null : 'text')}>
              <span>Body Text</span>
              <div class="swatch-preview-wrapper">
                <span class="swatch-preview" style="background-color: {themeColors.textColor}"></span>
                <span class="swatch-hex">{themeColors.textColor}</span>
              </div>
            </div>
            {#if activePicker === 'text'}
              <div class="inline-picker-container">
                <div class="inline-color-wrapper">
                  <ColorPicker bind:hex={themeColors.textColor} isAlpha={false} isDialog={false} />
                </div>
              </div>
            {/if}
          </div>

          <!-- Background -->
          <div class="picker-group">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="picker-summary" onclick={() => activePicker = (activePicker === 'bg' ? null : 'bg')}>
              <span>Paper Background</span>
              <div class="swatch-preview-wrapper">
                <span class="swatch-preview" style="background-color: {themeColors.backgroundColor}"></span>
                <span class="swatch-hex">{themeColors.backgroundColor}</span>
              </div>
            </div>
            {#if activePicker === 'bg'}
              <div class="inline-picker-container">
                <div class="inline-color-wrapper">
                  <ColorPicker bind:hex={themeColors.backgroundColor} isAlpha={false} isDialog={false} />
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="drawer-section">
          <h4>Custom Fonts</h4>
          
          <!-- H1 Font -->
          <div class="font-group">
            <span class="font-label">Name / H1 Title</span>
            <select bind:value={themeColors.h1Font} class="font-select-input">
              <option value="Inter">Inter</option>
              <option value="Lora">Lora</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Space Grotesk">Space Grotesk</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>

          <!-- H2 Font -->
          <div class="font-group">
            <span class="font-label">Section Header / H2</span>
            <select bind:value={themeColors.h2Font} class="font-select-input">
              <option value="Inter">Inter</option>
              <option value="Lora">Lora</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Space Grotesk">Space Grotesk</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>

          <!-- H3 Font -->
          <div class="font-group">
            <span class="font-label">Role Title / H3</span>
            <select bind:value={themeColors.h3Font} class="font-select-input">
              <option value="Inter">Inter</option>
              <option value="Lora">Lora</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Space Grotesk">Space Grotesk</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>

          <!-- Body Text Font -->
          <div class="font-group">
            <span class="font-label">Body Text</span>
            <select bind:value={themeColors.textFont} class="font-select-input">
              <option value="Inter">Inter</option>
              <option value="Lora">Lora</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Space Grotesk">Space Grotesk</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>
        </div>
      </div>

      <div class="drawer-actions">
        <button type="button" class="btn-save-style" onclick={saveStyle}>Save & Apply</button>
        <button type="button" class="btn-discard-style" onclick={discardStyle}>Discard</button>
      </div>
    </div>
  {/if}

  <!-- Scroll area for A4 pages -->
  <div class="pages-scroll-area" class:export-scroll={isExportMode}>

    {#if !isExportMode && overlapCount > 0}
      <div class="overlap-banner">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">{overlapCount} block{overlapCount > 1 ? 's' : ''} overlapping — move or resize the highlighted blocks to fix.</span>
      </div>
    {/if}

    <div class="pages-list">
      {#each pagesToRender as pageNum}
        <div class="page-wrapper" class:is-ghost={pageNum > totalPages}>
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
          {#if !isExportMode && pageNum > totalPages}
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

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toolbar-label {
    font-size: 11px;
    font-weight: 600;
    color: #878682;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .btn-change-template {
    font-size: 11px;
    font-weight: 500;
    color: #4b5563;
    background: rgba(55, 53, 47, 0.06);
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 5px;
    padding: 3px 8px;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .btn-change-template:hover {
    background-color: rgba(35, 131, 226, 0.1);
    color: #2383e2;
    border-color: rgba(35, 131, 226, 0.25);
  }

  /* Hamburger menu */
  .hamburger-menu-wrap {
    position: relative;
  }

  .btn-hamburger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 4px;
    width: 32px;
    height: 32px;
    background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.14);
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    transition: background-color 0.15s, border-color 0.15s;
  }

  .btn-hamburger:hover,
  .btn-hamburger.open {
    background-color: rgba(55, 53, 47, 0.06);
    border-color: rgba(55, 53, 47, 0.22);
  }

  .ham-line {
    display: block;
    width: 14px;
    height: 1.5px;
    background-color: #374151;
    border-radius: 1px;
    transition: background-color 0.15s;
  }

  .btn-hamburger.open .ham-line {
    background-color: #2383e2;
  }

  /* Dropdown panel */
  .ham-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 230px;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(10, 36, 99, 0.12), 0 2px 6px rgba(0,0,0,0.06);
    z-index: 500;
    overflow: hidden;
    animation: ham-in 0.12s ease-out;
  }

  @keyframes ham-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1); }
  }

  .ham-section {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ham-section-label {
    font-size: 10px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .ham-divider {
    height: 1px;
    background-color: rgba(55, 53, 47, 0.07);
    margin: 0;
  }

  .ham-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    font-weight: 500;
    color: #374151;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ham-btn:hover {
    background-color: rgba(35, 131, 226, 0.07);
    border-color: rgba(35, 131, 226, 0.25);
    color: #2383e2;
  }

  .ham-btn.active {
    background-color: rgba(35, 131, 226, 0.1);
    border-color: rgba(35, 131, 226, 0.3);
    color: #2383e2;
  }

  .ham-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ham-btn-primary {
    background-color: #2383e2;
    border-color: #2383e2;
    color: #ffffff;
    font-weight: 600;
  }

  .ham-btn-primary:hover {
    background-color: #1a6fc2;
    border-color: #1a6fc2;
    color: #ffffff;
  }

  .ham-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: #e2e8f0;
    border-radius: 9999px;
    outline: none;
    cursor: pointer;
  }

  .ham-slider::-webkit-slider-thumb {
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

  .ham-slider::-webkit-slider-thumb:hover {
    transform: scale(1.15);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    flex-shrink: 0;
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

  .btn-goto-dashboard {
    font-size: 11px;
    font-weight: 600;
    color: #2383e2;
    background: transparent;
    border: none;
    border-radius: 5px;
    padding: 3px 8px;
    cursor: pointer;
    transition: background-color 0.15s;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .btn-goto-dashboard:hover {
    background-color: rgba(35, 131, 226, 0.08);
  }

  .toolbar-divider-v {
    width: 1px;
    height: 16px;
    background-color: rgba(55, 53, 47, 0.12);
    margin: 0 4px;
  }

  /* Theme Drawer Styles */
  .theme-drawer {
    position: absolute;
    top: 44px; /* below toolbar */
    right: 0;
    bottom: 0;
    width: 280px;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border-left: 1px solid rgba(55, 53, 47, 0.12);
    box-shadow: -4px 0 24px rgba(10, 36, 99, 0.08);
    display: flex;
    flex-direction: column;
    padding: 20px;
    z-index: 500;
    font-family: var(--font-sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    animation: slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    box-sizing: border-box;
  }

  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.08);
    padding-bottom: 10px;
    flex-shrink: 0;
  }

  .drawer-header h3 {
    font-size: 15px;
    font-weight: 700;
    color: #0a2463;
    margin: 0;
  }

  .btn-close-drawer {
    background: transparent;
    border: none;
    font-size: 14px;
    color: #878682;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.15s;
  }

  .btn-close-drawer:hover {
    background-color: rgba(55, 53, 47, 0.06);
    color: #1e1b18;
  }

  .drawer-content {
    flex-grow: 1;
    overflow-y: auto;
    margin-bottom: 16px;
    padding-right: 4px;
    box-sizing: border-box;
  }

  .drawer-content::-webkit-scrollbar {
    width: 4px;
  }
  .drawer-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .drawer-content::-webkit-scrollbar-thumb {
    background: rgba(55, 53, 47, 0.15);
    border-radius: 2px;
  }
  .drawer-content::-webkit-scrollbar-thumb:hover {
    background: rgba(55, 53, 47, 0.3);
  }

  .drawer-section {
    margin-bottom: 24px;
  }

  .drawer-section h4 {
    font-size: 11px;
    font-weight: 600;
    color: #878682;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    margin: 0 0 12px;
  }

  .presets-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .preset-card {
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s, box-shadow 0.15s;
    box-sizing: border-box;
  }

  .preset-card:hover {
    border-color: #2383e2;
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.06);
  }

  .preset-name {
    font-size: 11px;
    font-weight: 600;
    color: #1e1b18;
  }

  .preset-swatches {
    display: flex;
    gap: 4px;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
  }

  .picker-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .picker-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
    user-select: none;
    box-sizing: border-box;
  }

  .picker-summary:hover {
    border-color: #2383e2;
    background-color: rgba(35, 131, 226, 0.02);
  }

  .picker-summary span {
    font-size: 12px;
    font-weight: 500;
    color: #4b5563;
    cursor: pointer;
  }

  .swatch-preview-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swatch-preview {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    display: inline-block;
  }

  .swatch-hex {
    font-family: monospace;
    font-size: 11px;
    color: #6b7280;
  }

  .inline-picker-container {
    margin-top: 6px;
    padding: 10px;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 6px;
    display: flex;
    justify-content: center;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
    box-sizing: border-box;
  }

  .inline-color-wrapper {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .font-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .font-label {
    font-size: 11px;
    font-weight: 600;
    color: #4b5563;
  }

  .font-select-input {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    color: #1e1b18;
    background-color: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.16);
    border-radius: 5px;
    outline: none;
    cursor: pointer;
    box-sizing: border-box;
    font-family: var(--font-sans);
  }

  .font-select-input:hover {
    border-color: #2383e2;
  }

  .font-select-input:focus {
    border-color: #2383e2;
    box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.15);
  }

  .inline-picker-container :global(.kl-color-picker) {
    margin: 0 auto;
    max-width: 100%;
    box-shadow: none !important;
    border: none !important;
    background: transparent !important;
  }

  .drawer-actions {
    margin-top: auto;
    display: flex;
    gap: 10px;
    border-top: 1px solid rgba(55, 53, 47, 0.08);
    padding-top: 16px;
    flex-shrink: 0;
  }

  .btn-save-style {
    flex: 1;
    background-color: #2383e2;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
    text-align: center;
  }

  .btn-save-style:hover {
    background-color: #1a6fc2;
  }

  .btn-discard-style {
    background-color: transparent;
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
  }

  .btn-discard-style:hover {
    background-color: rgba(239, 68, 68, 0.05);
    border-color: #ef4444;
  }


  @media print {
    .theme-drawer {
      display: none !important;
    }
  }
</style>
