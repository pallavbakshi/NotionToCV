<!-- CanvasBlock.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import BlockRenderer from './BlockRenderer.svelte';
  import { anyOverlap } from './canvasUtils.js';

  let {
    block,
    blocks,
    paddingMm,
    selected = false,
    isOverlapping = false,
    onSelect,
    updateBlockCanvas,
    updateBlockName,
    updateBlockImageData = null,
    draggedBlockId = $bindable(),
    templateName = 'clean'
  } = $props();

  let isCanvasElement = $derived(block?.source === 'canvas');
  let isGutterElement = $derived(block?.type === 'vertical_divider' && block?.canvas?.colSpan === 0);

  const PX_PER_MM = 96 / 25.4;

  let contentEl = $state(null);
  let overflowing = $state(false);
  let resizeObserver;
  let isDraggingThis = $state(false);

  // Live resizing state
  let resizeState = $state(null);
  let nameError = $state('');

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

  // Column width calculation
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);

  // Dimensions based on canvas coordinates (gutter-aware)
  let leftMm = $derived(
    block.canvas
      ? (isGutterElement
          ? paddingMm + block.canvas.col * (colWidth + 4) + colWidth  // gutter start
          : paddingMm + block.canvas.col * (colWidth + 4))            // column start
      : 0
  );
  let topMm = $derived(block.canvas ? paddingMm + block.canvas.row * 5 : 0);
  let widthMm = $derived(
    block.canvas
      ? (isGutterElement
          ? 4                                                          // gutter = 4mm
          : block.canvas.colSpan * colWidth + (block.canvas.colSpan - 1) * 4)
      : 0
  );
  let heightMm = $derived(block.canvas ? block.canvas.rowSpan * 5 : 0);

  function pxToGrid(pxX, pxY, paddingMm) {
    const mmX = pxX / PX_PER_MM;
    const mmY = pxY / PX_PER_MM;
    const contentX = mmX - paddingMm;
    const contentY = mmY - paddingMm;
    const colWidthVal = (210 - 2 * paddingMm - 12) / 4;

    const col = Math.max(0, Math.min(3, Math.round(contentX / (colWidthVal + 4))));
    const row = Math.max(0, Math.min(52, Math.round(contentY / 5)));
    return { col, row };
  }

  // Unified collision — using anyOverlap from canvasUtils.js (no separate functions needed)

  // Check content overflow
  function checkOverflow() {
    if (!contentEl || !block.canvas) return;
    const allocatedHeightPx = block.canvas.rowSpan * 5 * PX_PER_MM;
    // Add 1px tolerance for rounding
    overflowing = contentEl.scrollHeight > (allocatedHeightPx + 1);
  }

  $effect(() => {
    if (contentEl) {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(() => {
        checkOverflow();
      });
      resizeObserver.observe(contentEl);
    }
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
    };
  });

  // Re-check overflow whenever rowSpan or content changes
  $effect(() => {
    if (block.canvas) {
      block.canvas.rowSpan;
      block.content;
      checkOverflow();
    }
  });

  // HTML5 Drag-Move Event Handlers
  function handleCanvasDragStart(e) {
    isDraggingThis = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', block.id);
    draggedBlockId = block.id;
  }

  function handleCanvasDragEnd() {
    isDraggingThis = false;
    draggedBlockId = null;
  }

  // Pointer-based Resizing
  function handleResizeStart(handle, event) {
    event.stopPropagation();
    event.preventDefault();

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

      let newCol = resizeState.original.col;
      let newRow = resizeState.original.row;
      let newColSpan = resizeState.original.colSpan;
      let newRowSpan = resizeState.original.rowSpan;

      const rightEdge = resizeState.original.col + resizeState.original.colSpan;
      const bottomEdge = resizeState.original.row + resizeState.original.rowSpan;

      // Skip horizontal resizing entirely for gutter elements
      if (newColSpan !== 0) {
        // High-precision column snapping for resizing
        if (handle.includes('r')) {
          let bestCol = 0;
          let minDiff = Infinity;
          for (let c = 0; c < 4; c++) {
            const edge = (c + 1) * colWidthVal + c * 4;
            const diff = Math.abs(contentX - edge);
            if (diff < minDiff) {
              minDiff = diff;
              bestCol = c;
            }
          }
          newColSpan = Math.max(1, bestCol - resizeState.original.col + 1);
          if (newCol + newColSpan > 4) {
            newColSpan = 4 - newCol;
          }
        }
        if (handle.includes('l')) {
          let bestCol = 0;
          let minDiff = Infinity;
          for (let c = 0; c < 4; c++) {
            const edge = c * (colWidthVal + 4);
            const diff = Math.abs(contentX - edge);
            if (diff < minDiff) {
              minDiff = diff;
              bestCol = c;
            }
          }
          newCol = Math.max(0, Math.min(rightEdge - 1, bestCol));
          newColSpan = rightEdge - newCol;
        }
      }

      // High-precision row snapping for resizing
      if (handle.includes('b')) {
        let bestRow = 0;
        let minDiff = Infinity;
        for (let r = 0; r < 53; r++) {
          const edge = (r + 1) * 5;
          const diff = Math.abs(contentY - edge);
          if (diff < minDiff) {
            minDiff = diff;
            bestRow = r;
          }
        }
        newRowSpan = Math.max(1, bestRow - resizeState.original.row + 1);
        if (newRow + newRowSpan > 53) {
          newRowSpan = 53 - newRow;
        }
      }
      if (handle.includes('t')) {
        let bestRow = 0;
        let minDiff = Infinity;
        for (let r = 0; r < 53; r++) {
          const edge = r * 5;
          const diff = Math.abs(contentY - edge);
          if (diff < minDiff) {
            minDiff = diff;
            bestRow = r;
          }
        }
        newRow = Math.max(0, Math.min(bottomEdge - 1, bestRow));
        newRowSpan = bottomEdge - newRow;
      }

      const candidateCanvas = {
        page: block.canvas.page,
        col: newCol,
        row: newRow,
        colSpan: newColSpan,
        rowSpan: newRowSpan
      };
      const collides = anyOverlap(blocks, block.id, block.canvas.page, candidateCanvas, colWidth, paddingMm);
      const isValid = !collides &&
                      (newColSpan === 0 || (newCol + newColSpan <= 4)) &&
                      (newRow + newRowSpan <= 53);

      resizeState.current = {
        page: block.canvas.page,
        col: newCol,
        row: newRow,
        colSpan: newColSpan,
        rowSpan: newRowSpan
      };
      resizeState.isValid = isValid;

      // Realtime visual feedback
      updateBlockCanvas(block.id, resizeState.current);
    }

    function handlePointerUp(e) {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      if (resizeState) {
        if (resizeState.isValid) {
          updateBlockCanvas(block.id, resizeState.current);
        } else {
          // Snap back
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
    onSelect(block.id);
  }

  function handleDeleteClick(e) {
    e.stopPropagation();
    updateBlockCanvas(block.id, null);
  }

  // Headshot image upload handler
  let imageInput = $state(null);
  function handleUploadClick(e) {
    e.stopPropagation();
    imageInput?.click();
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limit to 200KB
    if (file.size > 200 * 1024) {
      alert('Image must be under 200 KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (updateBlockImageData) {
        updateBlockImageData(block.id, ev.target.result);
      }
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
  style="
    left: {leftMm}mm;
    top: {topMm}mm;
    width: {widthMm}mm;
    height: {heightMm}mm;
  "
  onclick={handleBlockClick}
  role="button"
  tabindex="0"
>
  <!-- Floating Action Toolbar (Only for selected blocks) -->
  {#if selected}
    <div class="floating-toolbar" contenteditable="false" onclick={(e) => e.stopPropagation()}>
      <div 
        class="toolbar-drag-handle" 
        draggable="true" 
        ondragstart={handleCanvasDragStart} 
        ondragend={handleCanvasDragEnd}
      >
        <span class="icon">⠿</span> Move
      </div>
      <div class="toolbar-divider"></div>
      <button type="button" class="toolbar-delete-btn" onclick={handleDeleteClick}>
        Delete
      </button>
      {#if isCanvasElement && block.elementType === 'headshot'}
        <div class="toolbar-divider"></div>
        <button type="button" class="toolbar-upload-btn" onclick={handleUploadClick}>
          📷 {block.imageData ? 'Replace' : 'Upload'}
        </button>
        <input 
          type="file" 
          accept="image/*" 
          style="display: none;" 
          bind:this={imageInput} 
          onchange={handleImageChange}
        />
      {/if}
      {#if !isCanvasElement}
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
    </div>
  {/if}

  <!-- Hover drag handle in the top-left corner (Section 5.2) -->
  {#if !selected}
    <div 
      class="hover-drag-handle" 
      draggable="true" 
      ondragstart={handleCanvasDragStart} 
      ondragend={handleCanvasDragEnd}
      contenteditable="false"
      title="Drag to move"
    >
      ⠿
    </div>
  {/if}


  <!-- Actual content container -->
  <div class="block-content-container tmpl-{templateName} block-type-{block.type}" class:canvas-element={isCanvasElement} bind:this={contentEl}>
    <BlockRenderer content={block.content} {block} />
  </div>

  <!-- Resize handles (Section 5.3) -->
  {#if selected}
    {#if isGutterElement}
      <!-- Gutter elements: vertical-only resize (top & bottom) -->
      <div class="resize-handle t" onpointerdown={(e) => handleResizeStart('t', e)}></div>
      <div class="resize-handle b" onpointerdown={(e) => handleResizeStart('b', e)}></div>
    {:else}
      <div class="resize-handle tl" onpointerdown={(e) => handleResizeStart('tl', e)}></div>
      <div class="resize-handle t" onpointerdown={(e) => handleResizeStart('t', e)}></div>
      <div class="resize-handle tr" onpointerdown={(e) => handleResizeStart('tr', e)}></div>
      <div class="resize-handle r" onpointerdown={(e) => handleResizeStart('r', e)}></div>
      <div class="resize-handle br" onpointerdown={(e) => handleResizeStart('br', e)}></div>
      <div class="resize-handle b" onpointerdown={(e) => handleResizeStart('b', e)}></div>
      <div class="resize-handle bl" onpointerdown={(e) => handleResizeStart('bl', e)}></div>
      <div class="resize-handle l" onpointerdown={(e) => handleResizeStart('l', e)}></div>
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
    background-color: #ffffff;
    z-index: 5;
  }

  /* Gutter elements (vertical dividers) sit in the 4mm gap — no background */
  .canvas-block.gutter-element {
    background-color: transparent;
  }

  .canvas-block.is-dragging {
    opacity: 0.4;
  }

  .canvas-block.selected {
    outline: 1.5px solid #2383e2;
    z-index: 20;
  }

  /* Overflow warning always beats selection blue */
  .canvas-block.overflowing,
  .canvas-block.selected.overflowing {
    outline: 1.5px solid #ef4444;
  }

  .canvas-block.resize-invalid {
    outline: 1.5px solid #ef4444 !important;
    background-color: rgba(239, 68, 68, 0.05);
  }

  /* Overlap warning — red pulsing border */
  .canvas-block.is-overlapping {
    outline: 2px solid #ef4444;
    box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3);
    animation: overlap-pulse 1.5s ease-in-out infinite;
  }

  .canvas-block.is-overlapping.gutter-element {
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
  }

  @keyframes overlap-pulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3); }
    50% { box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
  }

  /* Text Container */
  .block-content-container {
    width: 100%;
    height: 100%;
    overflow: visible;
    word-break: break-word;
  }

  /* Canvas elements don't need text background */
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
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.09);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
    border-radius: 4px;
    color: #878682;
    font-size: 11px;
    cursor: grab;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 50;
  }

  .canvas-block:hover .hover-drag-handle {
    opacity: 1;
  }

  /* Resize Handles */
  .resize-handle {
    position: absolute;
    width: 6px;
    height: 6px;
    background-color: #2383e2;
    border: 1px solid #ffffff;
    border-radius: 1px;
    z-index: 100;
  }

  .tl { top: -3px; left: -3px; cursor: nwse-resize; }
  .t { top: -3px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
  .tr { top: -3px; right: -3px; cursor: nesw-resize; }
  .r { top: 50%; right: -3px; transform: translateY(-50%); cursor: ew-resize; }
  .br { bottom: -3px; right: -3px; cursor: nwse-resize; }
  .b { bottom: -3px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
  .bl { bottom: -3px; left: -3px; cursor: nesw-resize; }
  .l { top: 50%; left: -3px; transform: translateY(-50%); cursor: ew-resize; }

  /* Floating Action Toolbar */
  .floating-toolbar {
    position: absolute;
    top: -36px;
    left: 0;
    height: 28px;
    background-color: #1e1e20;
    color: #ffffff;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    padding: 0 8px;
    z-index: 110;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    pointer-events: auto;
  }

  .toolbar-drag-handle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: grab;
    padding: 2px 6px;
    border-radius: 4px;
    user-select: none;
    font-weight: 500;
  }

  .toolbar-drag-handle:hover {
    background-color: rgba(255, 255, 255, 0.15);
  }

  .toolbar-divider {
    width: 1px;
    height: 14px;
    background-color: rgba(255, 255, 255, 0.2);
    margin: 0 6px;
  }

  .toolbar-delete-btn {
    border: none;
    background: transparent;
    color: #ff5c5c;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .toolbar-delete-btn:hover {
    background-color: rgba(255, 92, 92, 0.15);
  }

  /* Printing tweaks */
  @media print {
    .canvas-block {
      outline: none !important;
      background-color: transparent !important;
    }
    .resize-handle,
    .floating-toolbar,
    .hover-drag-handle {
      display: none !important;
    }
  }

  /* Upload button in toolbar */
  .toolbar-upload-btn {
    border: none;
    background: transparent;
    color: #a78bfa;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
  }

  .toolbar-upload-btn:hover {
    background-color: rgba(167, 139, 250, 0.15);
  }



  /* Floating Toolbar Block Naming styles */
  .toolbar-name-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background-color: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
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

  .toolbar-name-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .toolbar-name-input.invalid {
    color: #ff5c5c;
  }

  .toolbar-name-group:has(.toolbar-name-input.invalid) {
    border-color: #ff5c5c;
  }
</style>
