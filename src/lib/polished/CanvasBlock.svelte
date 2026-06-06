<!-- CanvasBlock.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import BlockRenderer from './BlockRenderer.svelte';
  import { anyOverlap } from './canvasUtils.js';
  import { computeLayout, blockRectMm, renderBlockSVG, initFonts, fontsReady } from '../layout/index.js';

  let {
    block,
    blocks,
    paddingMm,
    selected = false,
    selectedBlockIds = [],
    showToolbar = true,
    isOverlapping = false,
    onSelect,
    updateBlockCanvas,
    updateBlockName,
    updateBlockImageData = null,
    removeCanvasElement = null,
    draggedBlockId = $bindable(),
    templateName = 'clean',
    themeColors = {},
    onAskAI = null,
    toggleBlockLock = null
  } = $props();

  let isCanvasElement = $derived(block?.source === 'canvas');
  let isGutterElement = $derived(block?.type === 'vertical_divider' && block?.canvas?.colSpan === 0);
  let isDivider = $derived(block?.type === 'horizontal_divider' || block?.type === 'vertical_divider');

  const PX_PER_MM = 96 / 25.4;

  // Guard computeLayout: the font registry must be populated before layout runs.
  // fontsReady is a plain boolean; we mirror it into a local $state so Svelte
  // re-runs the $derived below once initFonts() completes.
  let fontsDone = $state(fontsReady);
  onMount(() => { initFonts().then(() => { fontsDone = true; }); });

  let isDraggingThis = $state(false);
  let resizeState = $state(null);
  let nameError = $state('');

  // Column width calculation
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);

  // Dimensions — gutter elements use col as gutter index, colSpan === 0
  let leftMm = $derived(
    block.canvas
      ? (isGutterElement
          ? paddingMm + block.canvas.col * (colWidth + 4) + colWidth
          : paddingMm + block.canvas.col * (colWidth + 4))
      : 0
  );
  let topMm    = $derived(block.canvas ? paddingMm + block.canvas.row * 5 : 0);
  let widthMm  = $derived(
    block.canvas
      ? (isGutterElement ? 4 : block.canvas.colSpan * colWidth + (block.canvas.colSpan - 1) * 4)
      : 0
  );
  let heightMm = $derived(block.canvas ? block.canvas.rowSpan * 5 : 0);

  // Layout engine: compute deterministic layout for text blocks.
  // Gated on fontsDone so we never call computeLayout before initFonts() resolves —
  // getFont() throws if the registry is empty (intentional guard against misuse).
  let blockLayout = $derived(
    fontsDone && block.canvas && !isCanvasElement
      ? computeLayout(block, blockRectMm(block.canvas, paddingMm), {
          templateName,
          paddingMm,
          themeColors,
        })
      : null
  );
  let svgContent = $derived(
    blockLayout && blockLayout.kind === 'text'
      ? renderBlockSVG(blockLayout, { glyphMode: 'text' })
      : null
  );
  // Use layout engine overflow (same authority as agent measurement)
  let overflowing = $derived(blockLayout ? blockLayout.overflow : false);

  function handleCanvasNameInput(e) {
    const val = e.target.value;
    const trimmed = val.trim();
    if (trimmed === '') {
      nameError = '';
      updateBlockName(block.id, null);
      return;
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
      nameError = 'Letters, numbers, dash, underscore only';
      return;
    }
    const isDuplicate = blocks.some(b => b.id !== block.id && b.name && b.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      nameError = 'Name must be unique';
    } else {
      nameError = '';
      updateBlockName(block.id, trimmed);
    }
  }

  // Overflow is now derived from layout engine (blockLayout.overflow)
  // No browser ResizeObserver needed — same authority as agent measurement

  function handleCanvasDragStart(e) {
    if (block.locked) {
      e.preventDefault();
      return;
    }
    isDraggingThis = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', block.id);
    draggedBlockId = block.id;
  }

  function handleCanvasDragEnd() {
    isDraggingThis = false;
    draggedBlockId = null;
  }

  function handleResizeStart(handle, event) {
    event.stopPropagation();
    event.preventDefault();
    if (block.locked) return;

    const originalCanvas = { ...block.canvas };
    const pageElement = event.currentTarget.closest('.cv-page-container');
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();

    resizeState = {
      handle,
      original: originalCanvas,
      current: { ...originalCanvas },
      isValid: true
    };

    function handlePointerMove(e) {
      if (!resizeState) return;

      const pxX = e.clientX - pageRect.left;
      const pxY = e.clientY - pageRect.top;

      const colWidthVal = (210 - 2 * paddingMm - 12) / 4;
      const mmX = pxX / PX_PER_MM;
      const mmY = pxY / PX_PER_MM;
      const contentX = mmX - paddingMm;
      const contentY = mmY - paddingMm;

      let newCol     = resizeState.original.col;
      let newRow     = resizeState.original.row;
      let newColSpan = resizeState.original.colSpan;
      let newRowSpan = resizeState.original.rowSpan;

      const rightEdge  = resizeState.original.col + resizeState.original.colSpan;
      const bottomEdge = resizeState.original.row + resizeState.original.rowSpan;

      // Skip horizontal resizing for gutter elements (colSpan === 0)
      if (newColSpan !== 0) {
        if (handle.includes('r')) {
          let bestCol = 0, minDiff = Infinity;
          for (let c = 0; c < 4; c++) {
            const edge = (c + 1) * colWidthVal + c * 4;
            const diff = Math.abs(contentX - edge);
            if (diff < minDiff) { minDiff = diff; bestCol = c; }
          }
          newColSpan = Math.max(1, bestCol - resizeState.original.col + 1);
          if (newCol + newColSpan > 4) newColSpan = 4 - newCol;
        }
        if (handle.includes('l')) {
          let bestCol = 0, minDiff = Infinity;
          for (let c = 0; c < 4; c++) {
            const edge = c * (colWidthVal + 4);
            const diff = Math.abs(contentX - edge);
            if (diff < minDiff) { minDiff = diff; bestCol = c; }
          }
          newCol = Math.max(0, Math.min(rightEdge - 1, bestCol));
          newColSpan = rightEdge - newCol;
        }
      }

      if (handle.includes('b')) {
        let bestRow = 0, minDiff = Infinity;
        for (let r = 0; r < 53; r++) {
          const edge = (r + 1) * 5;
          const diff = Math.abs(contentY - edge);
          if (diff < minDiff) { minDiff = diff; bestRow = r; }
        }
        newRowSpan = Math.max(1, bestRow - resizeState.original.row + 1);
        if (newRow + newRowSpan > 53) newRowSpan = 53 - newRow;
      }
      if (handle.includes('t')) {
        let bestRow = 0, minDiff = Infinity;
        for (let r = 0; r < 53; r++) {
          const edge = r * 5;
          const diff = Math.abs(contentY - edge);
          if (diff < minDiff) { minDiff = diff; bestRow = r; }
        }
        newRow = Math.max(0, Math.min(bottomEdge - 1, bestRow));
        newRowSpan = bottomEdge - newRow;
      }

      const candidateCanvas = { page: block.canvas.page, col: newCol, row: newRow, colSpan: newColSpan, rowSpan: newRowSpan };
      const collides = anyOverlap(blocks, block.id, block.canvas.page, candidateCanvas, colWidth, paddingMm);
      const isValid  = !collides &&
                       (newColSpan === 0 || (newCol + newColSpan <= 4)) &&
                       (newRow + newRowSpan <= 53);

      resizeState.current = candidateCanvas;
      resizeState.isValid = isValid;
      updateBlockCanvas(block.id, resizeState.current);
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (resizeState) {
        if (resizeState.isValid) {
          updateBlockCanvas(block.id, resizeState.current);
        } else {
          updateBlockCanvas(block.id, resizeState.original);
        }
      }
      resizeState = null;
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handleBlockClick(e) {
    e.stopPropagation();
    onSelect(block.id, e.ctrlKey || e.metaKey || e.shiftKey);
  }

  function handleBlockKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onSelect(block.id, e.ctrlKey || e.metaKey || e.shiftKey);
    }
  }

  function handleDeleteClick(e) {
    e.stopPropagation();
    if (block.locked) return;
    if (selected && selectedBlockIds.length > 1) {
      selectedBlockIds.forEach(id => {
        const b = blocks.find(x => x.id === id);
        if (b) {
          if (b.source === 'canvas' && removeCanvasElement) {
            removeCanvasElement(b.id);
          } else {
            updateBlockCanvas(b.id, null);
          }
        }
      });
    } else {
      if (block.source === 'canvas' && removeCanvasElement) {
        removeCanvasElement(block.id);
      } else {
        updateBlockCanvas(block.id, null);
      }
    }
  }

  function setAlignment(align) {
    updateBlockCanvas(block.id, { align });
  }

  function setBarStyle(style) {
    updateBlockCanvas(block.id, { barStyle: style });
  }

  function setBarColor(e) {
    updateBlockCanvas(block.id, { barColor: e.target.value });
  }

  // Headshot image upload
  let imageInput = $state(null);
  function handleUploadClick(e) {
    e.stopPropagation();
    imageInput?.click();
  }
  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200_000) {
      alert('Image must be under 200 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      // The PDF exporter (pdf-lib) only embeds PNG/JPEG. Browsers happily produce
      // webp/avif/etc., which would render on screen but silently drop from the PDF.
      // Normalize anything that isn't PNG/JPEG to PNG so screen and print stay in sync.
      if (file.type === 'image/png' || file.type === 'image/jpeg') {
        if (updateBlockImageData) updateBlockImageData(block.id, dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        // Cap dimensions: a small webp decodes lossless to a much larger PNG, and a
        // headshot never needs more than ~1200px. Keeps the exported PDF lean.
        const MAX_W = 1200;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX_W) { h = Math.round((h * MAX_W) / w); w = MAX_W; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        if (updateBlockImageData) updateBlockImageData(block.id, canvas.toDataURL('image/png'));
      };
      img.onerror = () => { if (updateBlockImageData) updateBlockImageData(block.id, dataUrl); };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }
</script>

<!-- Outer Block Wrapper -->
<div
  class="canvas-block"
  class:selected={selected}
  class:overflowing={overflowing}
  class:is-dragging={isDraggingThis}
  class:resize-invalid={resizeState && !resizeState.isValid}
  class:gutter-element={isGutterElement}
  class:is-overlapping={isOverlapping}
  class:is-locked={block.locked}
  style="left:{leftMm}mm;top:{topMm}mm;width:{widthMm}mm;height:{heightMm}mm;"
  onclick={handleBlockClick}
  onkeydown={handleBlockKeydown}
  data-block-id={block.id}
  role="button"
  tabindex="0"
>
  <!-- Floating Action Toolbar -->
  {#if selected && showToolbar}
    <div
      class="floating-toolbar"
      contenteditable="false"
      role="toolbar"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if block.locked}
        <button type="button" class="toolbar-unlock-btn" onclick={() => toggleBlockLock(block.id)}>
          🔓 Unlock Block
        </button>
      {:else}
      <div
        class="toolbar-drag-handle"
        draggable="true"
        role="button"
        tabindex="0"
        ondragstart={handleCanvasDragStart}
        ondragend={handleCanvasDragEnd}
      >
        <span class="icon">⠿</span> Move
      </div>
      {/if}

      {#if selectedBlockIds.length === 1}
        <div class="toolbar-divider"></div>

        {#if !block.locked}
        <button type="button" class="toolbar-lock-btn" onclick={() => toggleBlockLock(block.id)} title="Lock block layout &amp; edits">
          🔒 Lock
        </button>
        <div class="toolbar-divider"></div>
        {/if}

        {#if !block.locked && isDivider}
          <!-- Divider style controls -->
          {#each [
            { value: 'solid',  label: '—',   title: 'Solid' },
            { value: 'dashed', label: '╌',   title: 'Dashed' },
            { value: 'dotted', label: '·····', title: 'Dotted' },
            { value: 'double', label: '═',   title: 'Double' }
          ] as s}
            <button
              type="button"
              class="toolbar-bar-style-btn"
              class:active={(block.canvas?.barStyle ?? 'solid') === s.value}
              onclick={() => setBarStyle(s.value)}
              title={s.title}
            >{s.label}</button>
          {/each}
          <div class="toolbar-divider"></div>
          <div class="toolbar-color-wrap" title="Line color">
            <input
              type="color"
              class="toolbar-bar-color"
              value={block.canvas?.barColor ?? '#1e293b'}
              oninput={setBarColor}
              onchange={setBarColor}
            />
            <span class="toolbar-color-indicator" style="background:{block.canvas?.barColor ?? '#1e293b'};"></span>
          </div>
        {/if}

        {#if !block.locked && isCanvasElement && block.elementType === 'headshot'}
          <button type="button" class="toolbar-upload-btn" onclick={handleUploadClick}>
            📷 {block.imageData ? 'Replace' : 'Upload'}
          </button>
          <input type="file" accept="image/*" style="display:none;" bind:this={imageInput} onchange={handleImageChange} />
        {/if}

        {#if !block.locked && !isCanvasElement}
          <button
            type="button"
            class="toolbar-align-btn"
            class:active={(block.canvas?.align || 'left') === 'left'}
            onclick={() => setAlignment('left')}
            title="Align Left"
          >
            <svg class="align-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h8a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h8a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1z"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-align-btn"
            class:active={block.canvas?.align === 'center'}
            onclick={() => setAlignment('center')}
            title="Align Center"
          >
            <svg class="align-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm2 3h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1 0-1zm-2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm2 3h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1 0-1z"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-align-btn"
            class:active={block.canvas?.align === 'right'}
            onclick={() => setAlignment('right')}
            title="Align Right"
          >
            <svg class="align-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm4 3h8a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zm-4 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm4 3h8a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1z"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-align-btn"
            class:active={block.canvas?.align === 'justify'}
            onclick={() => setAlignment('justify')}
            title="Justify"
          >
            <svg class="align-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1zm0 3h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1 0-1z"/>
            </svg>
          </button>
          <div class="toolbar-divider"></div>
          <div class="toolbar-name-group">
            <span class="toolbar-name-symbol">@</span>
            <input
              type="text"
              class="toolbar-name-input"
              class:invalid={nameError}
              placeholder="Name..."
              value={block.name || ''}
              oninput={handleCanvasNameInput}
              title={nameError || 'Assign unique block name'}
            />
          </div>
        {/if}
      {/if}

      <div class="toolbar-divider"></div>
      <button 
        type="button" 
        class="toolbar-chat-btn" 
        onclick={(e) => { e.stopPropagation(); onAskAI?.(selectedBlockIds); }}
        title="Chat with AI about selected blocks"
      >
        💬 Chat with AI
      </button>
      {#if !block.locked}
      <div class="toolbar-divider"></div>
      <button type="button" class="toolbar-delete-btn" onclick={handleDeleteClick}>Delete</button>
      {/if}
    </div>
  {/if}

  <!-- Hover drag handle -->
  {#if !selected && !block.locked}
    <div
      class="hover-drag-handle"
      draggable="true"
      ondragstart={handleCanvasDragStart}
      ondragend={handleCanvasDragEnd}
      contenteditable="false"
      role="button"
      tabindex="-1"
      aria-label="Drag to move block"
      title="Drag to move"
    >⠿</div>
  {/if}

  <!-- Lock indicator badge -->
  {#if block.locked}
    <div class="lock-indicator-badge" title="This block is locked">🔒</div>
  {/if}

  <!-- Content -->
  <div
    class="block-content-container block-type-{block.type}"
    class:canvas-element={isCanvasElement}
  >
    {#if isCanvasElement}
      <BlockRenderer content={block.content} block={block} />
    {:else if svgContent}
      {@html svgContent}
    {/if}
    <!-- No legacy BlockRenderer fallback for text: it shapes with the browser +
         template CSS (different metrics), so it would flash a mismatched layout
         before fonts load, then snap to the SVG. The engine SVG is the sole text
         authority; render nothing until it's ready (fontsDone is near-instant). -->

  </div>

  <!-- Resize handles — gutter elements: vertical only; canvas elements: no horizontal -->
  {#if selected && selectedBlockIds.length === 1 && !block.locked}
    {#if isGutterElement}
      <div class="resize-handle t" role="presentation" onpointerdown={(e) => handleResizeStart('t', e)}></div>
      <div class="resize-handle b" role="presentation" onpointerdown={(e) => handleResizeStart('b', e)}></div>
    {:else}
      <div class="resize-handle tl" role="presentation" onpointerdown={(e) => handleResizeStart('tl', e)}></div>
      <div class="resize-handle t"  role="presentation" onpointerdown={(e) => handleResizeStart('t', e)}></div>
      <div class="resize-handle tr" role="presentation" onpointerdown={(e) => handleResizeStart('tr', e)}></div>
      <div class="resize-handle r"  role="presentation" onpointerdown={(e) => handleResizeStart('r', e)}></div>
      <div class="resize-handle br" role="presentation" onpointerdown={(e) => handleResizeStart('br', e)}></div>
      <div class="resize-handle b"  role="presentation" onpointerdown={(e) => handleResizeStart('b', e)}></div>
      <div class="resize-handle bl" role="presentation" onpointerdown={(e) => handleResizeStart('bl', e)}></div>
      <div class="resize-handle l"  role="presentation" onpointerdown={(e) => handleResizeStart('l', e)}></div>
    {/if}
  {/if}
</div>

<style>
  .canvas-block {
    position: absolute;
    box-sizing: border-box;
    overflow: visible;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.15s ease-out;
    background-color: var(--cv-bg-color, #ffffff);
    z-index: 5;
  }

  .canvas-block.selected { z-index: 200; }
  .canvas-block.is-dragging { opacity: 0.4; }

  .canvas-block.selected {
    outline: 1.5px solid var(--color-imperial-blue);
  }

  .canvas-block.overflowing,
  .canvas-block.selected.overflowing {
    outline: 1.5px solid var(--color-magenta-bloom);
  }

  .canvas-block.resize-invalid {
    outline: 1.5px solid var(--color-magenta-bloom) !important;
    background-color: rgba(216, 49, 91, 0.05);
  }

  /* Gutter elements sit in the 4mm gap — no background */
  .canvas-block.gutter-element {
    background-color: transparent;
  }

  /* Overlap warning — pulsing red */
  .canvas-block.is-overlapping {
    outline: 2px solid #ef4444;
    animation: overlap-pulse 1.5s ease-in-out infinite;
  }
  .canvas-block.is-overlapping.gutter-element {
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
  }
  @keyframes overlap-pulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3); }
    50%       { box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
  }

  .canvas-block.is-locked {
    outline-color: rgba(148, 163, 184, 0.4) !important;
  }
  .canvas-block.is-locked.selected {
    outline: 1.5px dashed var(--color-blue-bell) !important;
  }

  .lock-indicator-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    background-color: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 4px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .toolbar-unlock-btn {
    border: none;
    background: transparent;
    color: #38bdf8;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
  }
  .toolbar-unlock-btn:hover {
    background-color: rgba(56, 189, 248, 0.15);
  }

  .toolbar-lock-btn {
    border: none;
    background: transparent;
    color: var(--color-blue-bell);
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
  }
  .toolbar-lock-btn:hover {
    background-color: rgba(144, 174, 173, 0.2);
  }

  .block-content-container {
    width: 100%;
    height: 100%;
    overflow: visible;
    word-break: break-word;
    /* The layout engine (SVG/PDF) is the sole visual authority. The wrapper must
       never contribute its own box model — a border/padding/background here would
       appear on screen but not in the engine-rendered PDF. The `tmpl-*` class is
       deliberately NOT applied to this wrapper (only `block-type-*`), so template
       CSS like `.tmpl-modern.block-type-h2 { border-left; padding-left }` can't
       match it and double-draw the H2 accent bar or shift the SVG right. The resets
       below are a belt-and-suspenders guard against any future single-class leak. */
    border: 0;
    padding: 0;
    background: transparent;
  }

  .block-content-container.canvas-element {
    overflow: hidden;
  }

  /* Hover Drag Handle */
  .hover-drag-handle {
    position: absolute;
    top: -6px;
    left: -20px;
    width: 16px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-ghost-white);
    border: 1px solid var(--outline-subtle);
    box-shadow: 0 1px 4px rgba(10, 36, 99, 0.05);
    border-radius: var(--radius-sm);
    color: var(--color-imperial-blue);
    font-size: 11px;
    cursor: grab;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 50;
  }

  .canvas-block:hover .hover-drag-handle { opacity: 1; }

  /* Resize Handles */
  .resize-handle {
    position: absolute;
    width: 8px;
    height: 8px;
    background-color: var(--color-imperial-blue);
    border: 1px solid var(--color-ghost-white);
    border-radius: 1px;
    z-index: 100;
  }

  /* Expand hit target area to 20px for easier hovering/dragging */
  .resize-handle::after {
    content: '';
    position: absolute;
    top: -6px;
    left: -6px;
    width: 20px;
    height: 20px;
    background: transparent;
    z-index: 101;
  }

  .tl { top: -4px; left: -4px; cursor: nwse-resize; }
  .t  { top: -4px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
  .tr { top: -4px; right: -4px; cursor: nesw-resize; }
  .r  { top: 50%; right: -4px; transform: translateY(-50%); cursor: ew-resize; }
  .br { bottom: -4px; right: -4px; cursor: nwse-resize; }
  .b  { bottom: -4px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
  .bl { bottom: -4px; left: -4px; cursor: nesw-resize; }
  .l  { top: 50%; left: -4px; transform: translateY(-50%); cursor: ew-resize; }

  /* Floating Action Toolbar */
  .floating-toolbar {
    position: absolute;
    top: -36px;
    left: 0;
    height: 28px;
    background-color: var(--color-imperial-blue);
    color: #ffffff;
    border-radius: var(--radius-default);
    box-shadow: var(--shadow-ambient);
    display: flex;
    align-items: center;
    padding: 0 8px;
    z-index: 110;
    font-family: var(--font-sans);
    font-size: 12px;
    pointer-events: auto;
    white-space: nowrap;
  }

  .toolbar-drag-handle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: grab;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    user-select: none;
    font-weight: 600;
  }

  .toolbar-drag-handle:hover { background-color: rgba(255,255,255,0.15); }

  .toolbar-divider {
    width: 1px;
    height: 14px;
    background-color: rgba(255,255,255,0.25);
    margin: 0 6px;
  }

  .toolbar-chat-btn {
    border: none;
    background: transparent;
    color: #a7f3d0;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
  }

  .toolbar-chat-btn:hover {
    background-color: rgba(16, 185, 129, 0.2);
    color: #ffffff;
  }

  .toolbar-delete-btn {
    border: none;
    background: transparent;
    color: #fca5a5;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
  }

  .toolbar-delete-btn:hover { background-color: rgba(239,68,68,0.2); color: #fee2e2; }

  /* Divider style buttons */
  .toolbar-bar-style-btn {
    border: none;
    background: transparent;
    color: #cbd5e1;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -1px;
    line-height: 1;
    transition: background-color 0.12s, color 0.12s;
    min-width: 22px;
    text-align: center;
  }
  .toolbar-bar-style-btn:hover { background-color: rgba(255,255,255,0.15); color: #ffffff; }
  .toolbar-bar-style-btn.active { background-color: rgba(255,255,255,0.25); color: #ffffff; }

  /* Color picker swatch */
  .toolbar-color-wrap {
    position: relative;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .toolbar-color-wrap:hover { background-color: rgba(255,255,255,0.15); }
  .toolbar-bar-color {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }
  .toolbar-color-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.5);
    flex-shrink: 0;
    pointer-events: none;
  }

  .toolbar-upload-btn {
    border: none;
    background: transparent;
    color: #a78bfa;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    white-space: nowrap;
  }
  .toolbar-upload-btn:hover { background-color: rgba(167,139,250,0.15); }

  /* Inline @name input */
  .toolbar-name-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background-color: rgba(255,255,255,0.08);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
  }
  .toolbar-name-symbol {
    color: #10b981;
    font-weight: 700;
    font-size: 11px;
  }
  .toolbar-name-input {
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 11px;
    outline: none;
    width: 60px;
    font-family: inherit;
    padding: 0;
  }
  .toolbar-name-input::placeholder { color: rgba(255,255,255,0.4); }
  .toolbar-name-input.invalid { color: #ff5c5c; }
  .toolbar-name-group:has(.toolbar-name-input.invalid) { border-color: #ff5c5c; }

  .toolbar-align-btn {
    border: none;
    background: transparent;
    color: #cbd5e1;
    cursor: pointer;
    padding: 4px;
    margin: 0 2px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, color 0.15s;
  }

  .toolbar-align-btn:hover { background-color: rgba(255,255,255,0.15); color: #ffffff; }
  .toolbar-align-btn.active { background-color: rgba(255,255,255,0.25); color: var(--color-magenta-bloom); }

  .align-icon { width: 14px; height: 14px; }

  @media print {
    .canvas-block { outline: none !important; background-color: transparent !important; }
    .resize-handle, .floating-toolbar, .hover-drag-handle { display: none !important; }
  }
</style>
