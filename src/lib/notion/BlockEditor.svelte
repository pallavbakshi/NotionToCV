<!-- BlockEditor.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { StarterKit } from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Color } from '@tiptap/extension-color';
  import { FontFamily } from '@tiptap/extension-font-family';
  import { Placeholder } from '@tiptap/extension-placeholder';

  // Svelte 5 props
  let {
    block = $bindable(),
    blocks = [],
    index,
    isFirst,
    isLast,
    focusTarget,
    addBlockAfter,
    deleteBlock,
    updateBlock,
    moveBlock,
    focusBlock,
    mergeWithPrevious,
    duplicateBlock,
    onDragStart,
    onDragEnd,
    selected = false,
    selectedBlockIds = [],
    onSelectBlock,
    onEditorFocus,
    deleteSelectedBlocks,
    duplicateSelectedBlocks
  } = $props();

  let editorElement;
  let rowElement;
  let editor = $state();

  let current = $derived({ index, block, blocks });
  
  // Custom bubble menu element bindings
  let showBubbleMenu = $state(false);
  let bubbleMenuCoords = $state({ left: 0, top: 0 });
  let showTurnIntoPanel = $state(false);
  let currentColor = $state('#37352f');
  let currentFont = $state('Default');
  
  // Format active states
  let isBold = $state(false);
  let isItalic = $state(false);
  let isUnderline = $state(false);
  let isStrike = $state(false);
  
  // Slash menu state
  let showSlashMenu = $state(false);
  let filterText = $state('');
  let highlightedIndex = $state(0);
  let slashMenuCoords = $state({ left: 0, top: 0 });

  // @ name-trigger menu state
  let showAtMenu = $state(false);
  let atText = $state('');
  let atMenuCoords = $state({ left: 0, top: 0 });

  function closeAtMenu() {
    showAtMenu = false;
    atText = '';
  }

  function applyAtMention() {
    if (!editor) return;
    const { from } = editor.state.selection;
    const resolvedPos = editor.state.doc.resolve(from);
    const textBefore = resolvedPos.parent.textContent.substring(0, resolvedPos.parentOffset);
    const match = textBefore.match(/@([a-zA-Z0-9-_]*)$/);
    if (match) {
      editor.commands.deleteRange({ from: from - match[0].length, to: from });
    }
    modalNameVal = atText || current.block.name || '';
    showNameModal = true;
    validateModalName(modalNameVal);
    closeAtMenu();
  }

  // Action Menu state
  let showActionMenu = $state(false);
  let dragStartFired = false;
  let clickStartX = 0;
  let clickStartY = 0;

  // Name modal state
  let showNameModal = $state(false);
  let modalNameVal = $state('');
  let modalNameError = $state('');
  let modalInputEl = $state();

  function validateModalName(val) {
    const trimmed = val.trim();
    if (trimmed === '') { modalNameError = ''; return; }
    if (!/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
      modalNameError = 'Letters, numbers, dashes and underscores only';
      return;
    }
    const isDuplicate = current.blocks.some(
      (b, i) => i !== current.index && b.name && b.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    modalNameError = isDuplicate ? 'Name must be unique across all blocks' : '';
  }

  function handleModalNameInput(e) {
    modalNameVal = e.target.value;
    validateModalName(modalNameVal);
  }

  function saveModalName() {
    validateModalName(modalNameVal);
    if (modalNameError) return;
    const trimmed = modalNameVal.trim();
    updateBlock(current.index, { name: trimmed || null });
    showNameModal = false;
    editor?.commands.focus();
  }

  function closeModal() {
    showNameModal = false;
    editor?.commands.focus();
  }

  $effect(() => {
    if (showNameModal && modalInputEl) {
      modalInputEl.focus();
      modalInputEl.select();
    }
  });

  // Track programmatic focus
  let lastHandledFocusTime = 0;

  // Svelte-native bubble menu positioning
  function updateBubbleMenu() {
    if (!editor || !rowElement) return;
    const { state } = editor;
    const { selection } = state;
    
    if (editor.isFocused && !selection.empty) {
      try {
        const coordsStart = editor.view.coordsAtPos(selection.from);
        const coordsEnd = editor.view.coordsAtPos(selection.to);
        const rowRect = rowElement.getBoundingClientRect();
        
        // Centered horizontally above selection
        const centerLeft = (coordsStart.left + coordsEnd.left) / 2 - rowRect.left;
        
        bubbleMenuCoords = {
          left: Math.max(8, centerLeft - 150),
          top: coordsStart.top - rowRect.top - 46
        };
        showBubbleMenu = true;
      } catch (err) {
        showBubbleMenu = false;
      }
    } else {
      showBubbleMenu = false;
      showTurnIntoPanel = false;
    }
  }

  // Available Slash Command Items
  const slashItems = [
    { type: 'paragraph', label: 'Text',        desc: 'Plain paragraph',                   keywords: ['text', 'paragraph'],    icon: '¶'  },
    { type: 'h1',       label: 'Heading 1',    desc: 'Large section title',               keywords: ['h1', 'heading1'],       icon: 'H1' },
    { type: 'h2',       label: 'Heading 2',    desc: 'Medium heading',                    keywords: ['h2', 'heading2'],       icon: 'H2' },
    { type: 'h3',       label: 'Heading 3',    desc: 'Small heading',                     keywords: ['h3', 'heading3'],       icon: 'H3' },
    { type: 'name',     label: 'Name Block',   desc: 'Assign a unique @name to this block', keywords: ['name', 'rename', 'label'], icon: '@' }
  ];

  // Derived filtered items for Slash Menu
  let filteredItems = $derived(
    slashItems.filter(item => 
      !filterText || 
      item.label.toLowerCase().includes(filterText.toLowerCase()) || 
      item.keywords.some(k => k.includes(filterText.toLowerCase()))
    )
  );

  // ProseMirror forbids empty text nodes. Strip any {type:'text', text:''}
  // before feeding content to Tiptap (content can come from import / localStorage).
  function cleanInlineContent(arr) {
    return (arr || []).filter(n => !(n.type === 'text' && (!n.text || n.text.length === 0)));
  }

  // Helper to split JSON content array at specific character offset
  function splitInlineContent(contentArray, splitOffset) {
    let before = [];
    let after = [];
    let currentOffset = 0;

    for (const node of contentArray) {
      if (node.type === 'text') {
        const textLen = node.text.length;
        if (currentOffset + textLen <= splitOffset) {
          before.push(node);
          currentOffset += textLen;
        } else if (currentOffset >= splitOffset) {
          after.push(node);
        } else {
          const splitPoint = splitOffset - currentOffset;
          before.push({
            ...node,
            text: node.text.slice(0, splitPoint)
          });
          after.push({
            ...node,
            text: node.text.slice(splitPoint)
          });
          currentOffset = splitOffset;
        }
      } else {
        const nodeLen = 1; // non-text node (like hardBreak) has size 1 in ProseMirror
        if (currentOffset + nodeLen <= splitOffset) {
          before.push(node);
          currentOffset += nodeLen;
        } else {
          after.push(node);
        }
      }
    }
    return { before, after };
  }

  onMount(() => {
    // Map block type to ProseMirror node type
    const nodeType = block.type === 'paragraph' ? 'paragraph' : 'heading';
    const attrs = block.type !== 'paragraph' ? { level: parseInt(block.type[1]) } : {};

    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          horizontalRule: false,
          codeBlock: false,
          code: false,
          trailingNode: false,
          history: false,
        }),
        TextStyle,
        Color,
        FontFamily,
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === 'heading') {
              return `Heading ${node.attrs.level}`;
            }
            return "Type '/' for commands";
          }
        })
      ],
      content: {
        type: 'doc',
        content: [{
          type: nodeType,
          attrs,
          content: cleanInlineContent(block.content)
        }]
      },
      editorProps: {
        handleKeyDown: (view, event) => {
          // 1. Slash Menu Key Handling
          if (showSlashMenu) {
            if (event.key === 'ArrowDown') {
              highlightedIndex = (highlightedIndex + 1) % filteredItems.length;
              event.preventDefault();
              return true;
            }
            if (event.key === 'ArrowUp') {
              highlightedIndex = (highlightedIndex - 1 + filteredItems.length) % filteredItems.length;
              event.preventDefault();
              return true;
            }
            if (event.key === 'Enter') {
              if (filteredItems[highlightedIndex]) {
                applySlashItem(filteredItems[highlightedIndex]);
              }
              event.preventDefault();
              return true;
            }
            if (event.key === 'Escape') {
              closeSlashMenu();
              editor.commands.setContent('');
              event.preventDefault();
              return true;
            }
          }

          // 1.5 @ name-trigger menu key handling
          if (showAtMenu) {
            if (event.key === 'Enter' || event.key === 'Tab') {
              applyAtMention();
              event.preventDefault();
              return true;
            }
            if (event.key === 'Escape') {
              closeAtMenu();
              event.preventDefault();
              return true;
            }
          }

          // 1.6 Intercept Enter for /name [value] command
          if (event.key === 'Enter' && !event.shiftKey) {
            const rawText = view.state.doc.textContent;
            const match = rawText.match(/^\/name(?:\s+([^\s]+))?(?:\s|$)/);
            if (match) {
              const namePart = match[1] ? match[1].trim() : '';
              modalNameVal = namePart || current.block.name || '';
              showNameModal = true;
              validateModalName(modalNameVal);
              view.dispatch(view.state.tr.delete(1, match[0].length + 1));
              closeSlashMenu();
              event.preventDefault();
              return true;
            }
          }

          // 2. Custom Enter Block Splitting
          if (event.key === 'Enter' && !event.shiftKey) {
            const { selection } = editor.state;
            let from = selection.from;
            let to = selection.to;

            // If there's a selection, delete it first
            if (from !== to) {
              editor.commands.deleteSelection();
              from = editor.state.selection.from;
            }

            const splitOffset = from - 1;
            const contentArray = editor.state.doc.firstChild.toJSON().content || [];
            const { before, after } = splitInlineContent(contentArray, splitOffset);

            // Update current block content in the parent blocks array
            updateBlock(current.index, { content: before });

            // Force set content in current editor to prevent cursor flashing or newline inserts
            const nodeType = current.block.type === 'paragraph' ? 'paragraph' : 'heading';
            const attrs = current.block.type !== 'paragraph' ? { level: parseInt(current.block.type[1]) } : {};
            editor.commands.setContent({
              type: 'doc',
              content: [{
                type: nodeType,
                attrs,
                content: before
              }]
            });

            // Insert new block with remaining content
            addBlockAfter(current.index, after);
            event.preventDefault();
            return true;
          }

          // 3. Custom Backspace Merging/Deletion
          if (event.key === 'Backspace') {
            const { selection } = editor.state;
            if (selection.empty && selection.from === 1) {
              const isEmpty = editor.getText().trim() === '';
              
              if (isEmpty && current.index > 0) {
                deleteBlock(current.index);
                event.preventDefault();
                return true;
              } else if (current.index > 0) {
                const currentContent = editor.state.doc.firstChild.toJSON().content || [];
                mergeWithPrevious(current.index, currentContent);
                event.preventDefault();
                return true;
              }
            }
          }

          // 4. Custom Arrow Navigation
          if (event.key === 'ArrowUp') {
            const { selection } = editor.state;
            if (selection.from === 1 && current.index > 0) {
              focusBlock(current.index - 1, 'end');
              event.preventDefault();
              return true;
            }
          }

          if (event.key === 'ArrowDown') {
            const { selection } = editor.state;
            const docLength = editor.state.doc.content.size;
            const endOfDoc = docLength - 1;
            
            if (selection.from === endOfDoc) {
              focusBlock(current.index + 1, 'start');
              event.preventDefault();
              return true;
            }
          }

          // 5. Intercept Tab Key
          if (event.key === 'Tab') {
            event.preventDefault();
            return true;
          }

          return false;
        }
      },
      onUpdate: () => {
        if (!editor || editor.isDestroyed) return;
        const docNode = editor.state.doc;
        const firstChild = docNode.firstChild;
        const newContent = firstChild ? (firstChild.toJSON().content ?? []) : [];
        const newType = firstChild && firstChild.type.name === 'heading'
          ? `h${firstChild.attrs.level}`
          : 'paragraph';

        // Check if slash menu should trigger
        const text = editor.getText();
        const slashMatch = text.match(/^\/([a-z]*)$/i);
        
        if (slashMatch) {
          showSlashMenu = true;
          filterText = slashMatch[1];
          highlightedIndex = 0;
          showAtMenu = false;

          const { selection } = editor.state;
          const coords = editor.view.coordsAtPos(selection.from);
          const editorRect = editorElement.getBoundingClientRect();
          slashMenuCoords = {
            left: coords.left - editorRect.left,
            top: coords.bottom - editorRect.top + 4
          };
        } else {
          showSlashMenu = false;
        }

        // Check if @ name-trigger should show
        if (!showSlashMenu) {
          const { from } = editor.state.selection;
          const resolvedPos = editor.state.doc.resolve(from);
          const textBefore = resolvedPos.parent.textContent.substring(0, resolvedPos.parentOffset);
          const atMatch = textBefore.match(/@([a-zA-Z0-9-_]*)$/);

          if (atMatch) {
            atText = atMatch[1];
            showAtMenu = true;
            const coords = editor.view.coordsAtPos(from);
            const editorRect = editorElement.getBoundingClientRect();
            atMenuCoords = {
              left: coords.left - editorRect.left,
              top: coords.bottom - editorRect.top + 4
            };
          } else {
            showAtMenu = false;
            atText = '';
          }
        }

        // Keep bubble menu values updated
        currentColor = editor.getAttributes('textStyle').color || '#37352f';
        currentFont = editor.getAttributes('textStyle').fontFamily || 'Default';
        isBold = editor.isActive('bold');
        isItalic = editor.isActive('italic');
        isUnderline = editor.isActive('underline');
        isStrike = editor.isActive('strike');
        updateBubbleMenu();

        // Sync back to Svelte block state if changed
        const contentChanged = JSON.stringify(current.block.content) !== JSON.stringify(newContent);
        const typeChanged = current.block.type !== newType;
        if (contentChanged || typeChanged) {
          updateBlock(current.index, { content: newContent, type: newType });
        }
      },
      onSelectionUpdate: () => {
        if (!editor || editor.isDestroyed) return;
        currentColor = editor.getAttributes('textStyle').color || '#37352f';
        currentFont = editor.getAttributes('textStyle').fontFamily || 'Default';
        isBold = editor.isActive('bold');
        isItalic = editor.isActive('italic');
        isUnderline = editor.isActive('underline');
        isStrike = editor.isActive('strike');
        updateBubbleMenu();
      },
      onFocus: () => {
        updateBubbleMenu();
        if (onEditorFocus) onEditorFocus(block.id);
      },
      onBlur: ({ event }) => {
        setTimeout(() => {
          if (!document.activeElement?.closest('.bubble-menu-card')) {
            showBubbleMenu = false;
            showTurnIntoPanel = false;
          }
          if (!document.activeElement?.closest('.at-menu-card')) {
            closeAtMenu();
          }
        }, 150);
      }
    });

    // Handle initial autofocus if requested
    if (current.index === 0 && current.block.content.length === 0 && !localStorage.getItem('notionToCV_blocks')) {
      editor.commands.focus();
    }
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
  });

  // Watch programmatic focus requests from parent NotionPane
  $effect(() => {
    if (focusTarget && focusTarget.index === current.index && focusTarget.timestamp > lastHandledFocusTime) {
      lastHandledFocusTime = focusTarget.timestamp;
      if (editor) {
        editor.commands.focus(focusTarget.position);
      }
    }
  });

  // Normalize inline nodes for comparison so stored content matches Tiptap's
  // output: drop empty text nodes (Tiptap rejects them) and drop the marks key
  // when empty (Tiptap omits it).
  function normalizeForCompare(nodes) {
    return cleanInlineContent(nodes).map(n => {
      if (n.type !== 'text') return n;
      const { marks, ...rest } = n;
      return marks?.length ? { ...rest, marks } : rest;
    });
  }

  // Sync editor content from outside updates (e.g. reordering/dragging/JSON loading)
  $effect(() => {
    if (editor && block && !editor.isDestroyed) {
      const docNode = editor.state.doc;
      const firstChild = docNode.firstChild;
      const editorContent = firstChild ? (firstChild.toJSON().content ?? []) : [];
      const editorType = firstChild && firstChild.type.name === 'heading'
        ? `h${firstChild.attrs.level}`
        : 'paragraph';

      const isContentSync = JSON.stringify(normalizeForCompare(editorContent)) === JSON.stringify(normalizeForCompare(block.content));
      const isTypeSync = editorType === block.type;

      if (!isContentSync || !isTypeSync) {
        const nodeType = block.type === 'paragraph' ? 'paragraph' : 'heading';
        const attrs = block.type !== 'paragraph' ? { level: parseInt(block.type[1]) } : {};
        
        // Save current selection to restore it
        const { from, to } = editor.state.selection;
        
        editor.commands.setContent({
          type: 'doc',
          content: [{
            type: nodeType,
            attrs,
            content: cleanInlineContent(block.content)
          }]
        });
        
        // Restore selection if editor is focused
        if (editor.isFocused) {
          editor.commands.setTextSelection({ from, to });
        }
      }
    }
  });

  // Reset bubble sub-panel when selection closes
  $effect(() => {
    if (editor && !editor.isFocused) {
      showTurnIntoPanel = false;
    }
  });

  // Blur editor if block is selected
  $effect(() => {
    if (selected && editor && editor.isFocused) {
      editor.commands.blur();
    }
  });

  // Apply slash menu selection
  function applySlashItem(item) {
    if (!editor) return;

    if (item.type === 'name') {
      modalNameVal = current.block.name || '';
      showNameModal = true;
      validateModalName(modalNameVal);
      editor.commands.setContent('');
      closeSlashMenu();
      editor.commands.focus();
      return;
    }

    // Clear editor slash text
    editor.commands.setContent('');
    
    // Update block state
    updateBlock(index, { type: item.type, content: [] });

    // Re-initialize editor type with empty content
    const nodeType = item.type === 'paragraph' ? 'paragraph' : 'heading';
    const attrs = item.type !== 'paragraph' ? { level: parseInt(item.type[1]) } : {};
    
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: nodeType,
        attrs,
        content: []
      }]
    });

    closeSlashMenu();
    editor.commands.focus();
  }

  function closeSlashMenu() {
    showSlashMenu = false;
    filterText = '';
  }

  // Bubble menu methods
  function toggleBold() {
    editor.chain().focus().toggleBold().run();
  }
  function toggleItalic() {
    editor.chain().focus().toggleItalic().run();
  }
  function toggleUnderline() {
    editor.chain().focus().toggleUnderline().run();
  }
  function toggleStrike() {
    editor.chain().focus().toggleStrike().run();
  }

  function handleColorChange(e) {
    const color = e.target.value;
    currentColor = color;
    editor.chain().focus().setColor(color).run();
  }

  function handleFontChange(e) {
    const font = e.target.value;
    currentFont = font;
    if (font === 'Default') {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor.chain().focus().setFontFamily(font).run();
    }
  }

  function applyTurnInto(type) {
    updateBlock(index, { type });
    
    const nodeType = type === 'paragraph' ? 'paragraph' : 'heading';
    const attrs = type !== 'paragraph' ? { level: parseInt(type[1]) } : {};
    const content = editor.state.doc.firstChild.toJSON().content || [];
    
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: nodeType,
        attrs,
        content
      }]
    });
    showTurnIntoPanel = false;
    editor.commands.focus();
  }

  // Handle Drag Handle click-vs-drag and Action Menu triggers
  function handleHandleMouseDown(e) {
    dragStartFired = false;
    clickStartX = e.screenX;
    clickStartY = e.screenY;
  }

  function handleHandleMouseUp(e) {
    const dist = Math.sqrt(Math.pow(e.screenX - clickStartX, 2) + Math.pow(e.screenY - clickStartY, 2));
    if (dist < 4) {
      // It's a click! Show/hide the context Action Menu
      e.stopPropagation();
      if (onSelectBlock) {
        onSelectBlock(block.id, e.shiftKey);
      }
      if (!e.shiftKey) {
        showActionMenu = !showActionMenu;
      }
    }
  }

  function handleDragStartLocal(e) {
    dragStartFired = true;
    showActionMenu = false;
    onDragStart(e);
  }

  function handleActionDelete() {
    if (selected && deleteSelectedBlocks) {
      deleteSelectedBlocks(selectedBlockIds);
    } else {
      deleteBlock(index);
    }
    showActionMenu = false;
  }

  function handleActionDuplicate() {
    if (selected && duplicateSelectedBlocks) {
      duplicateSelectedBlocks(selectedBlockIds);
    } else {
      if (duplicateBlock) {
        duplicateBlock(index);
      } else {
        // Fallback local duplicate via parent addBlockAfter
        addBlockAfter(index, JSON.parse(JSON.stringify(block.content)));
      }
    }
    showActionMenu = false;
  }

  function handleActionTurnInto(type) {
    applyTurnInto(type);
    showActionMenu = false;
  }

  function handleActionRename() {
    modalNameVal = block.name || '';
    showNameModal = true;
    validateModalName(modalNameVal);
    showActionMenu = false;
  }

  // Click outside listener for Action Menu
  function handleWindowClick(e) {
    if (showActionMenu && !e.target.closest('.action-menu-card')) {
      showActionMenu = false;
    }
  }

  function handleWindowKeyDown(e) {
    if (e.key === 'Escape') {
      showActionMenu = false;
    }
  }
