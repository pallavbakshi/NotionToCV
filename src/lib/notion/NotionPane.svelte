<!-- NotionPane.svelte -->
<script>
  import BlockEditor from './BlockEditor.svelte';

  // Svelte 5 props
  let { 
    blocks = $bindable(), 
    pageTitle = $bindable(),
    draggedBlockId = $bindable(),
    paddingMm = $bindable(15),
    activeTemplate = $bindable('clean'),
    customTemplates = $bindable({})
  } = $props();

  let fileInput;
  let focusTarget = $state({ index: null, position: 'end', timestamp: 0 });
  
  // Drag and drop states
  let dragFromIndex = $state(null);
  let dropTargetIndex = $state(null);
  let dropIndicatorTop = $state(null);
  let scrollContainerEl;
  let contentWrapperEl;

  // Programmatic focus helper
  function focusBlock(index, position = 'end') {
    if (index >= 0 && index < blocks.length) {
      focusTarget = { index, position, timestamp: Date.now() };
    }
  }

  // Mutations
  function addBlockAfter(index, afterCursorContent = []) {
    const newBlock = {
      id: 'b_' + Math.random().toString(36).substring(2, 9),
      type: 'paragraph',
      content: afterCursorContent,
      canvas: null
    };
    blocks.splice(index + 1, 0, newBlock);
    blocks = [...blocks];
    focusBlock(index + 1, 'start');
  }

  function deleteBlock(index) {
    if (blocks.length <= 1) {
      // Invariant: Never allow an empty blocks array
      blocks = [{
        id: 'b_' + Math.random().toString(36).substring(2, 9),
        type: 'paragraph',
        content: [],
        canvas: null
      }];
      focusBlock(0);
    } else {
      blocks.splice(index, 1);
      blocks = [...blocks];
      // Focus preceding block, or first block if index was 0
      const focusIdx = index > 0 ? index - 1 : 0;
      focusBlock(focusIdx, 'end');
    }
  }

  function duplicateBlock(index) {
    const original = blocks[index];
    const newBlock = {
      id: 'b_' + Math.random().toString(36).substring(2, 9),
      type: original.type,
      content: JSON.parse(JSON.stringify(original.content)),
      canvas: null
    };
    blocks.splice(index + 1, 0, newBlock);
    blocks = [...blocks];
    focusBlock(index + 1, 'end');
  }

  function updateBlock(index, patch) {
    if (index >= 0 && index < blocks.length) {
      blocks[index] = { ...blocks[index], ...patch };
    }
  }

  function moveBlock(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const item = blocks[fromIndex];
    blocks.splice(fromIndex, 1);
    
    let adjustedToIndex = toIndex;
    if (toIndex > fromIndex) {
      adjustedToIndex--;
    }
    blocks.splice(adjustedToIndex, 0, item);
    blocks = [...blocks];
  }

  // Merging logic
  function mergeWithPrevious(index, currentContent) {
    if (index <= 0) return;
    const prevBlock = blocks[index - 1];
    
    // Concatenate inline nodes
    const mergedContent = [...(prevBlock.content || []), ...currentContent];
    
    // Calculate junction cursor position (1 + text length of previous block)
    let prevTextLength = 0;
    if (prevBlock.content) {
      for (const node of prevBlock.content) {
        if (node.type === 'text' && node.text) {
          prevTextLength += node.text.length;
        }
      }
    }
    const junctionPos = 1 + prevTextLength;

    // Update previous block
    blocks[index - 1] = {
      ...prevBlock,
      content: mergedContent
    };

    // Remove current block
    blocks.splice(index, 1);
    blocks = [...blocks];
    
    // Focus previous block at junction position
    focusBlock(index - 1, junctionPos);
  }

  // JSON Import & Export
  function exportJSON() {
    const data = {
      pageTitle,
      blocks,
      paddingMm,
      templateName: activeTemplate,
      customTemplates
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (pageTitle.trim() || 'Untitled') + '_resume.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInput.click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data && Array.isArray(data.blocks)) {
          blocks = data.blocks;
          pageTitle = data.pageTitle || '';
          if (data.paddingMm !== undefined) paddingMm = data.paddingMm;
          if (data.templateName) activeTemplate = data.templateName;
          if (data.customTemplates) customTemplates = data.customTemplates;
        } else {
          alert('Invalid JSON file format. It must contain a "blocks" array.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  }

  // Drag and Drop Event Handlers
  function handleDragStart(index, e) {
    dragFromIndex = index;
    const block = blocks[index];
    if (block) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.id);
      draggedBlockId = block.id;
    }
  }

  function handleDragOver(index, e) {
    e.preventDefault();
    if (dragFromIndex === null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const isTopHalf = relativeY < rect.height / 2;

    const targetIdx = isTopHalf ? index : index + 1;

    // Do not show indicator if dropping results in no change
    if (targetIdx === dragFromIndex || targetIdx === dragFromIndex + 1) {
      dropTargetIndex = null;
      dropIndicatorTop = null;
      return;
    }

    dropTargetIndex = targetIdx;

    if (!contentWrapperEl) return;
    const wrapperRect = contentWrapperEl.getBoundingClientRect();

    if (targetIdx < blocks.length) {
      const targetElement = e.currentTarget.parentNode.children[targetIdx];
      if (targetElement) {
        const targetRect = targetElement.getBoundingClientRect();
        dropIndicatorTop = targetRect.top - wrapperRect.top;
      }
    } else {
      const lastElement = e.currentTarget.parentNode.children[blocks.length - 1];
      if (lastElement) {
        const lastRect = lastElement.getBoundingClientRect();
        dropIndicatorTop = lastRect.bottom - wrapperRect.top;
      }
    }
  }

  function handleDragEnd() {
    dragFromIndex = null;
    dropTargetIndex = null;
    dropIndicatorTop = null;
    draggedBlockId = null;
  }

  function handleDrop(index, e) {
    e.preventDefault();
    if (dragFromIndex !== null && dropTargetIndex !== null) {
      moveBlock(dragFromIndex, dropTargetIndex);
    }
    handleDragEnd();
  }
</script>

<!-- Top Bar -->
<div class="top-bar">
  <div class="view-label">Notion View</div>
  <div class="action-buttons">
    <button type="button" class="btn btn-outline" onclick={triggerImport}>Import JSON</button>
    <button type="button" class="btn btn-outline" onclick={exportJSON}>Export JSON</button>
    <input 
      type="file" 
      accept=".json" 
      style="display: none;" 
      bind:this={fileInput} 
      onchange={handleImportFile}
    />
  </div>
</div>

<!-- Editor scroll container -->
<div 
  class="notion-editor-scroll" 
  bind:this={scrollContainerEl}
>
  <div class="notion-content-wrapper" style="position: relative;" bind:this={contentWrapperEl}>
    <!-- Page Title -->
    <div class="title-container">
      <input 
        type="text" 
        class="page-title-input" 
        bind:value={pageTitle} 
        placeholder="Untitled"
      />
    </div>

    <!-- Drag drop list container -->
    <div class="blocks-container">
      {#each blocks as block, idx (block.id)}
        <div 
          class="block-row-wrapper"
          ondragover={(e) => handleDragOver(idx, e)}
          ondrop={(e) => handleDrop(idx, e)}
          role="listitem"
        >
          <BlockEditor 
            bind:block={blocks[idx]}
            index={idx}
            isFirst={idx === 0}
            isLast={idx === blocks.length - 1}
            {focusTarget}
            {addBlockAfter}
            {deleteBlock}
            {updateBlock}
            {moveBlock}
            {focusBlock}
            {mergeWithPrevious}
            {duplicateBlock}
            onDragStart={(e) => handleDragStart(idx, e)}
            onDragEnd={handleDragEnd}
          />
        </div>
      {/each}
    </div>

    <!-- Reorder insertion line -->
    {#if dropIndicatorTop !== null}
      <div 
        class="drop-indicator" 
        style="top: {dropIndicatorTop}px;"
      ></div>
    {/if}
  </div>
</div>

<style>
  .top-bar {
    height: 44px;
    border-bottom: 1px solid var(--notion-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background-color: #ffffff;
    user-select: none;
    flex-shrink: 0;
  }

  .view-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--notion-text-muted);
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
  }

  .action-buttons .btn {
    font-size: 12px;
    padding: 3px 8px;
  }

  .notion-editor-scroll {
    flex-grow: 1;
    overflow-y: auto;
    background-color: #ffffff;
    padding: 32px 0 160px 0;
  }

  .notion-content-wrapper {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 48px 0 0;
    width: 100%;
  }

  .title-container {
    padding-left: 48px;
    margin-bottom: 28px;
  }

  .page-title-input {
    font-size: 40px;
    font-weight: 700;
    border: none;
    background: transparent;
    outline: none;
    width: 100%;
    color: var(--notion-text);
    font-family: var(--font-sans);
  }

  .page-title-input::placeholder {
    color: var(--notion-text-placeholder);
  }

  .blocks-container {
    display: flex;
    flex-direction: column;
  }

  .block-row-wrapper {
    position: relative;
    width: 100%;
  }

  .drop-indicator {
    position: absolute;
    left: 48px; /* align with block text start */
    right: 0;
    height: 2px;
    background-color: var(--notion-blue);
    pointer-events: none;
    z-index: 5;
    transition: top 0.05s ease-out;
  }
</style>
