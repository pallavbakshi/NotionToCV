<!-- CanvasBlock.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import BlockRenderer from './BlockRenderer.svelte';

  let {
    block,
    blocks,
    paddingMm,
    selected = false,
    onSelect,
    updateBlockCanvas,
    updateBlockName,
    draggedBlockId = $bindable(),
    templateName = 'clean'
  } = $props();

  const PX_PER_MM = 96 / 25.4;

  let contentEl = $state(null);
  let overflowing = $state(false);
  let resizeObserver;
  let isDraggingThis = $state(false);

  // Live resizing state
  let resizeState = $state(null);

  // Column width calculation
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);

  // Dimensions based on canvas coordinates
  let leftMm = $derived(block.canvas ? paddingMm + block.canvas.col * (colWidth + 4) : 0);
  let topMm = $derived(block.canvas ? paddingMm + block.canvas.row * 5 : 0);
  let widthMm = $derived(block.canvas ? block.canvas.colSpan * colWidth + (block.canvas.colSpan - 1) * 4 : 0);
  let heightMm = $derived(block.canvas ? block.canvas.rowSpan * 5 : 0);

  function cellsOccupied(blocksList, candidateId, page, col, row, colSpan, rowSpan) {
    for (const b of blocksList) {
      if (!b.canvas || b.id === candidateId) continue;
      if (b.canvas.page !== page) continue;
      const c = b.canvas;
      const colOverlap = col < c.col + c.colSpan && col + colSpan > c.col;
      const rowOverlap = row < c.row + c.rowSpan && row + rowSpan > c.row;
      if (colOverlap && rowOverlap) return true;
    }
    return false;
  }

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

      const collides = cellsOccupied(
        blocks,
        block.id,
        block.canvas.page,
        newCol,
        newRow,
        newColSpan,
        newRowSpan
      );

      const isValid = !collides && 
                      (newCol + newColSpan <= 4) && 
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

  function setAlignment(align) {
    updateBlockCanvas(block.id, { align });
  }
</script>

<!-- Outer Block Wrapper -->
<div 
  class="canvas-block"
  class:selected={selected}
  class:overflowing={overflowing}
  class:is-dragging={isDraggingThis}
  class:resize-invalid={resizeState && !resizeState.isValid}
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
      <button type="button" class="toolbar-delete-btn" onclick={handleDeleteClick}>
        Delete
      </button>
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
      role="button"
      tabindex="-1"
      aria-label="Drag to move block"
      title="Drag to move"
    >
      ⠿
    </div>
  {/if}

  <!-- Actual content container -->
  <div 
    class="block-content-container tmpl-{templateName} block-type-{block.type}" 
    bind:this={contentEl}
    style="text-align: {block.canvas?.align || 'left'};"
  >
    <BlockRenderer content={block.content} />
  </div>

  <!-- Resize handles (Section 5.3) -->
  {#if selected}
    <div class="resize-handle tl" role="presentation" onpointerdown={(e) => handleResizeStart('tl', e)}></div>
    <div class="resize-handle t"  role="presentation" onpointerdown={(e) => handleResizeStart('t', e)}></div>
    <div class="resize-handle tr" role="presentation" onpointerdown={(e) => handleResizeStart('tr', e)}></div>
    <div class="resize-handle r"  role="presentation" onpointerdown={(e) => handleResizeStart('r', e)}></div>
    <div class="resize-handle br" role="presentation" onpointerdown={(e) => handleResizeStart('br', e)}></div>
    <div class="resize-handle b"  role="presentation" onpointerdown={(e) => handleResizeStart('b', e)}></div>
    <div class="resize-handle bl" role="presentation" onpointerdown={(e) => handleResizeStart('bl', e)}></div>
    <div class="resize-handle l"  role="presentation" onpointerdown={(e) => handleResizeStart('l', e)}></div>
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
    background-color: var(--color-ghost-white);
    z-index: 5;
  }

  .canvas-block.is-dragging {
    opacity: 0.4;
  }

  .canvas-block.selected {
    outline: 1.5px solid var(--color-imperial-blue);
  }

  /* Overflow warning always beats selection blue */
  .canvas-block.overflowing,
  .canvas-block.selected.overflowing {
    outline: 1.5px solid var(--color-magenta-bloom);
  }

  .canvas-block.resize-invalid {
    outline: 1.5px solid var(--color-magenta-bloom) !important;
    background-color: rgba(216, 49, 91, 0.05);
  }

  /* Text Container */
  .block-content-container {
    width: 100%;
    height: 100%;
    overflow: visible;
    word-break: break-word;
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

  .canvas-block:hover .hover-drag-handle {
    opacity: 1;
  }

  /* Resize Handles */
  .resize-handle {
    position: absolute;
    width: 6px;
    height: 6px;
    background-color: var(--color-imperial-blue);
    border: 1px solid var(--color-ghost-white);
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

  .toolbar-drag-handle:hover {
    background-color: rgba(255, 255, 255, 0.15);
  }

  .toolbar-divider {
    width: 1px;
    height: 14px;
    background-color: rgba(255, 255, 255, 0.25);
    margin: 0 6px;
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

  .toolbar-delete-btn:hover {
    background-color: rgba(239, 68, 68, 0.2);
    color: #fee2e2;
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

  .toolbar-align-btn:hover {
    background-color: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .toolbar-align-btn.active {
    background-color: rgba(255, 255, 255, 0.25);
    color: var(--color-magenta-bloom);
  }

  .align-icon {
    width: 14px;
    height: 14px;
  }
</style>