</script>

<svelte:window 
  onclick={handleWindowClick} 
  onkeydown={handleWindowKeyDown} 
/>

<div 
  class="block-editor-row type-{block.type}"
  class:is-first-block={isFirst}
  class:is-placed={block.canvas !== null}
  class:has-name={block.name}
  class:is-selected={selected}
  data-block-id={block.id}
  bind:this={rowElement}
>
  <!-- Gutter Controls: Visible on hover -->
  <div class="block-gutter" contenteditable="false">
    <button 
      type="button" 
      class="gutter-btn add-btn" 
      onclick={() => addBlockAfter(index)}
      title="Add block below"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
    <div 
      class="gutter-btn drag-handle" 
      draggable="true"
      ondragstart={handleDragStartLocal}
      ondragend={onDragEnd}
      onmousedown={handleHandleMouseDown}
      onmouseup={handleHandleMouseUp}
      role="button"
      tabindex="-1"
      aria-label="Drag to reorder or click for actions"
      title="Drag to reorder, click for actions"
    >
      ⠿
    </div>
  </div>

  <!-- Green @name badge -->
  {#if block.name}
    <div class="block-name-badge" contenteditable="false">
      <span class="badge-text">@{block.name}</span>
      <button type="button" class="block-name-clear-btn" onclick={() => updateBlock(current.index, { name: null })} title="Remove name">×</button>
    </div>
  {/if}

  <!-- Tiptap Editor Wrapper -->
  <div 
    class="editor-wrapper" 
    bind:this={editorElement}
  ></div>

  <!-- Bubble Menu Dropdown -->
  {#if showBubbleMenu}
    <div 
      class="bubble-menu-card" 
      style="position: absolute; left: {bubbleMenuCoords.left}px; top: {bubbleMenuCoords.top}px;"
    >
    <div class="bubble-row">
      <!-- Color Picker -->
      <div class="color-picker-wrapper" title="Text Color">
        <input 
          type="color" 
          id="color-input-{index}" 
          value={currentColor} 
          onchange={handleColorChange} 
          class="color-input" 
        />
        <label for="color-input-{index}" class="color-label">
          A
          <span class="color-indicator" style="background-color: {currentColor};"></span>
        </label>
      </div>

      <div class="bubble-separator"></div>

      <!-- Format Buttons -->
      <button 
        type="button" 
        class="bubble-btn" 
        class:active={isBold} 
        onclick={toggleBold}
        title="Bold"
      >
        B
      </button>
      <button 
        type="button" 
        class="bubble-btn" 
        class:active={isItalic} 
        onclick={toggleItalic}
        title="Italic"
      >
        I
      </button>
      <button 
        type="button" 
        class="bubble-btn" 
        class:active={isUnderline} 
        onclick={toggleUnderline}
        title="Underline"
      >
        U
      </button>
      <button 
        type="button" 
        class="bubble-btn" 
        class:active={isStrike} 
        onclick={toggleStrike}
        title="Strikethrough"
      >
        S
      </button>

      <div class="bubble-separator"></div>

      <!-- Font Dropdown -->
      <select class="font-select" value={currentFont} onchange={handleFontChange} title="Font Family">
        <option value="Default">Default</option>
        <option value="Inter">Inter</option>
        <option value="Lora">Lora</option>
        <option value="Playfair Display">Playfair Display</option>
        <option value="Space Grotesk">Space Grotesk</option>
        <option value="Fira Code">Fira Code</option>
        <option value="Outfit">Outfit</option>
      </select>

      <div class="bubble-separator"></div>

      <!-- Turn Into subpanel trigger -->
      <button 
        type="button" 
        class="bubble-btn turn-into-trigger" 
        onclick={() => showTurnIntoPanel = !showTurnIntoPanel}
        class:active={showTurnIntoPanel}
      >
        Turn into {showTurnIntoPanel ? '‹' : '›'}
      </button>
    </div>

    <!-- Turn Into Subpanel -->
    {#if showTurnIntoPanel}
      <div class="bubble-subpanel">
        <button type="button" class="subpanel-btn" onclick={() => applyTurnInto('paragraph')}>
          <span class="subpanel-icon">¶</span> Text
        </button>
        <button type="button" class="subpanel-btn" onclick={() => applyTurnInto('h1')}>
          <span class="subpanel-icon">H1</span> Heading 1
        </button>
        <button type="button" class="subpanel-btn" onclick={() => applyTurnInto('h2')}>
          <span class="subpanel-icon">H2</span> Heading 2
        </button>
        <button type="button" class="subpanel-btn" onclick={() => applyTurnInto('h3')}>
          <span class="subpanel-icon">H3</span> Heading 3
        </button>
      </div>
    {/if}
    </div>
  {/if}

  <!-- Slash Command Menu Dropdown -->
  {#if showSlashMenu && filteredItems.length > 0}
    <div 
      class="slash-menu-card" 
      style="left: {slashMenuCoords.left}px; top: {slashMenuCoords.top}px;"
    >
      {#each filteredItems as item, idx}
        <button 
          type="button" 
          class="slash-menu-item" 
          class:highlighted={idx === highlightedIndex}
          onclick={() => applySlashItem(item)}
        >
          <div class="slash-item-icon">{item.icon}</div>
          <div class="slash-item-content">
            <div class="slash-item-label">{item.label}</div>
            <div class="slash-item-desc">{item.desc}</div>
          </div>
        </button>
      {/each}
    </div>
  {/if}

  <!-- @ Name-trigger Dropdown -->
  {#if showAtMenu}
    <div
      class="at-menu-card"
      style="left:{atMenuCoords.left}px;top:{atMenuCoords.top}px;"
    >
      <button type="button" class="at-menu-item" onclick={applyAtMention}>
        <div class="at-menu-icon">@</div>
        <div class="at-menu-content">
          <div class="at-menu-label">Name this block</div>
          <div class="at-menu-desc">{atText ? `Set name to "@${atText}"` : 'Keep typing a name…'}</div>
        </div>
        <kbd class="at-menu-hint">↵</kbd>
      </button>
    </div>
  {/if}

  <!-- Action Menu (Click Handle Context Menu) -->
  {#if showActionMenu}
    <div 
      class="action-menu-card" 
      style="position: absolute; left: 52px; top: 8px;"
    >
      <button type="button" class="action-menu-btn delete-action" onclick={handleActionDelete}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete block
      </button>
      <button type="button" class="action-menu-btn" onclick={handleActionDuplicate}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
        Duplicate block
      </button>
      
      <div class="action-menu-divider"></div>
      <button type="button" class="action-menu-btn" onclick={handleActionRename}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
        </svg>
        {block.name ? `Rename (@${block.name})` : 'Name block'}
      </button>

      <div class="action-menu-section-header">Turn into</div>
      
      <button type="button" class="action-menu-btn" onclick={() => handleActionTurnInto('paragraph')}>
        <span class="action-menu-icon">¶</span> Text
      </button>
      <button type="button" class="action-menu-btn" onclick={() => handleActionTurnInto('h1')}>
        <span class="action-menu-icon">H1</span> Heading 1
      </button>
      <button type="button" class="action-menu-btn" onclick={() => handleActionTurnInto('h2')}>
        <span class="action-menu-icon">H2</span> Heading 2
      </button>
      <button type="button" class="action-menu-btn" onclick={() => handleActionTurnInto('h3')}>
        <span class="action-menu-icon">H3</span> Heading 3
      </button>
    </div>
  {/if}
</div>

{#if showNameModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="name-modal-backdrop" onclick={closeModal} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="name-modal-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="name-modal-header">
        <h3 class="name-modal-title">Name Block</h3>
        <button type="button" class="name-modal-close-icon" onclick={closeModal}>×</button>
      </div>
      <div class="name-modal-body">
        <label for="block-name-input-{index}" class="name-modal-label">Assign an @name to reference this block</label>
        <div class="name-modal-input-wrapper">
          <span class="name-modal-at">@</span>
          <input
            id="block-name-input-{index}"
            type="text"
            class="name-modal-input"
            class:is-invalid={modalNameError}
            placeholder="e.g. contact-section"
            value={modalNameVal}
            oninput={handleModalNameInput}
            onkeydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveModalName(); }
              else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
            }}
            bind:this={modalInputEl}
          />
        </div>
        {#if modalNameError}
          <div class="name-modal-error-msg">{modalNameError}</div>
        {:else if modalNameVal.trim()}
          <div class="name-modal-success-msg">✓ Name is valid and unique</div>
        {/if}
      </div>
      <div class="name-modal-footer">
        <button type="button" class="name-modal-btn cancel-btn" onclick={closeModal}>Cancel</button>
        <button type="button" class="name-modal-btn save-btn" onclick={saveModalName} disabled={!!modalNameError}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .block-editor-row {
    display: flex;
    position: relative;
    padding: 4px 0;
    width: 100%;
    align-items: flex-start;
  }

  .block-editor-row.is-selected {
    background-color: rgba(35, 131, 226, 0.12) !important;
  }

  /* Left-edge accent bar: indicates the block is placed on the canvas */
  .block-editor-row::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background-color: transparent;
    transition: background-color 0.2s ease;
  }

  .block-editor-row.is-placed::before {
    background-color: #10b981; /* emerald-500 */
  }

  /* Gutter setup */
  .block-gutter {
    width: 48px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding-right: 8px;
    height: 1.6em; /* Align with first line of paragraph/heading line-height */
    user-select: none;
    opacity: 0;
    transition: opacity 0.1s ease-in-out;
  }

  .block-editor-row:hover .block-gutter {
    opacity: 1;
  }

  .gutter-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--notion-text-muted);
    transition: background 0.15s, color 0.15s;
  }

  .gutter-btn:hover {
    background-color: var(--notion-hover);
    color: var(--notion-text);
  }

  .add-btn {
    width: 18px;
    height: 18px;
  }

  .drag-handle {
    width: 18px;
    height: 18px;
    font-size: 16px;
    font-weight: 700;
    cursor: grab;
    line-height: 1;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .editor-wrapper {
    flex: 1;
    min-width: 0;
  }

  /* Typography Styles (PRD Section 10) */
  :global(.editor-wrapper .ProseMirror) {
    color: var(--notion-text);
    font-family: var(--font-sans);
  }

  .type-paragraph :global(.editor-wrapper .ProseMirror p) {
    font-size: 16px;
    font-weight: 400;
    line-height: 1.6;
  }

  .type-h1 :global(.editor-wrapper .ProseMirror h1) {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.3;
    color: #37352f;
  }

  .type-h2 :global(.editor-wrapper .ProseMirror h2) {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.35;
    color: #37352f;
  }

  .type-h3 :global(.editor-wrapper .ProseMirror h3) {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: #37352f;
  }

  /* Placeholders: Section 10 rules */
  .type-h1 :global(.editor-wrapper h1.is-editor-empty:first-child::before) { content: "Heading 1"; }
  .type-h2 :global(.editor-wrapper h2.is-editor-empty:first-child::before) { content: "Heading 2"; }
  .type-h3 :global(.editor-wrapper h3.is-editor-empty:first-child::before) { content: "Heading 3"; }
  
  /* First block paragraph placeholder shown always when empty */
  .is-first-block :global(.editor-wrapper p.is-editor-empty:first-child::before) {
    content: "Type '/' for commands" !important;
    display: block !important;
  }

  /* Other blocks: placeholder shown on focus only */
  .block-editor-row:not(.is-first-block):not(:focus-within) :global(.editor-wrapper p.is-editor-empty:first-child::before) {
    display: none !important;
  }

  /* Bubble Menu styling */
  .bubble-menu-card {
    background-color: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 8px;
    box-shadow: var(--notion-menu-shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }

  .bubble-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .bubble-separator {
    width: 1px;
    height: 18px;
    background-color: var(--notion-border);
    margin: 0 4px;
  }

  .bubble-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
    color: var(--notion-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.1s, color 0.1s;
  }

  .bubble-btn:hover {
    background-color: var(--notion-hover);
  }

  .bubble-btn.active {
    background-color: var(--notion-blue-bg);
    color: var(--notion-blue);
  }

  /* Bubble Menu Color Swatch */
  .color-picker-wrapper {
    position: relative;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .color-input {
    position: absolute;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }

  .color-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--notion-text);
    position: relative;
    user-select: none;
    z-index: 1;
  }

  .color-picker-wrapper:hover .color-label {
    background-color: var(--notion-hover);
  }

  .color-indicator {
    position: absolute;
    bottom: 4px;
    left: 6px;
    right: 6px;
    height: 3px;
    border-radius: 1px;
  }

  /* Bubble Menu Font Dropdown */
  .font-select {
    border: none;
    background: transparent;
    outline: none;
    font-size: 12px;
    color: var(--notion-text);
    font-weight: 500;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    max-width: 100px;
  }

  .font-select:hover {
    background-color: var(--notion-hover);
  }

  .turn-into-trigger {
    width: auto;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
  }

  /* Bubble Menu Subpanel */
  .bubble-subpanel {
    display: flex;
    gap: 4px;
    border-top: 1px solid var(--notion-border);
    margin-top: 6px;
    padding-top: 6px;
  }

  .subpanel-btn {
    flex: 1;
    border: none;
    background: transparent;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--notion-text);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: center;
  }

  .subpanel-btn:hover {
    background-color: var(--notion-hover);
  }

  .subpanel-icon {
    font-weight: 700;
    color: var(--notion-text-muted);
  }

  /* Slash Command Menu */
  .slash-menu-card {
    position: absolute;
    background-color: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 8px;
    box-shadow: var(--notion-menu-shadow);
    padding: 6px;
    min-width: 260px;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    z-index: 1002;
  }

  .slash-menu-item {
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    width: 100%;
    padding: 4px 8px;
    border-radius: 4px;
    text-align: left;
    gap: 8px;
    height: 44px;
  }

  .slash-menu-item.highlighted,
  .slash-menu-item:hover {
    background-color: var(--notion-hover);
  }

  .slash-item-icon {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    background-color: #f1f1f2;
    color: var(--notion-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .slash-item-content {
    display: flex;
    flex-direction: column;
  }

  .slash-item-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--notion-text);
    line-height: 1.2;
  }

  .slash-item-desc {
    font-size: 11px;
    color: var(--notion-text-muted);
    line-height: 1.2;
    margin-top: 1px;
  }

  /* Action Menu (Click Gutter Handle Context Menu) */
  .action-menu-card {
    background-color: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 8px;
    box-shadow: var(--notion-menu-shadow);
    padding: 6px;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    z-index: 1003;
  }

  .action-menu-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--notion-text);
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
  }

  .action-menu-btn:hover {
    background-color: var(--notion-hover);
  }

  .action-menu-btn.delete-action {
    color: #eb5757;
  }

  .action-menu-btn.delete-action:hover {
    background-color: rgba(235, 87, 87, 0.08);
  }

  .action-menu-btn svg {
    color: currentColor;
    flex-shrink: 0;
  }

  .action-menu-divider {
    height: 1px;
    background-color: var(--notion-border);
    margin: 4px 0;
  }

  .action-menu-section-header {
    font-size: 10px;
    font-weight: 600;
    color: var(--notion-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 12px;
  }

  .action-menu-icon {
    font-weight: 700;
    color: var(--notion-text-muted);
    width: 14px;
    text-align: center;
  }

  /* @ name-trigger dropdown */
  .at-menu-card {
    position: absolute;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 8px;
    box-shadow: var(--notion-menu-shadow);
    padding: 4px;
    min-width: 220px;
    z-index: 1002;
  }

  .at-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
  }

  .at-menu-item:hover {
    background-color: var(--notion-hover);
  }

  .at-menu-icon {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    background: linear-gradient(135deg, #d1fae5, #a7f3d0);
    color: #059669;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
    flex-shrink: 0;
  }

  .at-menu-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .at-menu-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--notion-text);
    line-height: 1.2;
  }

  .at-menu-desc {
    font-size: 11px;
    color: var(--notion-text-muted);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .at-menu-hint {
    font-size: 10px;
    font-family: var(--font-sans);
    color: var(--notion-text-muted);
    background: rgba(55, 53, 47, 0.06);
    border: 1px solid rgba(55, 53, 47, 0.15);
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  /* @name badge */
  .block-name-badge {
    position: absolute;
    top: 4px;
    right: 8px;
    background-color: #10b981;
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    user-select: none;
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }

  .block-name-clear-btn {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    border-radius: 2px;
    transition: color 0.15s, background-color 0.15s;
    pointer-events: auto;
  }

  .block-name-clear-btn:hover { color: #ffffff; background-color: rgba(0,0,0,0.2); }

  .block-editor-row.has-name .editor-wrapper { padding-right: 90px; }

  /* Name modal */
  .name-modal-backdrop {
    position: fixed;
    inset: 0;
    background-color: rgba(15,23,42,0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .name-modal-card {
    background: var(--notion-bg, #ffffff);
    border-radius: 12px;
    border: 1px solid var(--notion-border, #e2e8f0);
    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    width: 380px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalFadeIn 0.18s ease-out;
  }

  @keyframes modalFadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to   { opacity: 1; transform: scale(1); }
  }

  .name-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--notion-border, #f1f5f9);
  }

  .name-modal-title { font-size: 15px; font-weight: 600; color: var(--notion-text, #1e293b); margin: 0; }

  .name-modal-close-icon {
    background: transparent; border: none; font-size: 20px; color: #94a3b8;
    cursor: pointer; line-height: 1; padding: 0; transition: color 0.15s;
  }
  .name-modal-close-icon:hover { color: #475569; }

  .name-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 8px; }

  .name-modal-label { font-size: 12px; font-weight: 500; color: #64748b; }

  .name-modal-input-wrapper {
    display: flex;
    align-items: center;
    border: 1px solid var(--notion-border, #cbd5e1);
    border-radius: 6px;
    padding: 0 10px;
    background: #f8fafc;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .name-modal-input-wrapper:focus-within { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }

  .name-modal-at { color: #10b981; font-weight: bold; font-size: 14px; margin-right: 4px; user-select: none; }

  .name-modal-input {
    flex: 1; border: none; background: transparent;
    padding: 8px 0; font-size: 13.5px; color: var(--notion-text, #1e293b); outline: none;
  }
  .name-modal-input.is-invalid { color: #eb5757; }
  .name-modal-input-wrapper:has(.name-modal-input.is-invalid) { border-color: #eb5757; }
  .name-modal-input-wrapper:has(.name-modal-input.is-invalid):focus-within { box-shadow: 0 0 0 3px rgba(235,87,87,0.15); }

  .name-modal-error-msg   { font-size: 11px; color: #eb5757; margin-top: 2px; }
  .name-modal-success-msg { font-size: 11px; color: #10b981; margin-top: 2px; }

  .name-modal-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 20px; background: #f8fafc; border-top: 1px solid var(--notion-border, #f1f5f9);
  }

  .name-modal-btn {
    padding: 6px 14px; font-size: 12.5px; font-weight: 500; border-radius: 6px; cursor: pointer; transition: all 0.15s;
  }
  .name-modal-btn.cancel-btn { background: transparent; border: 1px solid var(--notion-border, #e2e8f0); color: #64748b; }
  .name-modal-btn.cancel-btn:hover { background: #f1f5f9; color: #334155; }
  .name-modal-btn.save-btn { background: #10b981; border: 1px solid #059669; color: white; }
  .name-modal-btn.save-btn:hover:not(:disabled) { background: #059669; }
  .name-modal-btn.save-btn:disabled { background: #cbd5e1; border-color: #cbd5e1; color: #94a3b8; cursor: not-allowed; }
</style>
