<!-- CvPage.svelte -->
<script>
  import CanvasBlock from './CanvasBlock.svelte';
  import GridOverlay from './GridOverlay.svelte';

  let {
    page,
    blocks,
    paddingMm,
    selectedBlockId = $bindable(),
    updateBlockCanvas,
    draggedBlockId = $bindable(),
    templateName = 'clean'
  } = $props();

  const templatesConfig = {
    clean: {
      defaultSpans: {
        paragraph: { colSpan: 2, rowSpan: 1 },
        h3: { colSpan: 2, rowSpan: 2 },
        h2: { colSpan: 4, rowSpan: 3 },
        h1: { colSpan: 4, rowSpan: 4 }
      }
    }
  };

  const PX_PER_MM = 96 / 25.4;

  let isDraggingOver = $state(false);
  let dragOverCoords = $state(null); // { col, row, colSpan, rowSpan, isValid }

  // Column width calculation
  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);

  // Conversion helper
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

  function cellsOccupied(blocksList, candidateId, pageNum, col, row, colSpan, rowSpan) {
    for (const b of blocksList) {
      if (!b.canvas || b.id === candidateId) continue;
      if (b.canvas.page !== pageNum) continue;
      const c = b.canvas;
      const colOverlap = col < c.col + c.colSpan && col + colSpan > c.col;
      const rowOverlap = row < c.row + c.rowSpan && row + rowSpan > c.row;
      if (colOverlap && rowOverlap) return true;
    }
    return false;
  }

  // HTML5 Drag and Drop Handlers for Page Dropzone
  function handleDragOver(e) {
    e.preventDefault();
    if (!draggedBlockId) return;

    isDraggingOver = true;
    const pageRect = e.currentTarget.getBoundingClientRect();
    const pxX = e.clientX - pageRect.left;
    const pxY = e.clientY - pageRect.top;

    const gridPos = pxToGrid(pxX, pxY, paddingMm);
    let { col, row } = gridPos;

    // Determine dimensions of block being dragged dynamically from template configuration
    const draggedBlock = blocks.find(b => b.id === draggedBlockId);
    const activeConfig = templatesConfig[templateName] || templatesConfig.clean;
    const defaultSpans = (draggedBlock && activeConfig.defaultSpans[draggedBlock.type]) || { colSpan: 2, rowSpan: 1 };

    const colSpan = draggedBlock?.canvas?.colSpan ?? defaultSpans.colSpan;
    const rowSpan = draggedBlock?.canvas?.rowSpan ?? defaultSpans.rowSpan;

    // Constrain to grid boundaries
    if (col + colSpan > 4) {
      col = 4 - colSpan;
    }
    if (row + rowSpan > 53) {
      row = 53 - rowSpan;
    }

    const collides = cellsOccupied(blocks, draggedBlockId, page, col, row, colSpan, rowSpan);
    
    dragOverCoords = {
      col,
      row,
      colSpan,
      rowSpan,
      isValid: !collides
    };
  }

  function handleDragLeave() {
    isDraggingOver = false;
    dragOverCoords = null;
  }

  function handleDrop(e) {
    e.preventDefault();
    isDraggingOver = false;

    if (!draggedBlockId || !dragOverCoords) return;

    const { col, row, colSpan, rowSpan, isValid } = dragOverCoords;
    if (isValid) {
      updateBlockCanvas(draggedBlockId, {
        page,
        col,
        row,
        colSpan,
        rowSpan
      });
    }

    dragOverCoords = null;
  }

  // Select/Deselect handlers
  function handleSelectBlock(id) {
    selectedBlockId = id;
  }

  // Map snap ghost to MM values
  let ghostLeftMm = $derived(dragOverCoords ? paddingMm + dragOverCoords.col * (colWidth + 4) : 0);
  let ghostTopMm = $derived(dragOverCoords ? paddingMm + dragOverCoords.row * 5 : 0);
  let ghostWidthMm = $derived(dragOverCoords ? dragOverCoords.colSpan * colWidth + (dragOverCoords.colSpan - 1) * 4 : 0);
  let ghostHeightMm = $derived(dragOverCoords ? dragOverCoords.rowSpan * 5 : 0);
</script>

<div 
  class="cv-page-container"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <div 
    class="cv-page"
    style="
      --padding-mm: {paddingMm}mm;
    "
  >
    <!-- Grid System overlay (consistently shown) -->
    <GridOverlay
      paddingMm={paddingMm}
      isVisible={true}
    />

    <!-- Render snap ghost during drag -->
    {#if isDraggingOver && dragOverCoords}
      <div 
        class="snap-ghost"
        class:invalid={!dragOverCoords.isValid}
        style="
          left: {ghostLeftMm}mm;
          top: {ghostTopMm}mm;
          width: {ghostWidthMm}mm;
          height: {ghostHeightMm}mm;
        "
      ></div>
    {/if}

    <!-- Render placed blocks on this page -->
    {#each blocks as block, idx (block.id)}
      {#if block.canvas && block.canvas.page === page}
        <CanvasBlock
          block={blocks[idx]}
          blocks={blocks}
          paddingMm={paddingMm}
          selected={selectedBlockId === block.id}
          onSelect={handleSelectBlock}
          updateBlockCanvas={updateBlockCanvas}
          bind:draggedBlockId={draggedBlockId}
          templateName={templateName}
        />
      {/if}
    {/each}
  </div>
</div>

<style>
  .cv-page-container {
    position: relative;
    user-select: none;
  }

  .cv-page {
    width: 210mm;
    height: 297mm;
    position: relative;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04), 0 1px 4px rgba(0, 0, 0, 0.02);
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Snapping Ghost Grid Outline */
  .snap-ghost {
    position: absolute;
    pointer-events: none;
    background-color: rgba(35, 131, 226, 0.15);
    border: 2px dashed #2383e2;
    border-radius: 4px;
    z-index: 20;
    box-sizing: border-box;
    transition: left 0.05s ease-out, top 0.05s ease-out, width 0.05s ease-out, height 0.05s ease-out;
  }

  .snap-ghost.invalid {
    background-color: rgba(239, 68, 68, 0.15);
    border-color: #ef4444;
  }

  @media print {
    .cv-page {
      box-shadow: none !important;
      page-break-after: always;
      break-after: page;
    }
    .snap-ghost {
      display: none !important;
    }
  }
</style>
