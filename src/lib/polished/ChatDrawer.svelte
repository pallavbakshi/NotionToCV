<!-- ChatDrawer.svelte -->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { StarterKit } from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Color } from '@tiptap/extension-color';
  import { FontFamily } from '@tiptap/extension-font-family';
  import { computeLayout, blockRectMm, initFonts } from '../layout/index.js';

  let {
    resumeId,
    blocks,
    pageTitle,
    paddingMm,
    templateName,
    themeColors,
    selectedBlockIds = [],
    stagedChatBlockIds = $bindable([]),
    onClose,
    stagedChanges = $bindable({}),
    stagedAttachments = $bindable([])
  } = $props();

  // Conversation history list and active conversation state
  let chatList = $state([]);
  let activeChatId = $state(null);
  let historyView = $state(false);

  // Message staging and generating state
  let inputText = $state('');
  let isGenerating = $state(false);
  let abortController = $state(null);
  let showAttachDropdown = $state(false);
  let renderError = $state('');
  let messageListEl = $state(null);

  let fileInputEl = $state(null);

  // Resizable drawer width state and handler
  let drawerWidth = $state(400); // Default width (wider than the old 340px)
  let isResizing = $state(false);

  function handleResizeStart(e) {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    isResizing = true;
    
    const startX = e.clientX;
    const startWidth = drawerWidth;

    function handleResizeMove(moveEvent) {
      const deltaX = startX - moveEvent.clientX; // Dragging left increases width
      const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));
      drawerWidth = newWidth;
    }

    function handleResizeEnd() {
      isResizing = false;
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeEnd);
    }

    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
  }

  // Active chat conversation computed details
  let activeChat = $derived(chatList.find(c => c.id === activeChatId));
  let messages = $derived(activeChat ? activeChat.messages : []);
  let chatMode = $derived(activeChat ? (activeChat.mode || 'chat') : 'chat');

  function setChatMode(newMode) {
    if (!activeChatId) return;
    chatList = chatList.map(c => {
      if (c.id === activeChatId) {
        return { ...c, mode: newMode };
      }
      return c;
    });
    saveChats();
  }

  // Monitor staged blocks triggered from outside
  $effect(() => {
    if (stagedChatBlockIds.length > 0) {
      forceAttachBlocks(stagedChatBlockIds);
      stagedChatBlockIds = [];
    }
  });

  // Explicit lightweight persistence to prevent write-storms and quota-crashes
  function saveChats() {
    if (!resumeId || chatList.length === 0) return;

    // Create a deep copy stripping base64 images and screenshots
    const cleanList = chatList.map(chat => ({
      ...chat,
      messages: chat.messages.map(msg => {
        if (msg.attachments && msg.attachments.length > 0) {
          return {
            ...msg,
            attachments: msg.attachments.map(att => {
              const cleanAtt = { ...att };
              if (cleanAtt.type === 'polished') {
                delete cleanAtt.screenshots;
              } else if (cleanAtt.type === 'file') {
                delete cleanAtt.fileData;
              }
              return cleanAtt;
            })
          };
        }
        return msg;
      })
    }));

    try {
      localStorage.setItem(`notionToCV_chats_${resumeId}`, JSON.stringify(cleanList));
    } catch (e) {
      console.error('Failed to persist chats to localStorage:', e);
    }
  }

  onMount(() => {
    // Initialize layout engine fonts (no-op if already loaded)
    initFonts().catch(e => console.error('Font init error:', e));

    // Load chats from localStorage
    try {
      const stored = localStorage.getItem(`notionToCV_chats_${resumeId}`);
      if (stored) {
        chatList = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading chats from localStorage', e);
    }

    // If no active chat, create one or select the latest
    if (chatList.length > 0) {
      activeChatId = chatList[0].id;
    } else {
      startNewConversation();
    }
  });

  onDestroy(() => {
    if (abortController) {
      abortController.abort();
    }
  });

  // Autoscroll to bottom
  $effect(() => {
    if (messages.length > 0 || isGenerating) {
      // Trigger scroll whenever messages or generating state updates
      scrollToBottom();
    }
  });

  async function scrollToBottom() {
    await tick();
    if (messageListEl) {
      messageListEl.scrollTop = messageListEl.scrollHeight;
    }
  }

  function startNewConversation() {
    const newChat = {
      id: 'chat_' + Math.random().toString(36).substring(2, 9),
      title: 'New Chat',
      messages: [],
      mode: 'chat',
      updatedAt: new Date().toISOString()
    };
    chatList = [newChat, ...chatList];
    activeChatId = newChat.id;
    historyView = false;
    stagedAttachments = [];
    inputText = '';
    scrollToBottom();
    saveChats();
  }

  function selectChat(id) {
    activeChatId = id;
    historyView = false;
    stagedAttachments = [];
    inputText = '';
    scrollToBottom();
  }

  function deleteChat(id, e) {
    e.stopPropagation();
    chatList = chatList.filter(c => c.id !== id);
    if (activeChatId === id) {
      if (chatList.length > 0) {
        activeChatId = chatList[0].id;
      } else {
        startNewConversation();
      }
    }
    if (chatList.length === 0) {
      localStorage.removeItem(`notionToCV_chats_${resumeId}`);
    } else {
      saveChats();
    }
  }

  // Add Attachments
  function removeAttachment(index) {
    stagedAttachments = stagedAttachments.filter((_, i) => i !== index);
  }

  // Attach selected blocks
  function attachSelectedBlocks() {
    if (selectedBlockIds.length === 0) return;
    const selectedBlocks = blocks.filter(b => selectedBlockIds.includes(b.id));
    if (selectedBlocks.length === 0) return;

    const label = selectedBlocks.length === 1 
      ? `Block: ${selectedBlocks[0].type}` 
      : `${selectedBlocks.length} blocks`;

    // Avoid duplicating exact same block context staging
    const alreadyAttached = stagedAttachments.some(
      a => a.type === 'block' && JSON.stringify(a.blockIds) === JSON.stringify(selectedBlockIds)
    );

    if (!alreadyAttached) {
      stagedAttachments = [
        ...stagedAttachments,
        {
          type: 'block',
          blockIds: [...selectedBlockIds],
          blocks: JSON.parse(JSON.stringify(selectedBlocks)),
          label
        }
      ];
    }
    showAttachDropdown = false;
  }

  // Attach all blocks
  function attachAllBlocks() {
    if (blocks.length === 0) return;
    const allBlockIds = blocks.map(b => b.id);
    const label = `All Blocks (${blocks.length})`;

    const alreadyAttached = stagedAttachments.some(
      a => a.type === 'block' && a.label.startsWith('All Blocks')
    );

    if (!alreadyAttached) {
      stagedAttachments = [
        ...stagedAttachments,
        {
          type: 'block',
          blockIds: allBlockIds,
          blocks: JSON.parse(JSON.stringify(blocks)),
          label
        }
      ];
    }
    showAttachDropdown = false;
  }

  // Attach Polished CV
  async function attachPolishedCV() {
    // Stage a loading chip
    const loadingId = 'loading_' + Math.random().toString(36).substring(2, 9);
    stagedAttachments = [
      ...stagedAttachments,
      {
        id: loadingId,
        type: 'polished',
        loading: true,
        label: 'Polished CV (Rendering...)'
      }
    ];
    showAttachDropdown = false;

    try {
      const response = await fetch('/api/screenshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          blocks,
          pageTitle,
          paddingMm,
          templateName,
          themeColors
        })
      });

      if (!response.ok) {
        throw new Error('Failed to render screenshots');
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      // Replace loading attachment with completed screenshots
      stagedAttachments = stagedAttachments.map(a => {
        if (a.id === loadingId) {
          return {
            type: 'polished',
            screenshots: result.screenshots,
            label: `Polished CV (${result.screenshots.length} Page${result.screenshots.length > 1 ? 's' : ''})`
          };
        }
        return a;
      });

    } catch (err) {
      console.error('Screenshot error:', err);
      renderError = 'Failed to render CV screenshots.';
      stagedAttachments = stagedAttachments.filter(a => a.id !== loadingId);
      setTimeout(() => { renderError = ''; }, 4000);
    }
  }

  // Attach external file (triggered by file input)
  function triggerFileInput() {
    fileInputEl?.click();
    showAttachDropdown = false;
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const isImage = file.type.startsWith('image/');

    reader.onload = (ev) => {
      const data = ev.target.result;
      stagedAttachments = [
        ...stagedAttachments,
        {
          type: 'file',
          fileName: file.name,
          fileType: isImage ? 'image' : 'text',
          fileData: data,
          label: `File: ${file.name}`
        }
      ];
    };

    reader.onerror = () => {
      renderError = `Failed to read file: ${file.name}`;
      setTimeout(() => { renderError = ''; }, 4000);
    };

    if (isImage) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }

  }

  // Agent Mode Tools & Helpers
  const AGENT_TOOLS = [
    {
      type: "function",
      function: {
        name: "read_block",
        description: "Read the content, layout, dimensions, styling, capacity, and neighbors of a specific resume block.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique ID of the block to read."
            }
          },
          required: ["id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "update_block_content",
        description: "Stage a change to a block's content using HTML (without CSS/inline styles). This automatically runs verification to check if the new content fits within the block's physical budget and capacity.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique ID of the block to update."
            },
            html_without_css: {
              type: "string",
              description: "The proposed text content as standard semantic HTML (e.g. using <p>, <strong>, <em>, <ul>, <li>). Do not include any styles, classes, inline CSS, or font declarations."
            }
          },
          required: ["id", "html_without_css"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_block_screenshot",
        description: "Capture and return a visual screenshot of the block as it currently renders on the CV canvas. Useful to verify density, layout, or line-wrapping details.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique ID of the block to screenshot."
            }
          },
          required: ["id"]
        }
      }
    }
  ];

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseHtmlToTiptapJson(html, blockType) {
    const isHeading = blockType === 'h1' || blockType === 'h2' || blockType === 'h3';
    const wrapperHtml = isHeading ? `<h${blockType[1]}>${html}</h${blockType[1]}>` : `<div>${html}</div>`;
    
    const tempEditor = new Editor({
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
        FontFamily
      ],
      content: wrapperHtml,
    });
    
    const json = tempEditor.getJSON();
    tempEditor.destroy();
    
    const firstChild = json.content?.[0];
    return firstChild?.content ?? [];
  }

  function parseTiptapJsonToHtml(content) {
    if (!content || !Array.isArray(content)) return '';
    return content.map(node => {
      if (node.type === 'text') {
        let text = escapeHtml(node.text || '');
        if (node.marks) {
          for (const mark of node.marks) {
            if (mark.type === 'bold') text = `<strong>${text}</strong>`;
            if (mark.type === 'italic') text = `<em>${text}</em>`;
            if (mark.type === 'underline') text = `<u>${text}</u>`;
            if (mark.type === 'strike') text = `<s>${text}</s>`;
          }
        }
        return text;
      } else if (node.type === 'hardBreak') {
        return '<br/>';
      }
      return '';
    }).join('');
  }

  function sanitizeHtmlWithoutCss(input) {
    const doc = new DOMParser().parseFromString(input || '', 'text/html');
    doc.body.querySelectorAll('*').forEach(el => {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('id');
    });
    return doc.body.innerHTML;
  }

  function canvasToRect(canvas, colWidth, paddingMm) {
    let left, width;
    if (canvas.colSpan === 0) {
      left = paddingMm + canvas.col * (colWidth + 4) + colWidth;
      width = 4;
    } else {
      left = paddingMm + canvas.col * (colWidth + 4);
      width = canvas.colSpan * colWidth + (canvas.colSpan - 1) * 4;
    }
    const top = paddingMm + canvas.row * 5;
    const height = canvas.rowSpan * 5;
    return { left, top, right: left + width, bottom: top + height };
  }

  function findNeighbors(blockId, blocksList, colWidth, paddingMm) {
    const block = blocksList.find(b => b.id === blockId);
    if (!block || !block.canvas) return { above: null, below: null, left: null, right: null };
    
    const pageNum = block.canvas.page;
    const rect = canvasToRect(block.canvas, colWidth, paddingMm);
    
    let bestAbove = null, bestBelow = null, bestLeft = null, bestRight = null;
    
    for (const b of blocksList) {
      if (!b.canvas || b.id === blockId || b.canvas.page !== pageNum) continue;
      const r = canvasToRect(b.canvas, colWidth, paddingMm);
      
      // Check above
      if (r.bottom <= rect.top && r.right > rect.left && r.left < rect.right) {
        if (!bestAbove || r.bottom > bestAbove.rect.bottom) {
          bestAbove = { block: b, rect: r };
        }
      }
      // Check below
      if (r.top >= rect.bottom && r.right > rect.left && r.left < rect.right) {
        if (!bestBelow || r.top < bestBelow.rect.top) {
          bestBelow = { block: b, rect: r };
        }
      }
      // Check left
      if (r.right <= rect.left && r.bottom > rect.top && r.top < rect.bottom) {
        if (!bestLeft || r.right > bestLeft.rect.right) {
          bestLeft = { block: b, rect: r };
        }
      }
      // Check right
      if (r.left >= rect.right && r.bottom > rect.top && r.top < rect.bottom) {
        if (!bestRight || r.left < bestRight.rect.left) {
          bestRight = { block: b, rect: r };
        }
      }
    }
    
    const formatNeighbor = (nb) => {
      if (!nb) return null;
      const text = nb.block.content?.map(n => n.text || '').join('') || '';
      return {
        id: nb.block.id,
        type: nb.block.type,
        name: nb.block.name,
        content_plaintext_snippet: text.slice(0, 60)
      };
    };
    
    return {
      above: formatNeighbor(bestAbove),
      below: formatNeighbor(bestBelow),
      left: formatNeighbor(bestLeft),
      right: formatNeighbor(bestRight)
    };
  }

  async function runAgentTool(name, args) {
    const PX_PER_MM = 96 / 25.4;
    const cw = (210 - 2 * paddingMm - 12) / 4;
    
    if (name === 'read_block') {
      const block = blocks.find(b => b.id === args.id);
      if (!block) {
        return { error: `Block ${args.id} not found` };
      }
      
      const plaintext = block.content?.map(node => node.text || '').join('') || '';
      const contentHtmlEl = document.querySelector(`[data-block-id="${block.id}"] .block-content-container`);
      const renderedHtml = contentHtmlEl ? contentHtmlEl.innerHTML : '';
      
      let appliedStyles = {};
      if (contentHtmlEl) {
        const computed = window.getComputedStyle(contentHtmlEl);
        appliedStyles = {
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          lineHeight: computed.lineHeight,
          padding: computed.padding
        };
      }
      
      const isPlaced = !!block.canvas;
      let capacity = null;
      let widthMm = 0;
      let heightMm = 0;

      if (isPlaced) {
        const rect = blockRectMm(block.canvas, paddingMm);
        widthMm = rect.widthMm;
        heightMm = rect.heightMm;
        const ctx = { templateName, paddingMm, themeColors };
        const lo = computeLayout(block, rect, ctx);

        capacity = {
          max_lines: lo.maxLines,
          approx_characters_per_line: null,
          current_lines_used: lo.lines.length,
          lines_remaining: lo.linesRemaining,
          is_overflowing: lo.overflow
        };
      }
      
      const neighbors = findNeighbors(block.id, blocks, cw, paddingMm);
      
      return {
        id: block.id,
        type: block.type,
        name: block.name,
        placement_status: isPlaced
          ? 'placed — block is on the A4 canvas and has a fixed spatial budget'
          : 'unplaced — block exists in the Notion editor but has not been added to the canvas yet; spatial budget is unknown and content length is unconstrained',
        canvas: block.canvas,
        widthMm: isPlaced ? widthMm : null,
        heightMm: isPlaced ? heightMm : null,
        plaintext,
        capacity: isPlaced ? capacity : 'N/A — block is unplaced; no spatial budget to check against. You may still propose content edits but cannot verify fit until the block is placed on the canvas.',
        rendered_html_reference: renderedHtml || null,
        applied_styles: Object.keys(appliedStyles).length > 0 ? appliedStyles : null,
        neighbors: isPlaced ? neighbors : 'N/A — unplaced blocks have no canvas neighbors'
      };
      
    } else if (name === 'update_block_content') {
      const block = blocks.find(b => b.id === args.id);
      if (!block) {
        return { error: `Block ${args.id} not found` };
      }
      
      const sanitizedHtml = sanitizeHtmlWithoutCss(args.html_without_css);
      const proposedContent = parseHtmlToTiptapJson(sanitizedHtml, block.type);
      
      stagedChanges = {
        ...stagedChanges,
        [block.id]: {
          originalContent: block.content,
          proposedContent,
          proposedHtml: sanitizedHtml
        }
      };
      
      let capacity = {
        max_lines: null,
        current_lines_used: null,
        lines_remaining: null,
        is_overflowing: false,
        message: "Block is not currently placed on canvas"
      };
      
      if (block.canvas) {
        const rect = blockRectMm(block.canvas, paddingMm);
        const ctx = { templateName, paddingMm, themeColors };
        
        // Build a temporary block with proposed content to measure fit
        const proposedBlock = { ...block, content: proposedContent };
        const lo = computeLayout(proposedBlock, rect, ctx);
        
        capacity = {
          max_lines: lo.maxLines,
          current_lines_used: lo.lines.length,
          lines_remaining: lo.linesRemaining,
          is_overflowing: lo.overflow
        };
      }
      
      return {
        status: "success",
        staged: true,
        capacity
      };
      
    } else if (name === 'get_block_screenshot') {
      const block = blocks.find(b => b.id === args.id);
      if (!block) {
        return { error: `Block ${args.id} not found` };
      }
      
      try {
        const response = await fetch('/api/screenshot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            blocks,
            pageTitle,
            paddingMm,
            templateName,
            themeColors,
            blockId: block.id
          })
        });
        
        if (!response.ok) {
          throw new Error(await response.text());
        }
        
        const result = await response.json();
        return {
          status: "success",
          blockId: block.id,
          screenshot_base64: result.screenshot
        };
      } catch (err) {
        console.error('Screenshot tool failed:', err);
        return { error: `Screenshot failed: ${err.message}` };
      }
    }
    
    return { error: `Unknown tool: ${name}` };
  }

  function getAgentSystemPrompt() {
    const outline = blocks.map((b, i) => {
      const isPlaced = b.canvas !== null;
      const posText = isPlaced 
        ? `Page ${b.canvas.page}, Col ${b.canvas.col}, Row ${b.canvas.row} (Span ${b.canvas.colSpan}x${b.canvas.rowSpan})`
        : 'Unplaced';
      const textContent = b.content?.map(node => node.text || '').join('') || '';
      return `${i + 1}. [ID: ${b.id}] Type: ${b.type}${b.name ? ` (Name: @${b.name})` : ''} - [${posText}] - Content: "${textContent}"`;
    }).join('\n');

    let cleanHtml = '';
    const pagesEl = document.querySelector('.pages-list');
    if (pagesEl) {
      const clone = pagesEl.cloneNode(true);
      clone.querySelectorAll('.floating-toolbar, .hover-drag-handle, .resize-handle, .grid-overlay').forEach(el => el.remove());
      cleanHtml = clone.innerHTML;
    }

    const themeStyleEl = document.getElementById('theme-color-overrides');
    const themeStyles = themeStyleEl ? themeStyleEl.textContent : '';

    return `You are Antigravity CV Editor Agent, an expert AI resume editor.
You are helping the user edit their resume using tools to read and propose changes to blocks.

Here is the full Notion view of the resume (every block's ID, type, name, canvas position, and content):
Title: ${pageTitle || 'Untitled Resume'}
Outline & Content:
${outline}

Here is the clean rendered HTML structure of the A4 polished CV pages (reflecting committed blocks):
\`\`\`html
${cleanHtml}
\`\`\`

Here are the custom CSS overrides applied to the pages:
\`\`\`css
${themeStyles}
\`\`\`

Guidelines:
1. You are in Agent Mode. You have tools to read, update block content, and take screenshots.
2. Use 'read_block' to get full details of a block including styling, spatial capacity, and neighbors.
3. Use 'update_block_content' to propose modifications to block text. Specify semantic HTML (e.g. <p>, <strong>, <em>, <ul>, <li>). Do not include any styles or CSS.
4. Your proposed changes will be STAGED as red/green inline diffs in the Notion pane. The user will accept or deny them.
5. Respect the block spatial budget! Always check capacity numbers returned by update_block_content or read_block to ensure your revisions fit. Avoid overflowing blocks.
6. When referencing blocks, use their ID or name (e.g. @contact-section).
7. Respond to the user with a summary of the edits you proposed or explanation of why you made them.`;
  }

  // Generate system prompt context outline
  function getSystemPromptOutline() {
    const outline = blocks.map((b, i) => {
      const isPlaced = b.canvas !== null;
      const posText = isPlaced 
        ? `Page ${b.canvas.page}, Col ${b.canvas.col}, Row ${b.canvas.row} (Span ${b.canvas.colSpan}x${b.canvas.rowSpan})`
        : 'Unplaced';
      return `${i + 1}. [ID: ${b.id}] Type: ${b.type}${b.name ? ` (Name: @${b.name})` : ''} - [${posText}]`;
    }).join('\n');

    return `You are Antigravity CV Assistant, an expert career document reviewer and career coach.
You are helping the user review and polish their resume.
Here is the baseline structure of their resume (only block types, IDs, names, and visual layout coordinates, NOT the full text content):
Title: ${pageTitle || 'Untitled Resume'}
Resume Outline:
${outline}

Guidelines:
1. You are strictly in a READ-ONLY conversational feedback layer. You cannot mutate the document.
2. If the user asks about specific content, you can only see the content of blocks, files, or screenshots that are explicitly ATTACHED to their messages as context chips.
3. If you need to see more blocks to give accurate feedback, ask the user to select them or attach the "Polished CV" or the blocks.
4. When referring to a specific block, you may use its type, name, or position.
5. Provide detailed, actionable career-focused feedback in clear prose. Use Markdown for formatting (bold, lists, headers, etc.) to make your responses readable.`;
  }

  // Send Message
  // Send Message
  async function sendMessage() {
    if (!inputText.trim() && stagedAttachments.length === 0) return;
    if (isGenerating) return;

    // Check if any attachment is currently rendering
    const hasLoading = stagedAttachments.some(a => a.loading);
    if (hasLoading) return;

    isGenerating = true;
    abortController = new AbortController();

    const queryText = inputText;
    inputText = '';

    const attachmentsToSend = [...stagedAttachments];
    stagedAttachments = [];

    // Create user message
    const userMsg = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: queryText,
      attachments: attachmentsToSend,
      timestamp: new Date().toISOString()
    };

    // Update local state to show user message immediately
    chatList = chatList.map(c => {
      if (c.id === activeChatId) {
        const currentTitle = c.title === 'New Chat' ? (queryText.slice(0, 30) || 'Review Resume') : c.title;
        return {
          ...c,
          title: currentTitle,
          messages: [...c.messages, userMsg],
          updatedAt: new Date().toISOString()
        };
      }
      return c;
    });

    saveChats();

    const systemPrompt = chatMode === 'agent' ? getAgentSystemPrompt() : getSystemPromptOutline();
    const activeModel = chatMode === 'agent' ? 'anthropic/claude-sonnet-4-5' : 'google/gemini-2.5-flash';

    // Map history payload
    const historyPayload = [];
    const activeChatRef = chatList.find(c => c.id === activeChatId);
    const pastMessages = activeChatRef ? activeChatRef.messages : [];

    for (const msg of pastMessages) {
      if (msg.role === 'assistant') {
        const item = { role: 'assistant', content: msg.content || null };
        if (msg.tool_calls) {
          item.tool_calls = msg.tool_calls;
        }
        historyPayload.push(item);
      } else if (msg.role === 'tool' && msg.isToolResult) {
        historyPayload.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          content: msg.content
        });
      } else if (msg.role === 'tool_call') {
        // Skip visual tool call status helpers
      } else if (msg.role === 'user') {
        let textPart = msg.content;
        
        // Append block contents if attached
        const blocksAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'block') : [];
        if (blocksAttached.length > 0) {
          textPart += '\n\n[Attached Blocks Content]:';
          blocksAttached.forEach(att => {
            if (att.blocks && Array.isArray(att.blocks)) {
              att.blocks.forEach(b => {
                const bText = b?.content ? b.content.map(c => c?.text ?? '').join('') : '';
                textPart += `\n- Block ID ${b?.id ?? 'unknown'} (${b?.type ?? 'unknown'}): "${bText}"`;
              });
            }
          });
        }

        // Append denied block rejections if attached
        const deniedAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'denied') : [];
        if (deniedAttached.length > 0) {
          textPart += '\n\n[User Rejections]:';
          deniedAttached.forEach(att => {
            textPart += `\n- Proposed content change for Block ID ${att.blockId} has been explicitly REJECTED/DENIED by the user. They did not approve this proposed revision. Please think of another wording/strategy or ask how they want it instead.`;
          });
        }

        // Append text files if attached
        const filesAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'file' && a.fileType === 'text') : [];
        if (filesAttached.length > 0) {
          textPart += '\n\n[Attached Text Files]:';
          filesAttached.forEach(att => {
            if (att.fileData && att.fileName) {
              textPart += `\n- File: ${att.fileName}\nContent:\n${att.fileData}`;
            } else if (att.fileName) {
              textPart += `\n- File: ${att.fileName} (content stripped for storage)`;
            }
          });
        }

        const msgContent = [{ type: 'text', text: textPart }];

        // Append screenshots
        const screenshotsAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'polished') : [];
        screenshotsAttached.forEach(att => {
          if (att.screenshots && Array.isArray(att.screenshots)) {
            att.screenshots.forEach(s => {
              if (s) {
                msgContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s}` } });
              }
            });
          } else {
            msgContent.push({ type: 'text', text: '\n[Attached Polished CV (visual rendering stripped for storage)]' });
          }
        });

        // Append uploaded image files
        const imagesAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'file' && a.fileType === 'image') : [];
        imagesAttached.forEach(att => {
          if (att.fileData) {
            msgContent.push({ type: 'image_url', image_url: { url: att.fileData } });
          } else if (att.fileName) {
            msgContent.push({ type: 'text', text: `\n[Attached Image: ${att.fileName} (stripped for storage)]` });
          }
        });

        historyPayload.push({ role: 'user', content: msgContent });
      }
    }

    async function runGeneration(currentHistory) {
      if (abortController?.signal?.aborted) return;

      const requestPayload = {
        messages: currentHistory,
        systemPrompt,
        model: activeModel
      };

      if (chatMode === 'agent') {
        requestPayload.tools = AGENT_TOOLS;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let contentAccumulated = '';
      let toolCallsAccumulated = [];

      const assistantMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
      const assistantMsg = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString()
      };

      chatList = chatList.map(c => {
        if (c.id === activeChatId) {
          return {
            ...c,
            messages: [...c.messages, assistantMsg]
          };
        }
        return c;
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;

              // 1. Accumulate text content
              const text = delta?.content || '';
              if (text) {
                contentAccumulated += text;
                chatList = chatList.map(c => {
                  if (c.id === activeChatId) {
                    return {
                      ...c,
                      messages: c.messages.map(m => m.id === assistantMsgId ? { ...m, content: contentAccumulated } : m)
                    };
                  }
                  return c;
                });
              }

              // 2. Accumulate tool calls (OpenAI format: function.name / function.arguments)
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallsAccumulated[idx]) {
                    toolCallsAccumulated[idx] = {
                      id: tc.id || '',
                      type: 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: ''
                      }
                    };
                  }
                  if (tc.id) toolCallsAccumulated[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAccumulated[idx].function.name = tc.function.name;
                  if (tc.function?.arguments) {
                    toolCallsAccumulated[idx].function.arguments += tc.function.arguments;
                  }
                }
              }
            } catch (e) {
              // Ignore partial parsing errors
            }
          }
        }
      }

      // Clean up empty placeholder if only tool calls were received
      if (!contentAccumulated && toolCallsAccumulated.length > 0) {
        chatList = chatList.map(c => {
          if (c.id === activeChatId) {
            return {
              ...c,
              messages: c.messages.filter(m => m.id !== assistantMsgId)
            };
          }
          return c;
        });
      }

      saveChats();

      const completedToolCalls = toolCallsAccumulated.filter(Boolean);

      if (completedToolCalls.length > 0) {
        // Construct tool calls for history
        const assistantToolCallMsg = {
          role: 'assistant',
          content: contentAccumulated || null,
          tool_calls: completedToolCalls
        };

        const nextHistory = [...currentHistory, assistantToolCallMsg];

        // Status msg in UI
        const toolCallStatusMsg = {
          id: 'msg_' + Math.random().toString(36).substring(2, 9),
          role: 'tool_call',
          content: `Running agent tools: ${completedToolCalls.map(t => t.function?.name).join(', ')}...`,
          timestamp: new Date().toISOString()
        };

        chatList = chatList.map(c => {
          if (c.id === activeChatId) {
            return { ...c, messages: [...c.messages, toolCallStatusMsg] };
          }
          return c;
        });

        const toolResultMessagesForHistory = [];

        for (const tc of completedToolCalls) {
          const tcName = tc.function?.name || '';
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function?.arguments || '{}');
          } catch (e) {}

          const stepMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
          const stepMsg = {
            id: stepMsgId,
            role: 'tool_call',
            tool_call_id: tc.id,
            name: tcName,
            content: `⚙️ Tool use: ${tcName}(${Object.keys(parsedArgs).length ? JSON.stringify(parsedArgs) : ''})...`,
            timestamp: new Date().toISOString()
          };

          chatList = chatList.map(c => {
            if (c.id === activeChatId) {
              return { ...c, messages: [...c.messages, stepMsg] };
            }
            return c;
          });

          const result = await runAgentTool(tcName, parsedArgs);

          // Create the real tool result message for persistence
          const toolResultMsg = {
            id: 'msg_' + Math.random().toString(36).substring(2, 9),
            role: 'tool',
            isToolResult: true,
            tool_call_id: tc.id,
            name: tcName,
            content: JSON.stringify(result),
            timestamp: new Date().toISOString()
          };

          // Update step msg status text in UI and append raw result message
          chatList = chatList.map(c => {
            if (c.id === activeChatId) {
              return {
                ...c,
                messages: [
                  ...c.messages.map(m => m.id === stepMsgId ? { ...m, content: `⚙️ Executed tool ${tcName}` } : m),
                  toolResultMsg
                ]
              };
            }
            return c;
          });

          toolResultMessagesForHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(result)
          });
        }

        saveChats();
        await runGeneration([...nextHistory, ...toolResultMessagesForHistory]);
      }
    }

    try {
      await runGeneration(historyPayload);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Stream generation aborted');
      } else {
        console.error('Chat error:', err);
        chatList = chatList.map(c => {
          if (c.id === activeChatId) {
            const updatedMessages = [...c.messages];
            const lastMsg = updatedMessages[updatedMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += `\n\n*Error: Failed to fetch response. (${err.message})*`;
            } else {
              updatedMessages.push({
                id: 'msg_' + Math.random().toString(36).substring(2, 9),
                role: 'assistant',
                content: `*Error: Failed to fetch response. (${err.message})*`,
                timestamp: new Date().toISOString()
              });
            }
            return { ...c, messages: updatedMessages };
          }
          return c;
        });
        saveChats();
      }
    } finally {
      isGenerating = false;
      abortController = null;
    }
  }

  function stopGeneration() {
    if (abortController) {
      abortController.abort();
      isGenerating = false;
      abortController = null;
      saveChats();
    }
  }

  // Markdown rendering engine
  function renderMarkdown(text) {
    if (!text) return '';
    // Escape HTML to prevent basic XSS
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Extract and preserve code blocks/inline code before other transformations
    const codeBlocks = [];
    escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return `\x00CBBLOCK${codeBlocks.length - 1}\x00`;
    });
    escaped = escaped.replace(/`([^`]+)`/g, (_, code) => {
      codeBlocks.push(`<code>${code}</code>`);
      return `\x00CBINLINE${codeBlocks.length - 1}\x00`;
    });

    // Handle bold (**text**)
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Handle italic (*text*)
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Handle headings
    escaped = escaped.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Handle list items
    let lines = escaped.split('\n');
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const content = line.substring(2);
        if (!inList) {
          lines[i] = '<ul><li>' + content + '</li>';
          inList = true;
        } else {
          lines[i] = '<li>' + content + '</li>';
        }
      } else {
        if (inList) {
          lines[i] = '</ul>' + lines[i];
          inList = false;
        }
      }
    }
    if (inList) {
      lines[lines.length - 1] += '</ul>';
    }
    escaped = lines.join('\n');

    // Convert double newline to paragraph, single newline to break
    escaped = escaped.split('\n\n').map(para => {
      const trimmed = para.trim();
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<pre>') || trimmed.startsWith('\x00CBBLOCK')) {
        return para;
      }
      return '<p>' + para.replace(/\n/g, '<br/>') + '</p>';
    }).join('');

    // Restore code blocks and inline code
    escaped = escaped.replace(/\x00CB(BLOCK|INLINE)(\d+)\x00/g, (_, type, i) => codeBlocks[parseInt(i)]);

    return escaped;
  }

  // Pre-fill block attachments from outside event
  export function forceAttachBlocks(blockIds) {
    if (!blockIds || blockIds.length === 0) return;
    const selectedBlocks = blocks.filter(b => blockIds.includes(b.id));
    if (selectedBlocks.length === 0) return;

    const label = selectedBlocks.length === 1 
      ? `Block: ${selectedBlocks[0].type}` 
      : `${selectedBlocks.length} blocks`;

    const alreadyAttached = stagedAttachments.some(
      a => a.type === 'block' && JSON.stringify(a.blockIds) === JSON.stringify(blockIds)
    );

    if (!alreadyAttached) {
      stagedAttachments = [
        ...stagedAttachments,
        {
          type: 'block',
          blockIds: [...blockIds],
          blocks: JSON.parse(JSON.stringify(selectedBlocks)),
          label
        }
      ];
    }
  }

  // Pre-fill polished CV attachment from outside event
  export function forceAttachPolishedCV() {
    attachPolishedCV();
  }
</script>

<div
  class="chat-drawer"
  style="width: {drawerWidth}px;"
  role="dialog"
  aria-modal="false"
  aria-label="Chat drawer"
  tabindex="-1"
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  <!-- Resize handle: positioned absolutely on the left edge of the drawer -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="resize-handle" 
    class:is-resizing={isResizing}
    onpointerdown={handleResizeStart}
  ></div>
  <div class="drawer-header">
    {#if historyView}
      <h3>💬 Chat History</h3>
      <button type="button" class="btn-header-action" onclick={() => historyView = false} title="Back to Chat">Back</button>
    {:else}
      <div class="header-left">
        <h3>💬 Chat with AI</h3>
        <span class="chat-model-tag">{chatMode === 'agent' ? 'Claude Sonnet 4.5' : 'Gemini 2.5'}</span>
      </div>
      <div class="header-actions">
        <button type="button" class="btn-header-action" onclick={() => historyView = true} title="View previous chats">History</button>
        <button type="button" class="btn-header-action btn-add-chat" onclick={startNewConversation} title="Start new conversation">+</button>
        <button type="button" class="btn-close-drawer" onclick={onClose}>✕</button>
      </div>
    {/if}
  </div>

  {#if !historyView}
    <div class="mode-toggle-bar">
      <button 
        type="button" 
        class="mode-toggle-btn" 
        class:active={chatMode === 'chat'} 
        onclick={() => setChatMode('chat')}
      >
        Chat Mode
      </button>
      <button 
        type="button" 
        class="mode-toggle-btn" 
        class:active={chatMode === 'agent'} 
        onclick={() => setChatMode('agent')}
      >
        Agent Mode
      </button>
    </div>
  {/if}

  <div class="drawer-content">
    {#if historyView}
      <!-- Chat history view -->
      <div class="history-list">
        {#if chatList.length === 0}
          <div class="empty-state">No previous chats.</div>
        {:else}
          {#each chatList as chat (chat.id)}
            <div
              class="history-item-btn"
              class:active={chat.id === activeChatId}
              onclick={() => selectChat(chat.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectChat(chat.id); }}
            >
              <div class="history-item-details">
                <span class="history-title">{chat.title}</span>
                <span class="history-time">{new Date(chat.updatedAt).toLocaleDateString()}</span>
              </div>
              <button 
                type="button" 
                class="btn-delete-history"
                onclick={(e) => deleteChat(chat.id, e)}
                title="Delete Conversation"
              >✕</button>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <!-- Message list view -->
      <div class="message-list" bind:this={messageListEl}>
        {#if messages.length === 0}
          <div class="empty-state">
            <span class="bot-avatar-large">🤖</span>
            <h4>Chat with AI</h4>
            <p>Select canvas blocks to ask for text enhancements, or review layout whitespace by attaching the polished view.</p>
            
            <div class="empty-state-suggestions">
              <button 
                type="button" 
                class="suggestion-btn" 
                onclick={attachPolishedCV}
              >
                🎨 Attach Polished CV (Visual Review)
              </button>
              <button 
                type="button" 
                class="suggestion-btn" 
                onclick={attachAllBlocks}
                disabled={blocks.length === 0}
              >
                📚 Attach All Blocks ({blocks.length})
              </button>
            </div>
          </div>
        {:else}
          {#each messages as msg (msg.id)}
            {#if msg.role !== 'tool'}
              <div class="message-row {msg.role}">
              <div class="message-bubble">
                {#if msg.role === 'user'}
                  <div class="message-text">{msg.content}</div>
                  {#if msg.attachments && msg.attachments.length > 0}
                    <div class="attached-chips-display">
                      {#each msg.attachments as att}
                        <span class="chip chip-readonly" class:chip-denied={att.type === 'denied'} title={att.type}>
                          {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else if att.type === 'denied'}❌{:else}📎{/if}
                          {att.label}
                        </span>
                      {/each}
                    </div>
                  {/if}
                {:else if msg.role === 'tool_call'}
                  <div class="tool-call-status">
                    <span class="tool-icon">⚙️</span>
                    <span class="tool-text">{msg.content || 'Running tool...'}</span>
                  </div>
                {:else}
                  <!-- Assistant Message -->
                  <div class="markdown-content">
                    {@html renderMarkdown(msg.content)}
                  </div>
                  {#if !msg.content && isGenerating && msg === messages[messages.length - 1]}
                    <div class="stream-loading-dots">
                      <span class="dot"></span>
                      <span class="dot"></span>
                      <span class="dot"></span>
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  {#if !historyView}
    <!-- Input and Attachments Staging Panel -->
    <div class="drawer-input-area">
      {#if renderError}
        <div class="error-banner">{renderError}</div>
      {/if}

      <!-- Staged context chips -->
      {#if stagedAttachments.length > 0}
        <div class="staged-chips">
          {#each stagedAttachments as att, i}
            <span class="chip" class:chip-loading={att.loading} class:chip-denied={att.type === 'denied'}>
              {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else if att.type === 'denied'}❌{:else}📎{/if}
              {att.label}
              {#if !att.loading}
                <button type="button" class="btn-remove-chip" onclick={() => removeAttachment(i)}>✕</button>
              {/if}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Textarea Input and Controls -->
      <div class="chat-input-controls">
        <div class="attach-dropdown-wrap">
          <button
            type="button"
            class="btn-control-icon"
            onclick={() => showAttachDropdown = !showAttachDropdown}
            title="Attach Context"
          >
            📎
          </button>
          
          {#if showAttachDropdown}
            <div class="attach-dropdown-menu">
              <button 
                type="button" 
                onclick={attachAllBlocks}
                disabled={blocks.length === 0}
              >
                📚 Attach All Blocks ({blocks.length})
              </button>
              <button type="button" onclick={attachPolishedCV}>
                🎨 Attach Polished CV (Visual Review)
              </button>
              <button type="button" onclick={triggerFileInput}>
                💻 Upload Local File
              </button>
            </div>
          {/if}
        </div>

        <input 
          type="file" 
          style="display:none;" 
          bind:this={fileInputEl} 
          onchange={handleFileUpload} 
        />

        <textarea
          bind:value={inputText}
          placeholder="Chat with AI..."
          rows="1"
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        ></textarea>

        {#if isGenerating}
          <button type="button" class="btn-send-message btn-stop-message" onclick={stopGeneration} title="Stop Generating">
            ⏹
          </button>
        {:else}
          <button 
            type="button" 
            class="btn-send-message" 
            onclick={sendMessage}
            disabled={!inputText.trim() && stagedAttachments.length === 0}
            title="Send Message"
          >
            ➔
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .chat-drawer {
    position: absolute;
    top: 44px;
    right: 0;
    bottom: 0;
    width: 400px;
    background: var(--chat-drawer-bg);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border-left: 1px solid var(--chat-drawer-border);
    box-shadow: -4px 0 24px rgba(10, 36, 99, 0.08);
    display: flex;
    flex-direction: column;
    z-index: 500;
    font-family: var(--font-sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    animation: chat-slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    box-sizing: border-box;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 6px;
    cursor: col-resize;
    z-index: 1000;
    background: transparent;
    transition: background-color 0.15s;
  }

  .resize-handle:hover,
  .resize-handle.is-resizing {
    background-color: rgba(10, 36, 99, 0.2);
  }

  @keyframes chat-slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .drawer-header {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.08);
    flex-shrink: 0;
  }

  .mode-toggle-bar {
    display: flex;
    background: rgba(0, 0, 0, 0.04);
    margin: 8px 12px 0 12px;
    padding: 3px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .mode-toggle-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #4b5563;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
  }

  .mode-toggle-btn:hover {
    color: #111827;
  }

  .mode-toggle-btn.active {
    background: #ffffff;
    color: var(--chat-primary, #0a2463);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .drawer-header h3 {
    font-size: 15.5px;
    font-weight: 700;
    color: var(--chat-text-main);
    margin: 0;
  }

  .chat-model-tag {
    font-size: 10px;
    background: rgba(0, 0, 0, 0.08);
    color: var(--chat-text-main);
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-header-action {
    background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.15);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #4b5563;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-header-action:hover {
    background-color: rgba(55, 53, 47, 0.05);
  }

  .btn-add-chat {
    font-size: 13px;
    font-weight: 700;
    padding: 0 8px;
    height: 20px;
    display: flex;
    align-items: center;
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
    margin-left: 4px;
  }

  .btn-close-drawer:hover {
    background-color: rgba(55, 53, 47, 0.05);
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 12px;
  }

  /* History list styling */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-item-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(55, 53, 47, 0.08);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .history-item-btn:hover {
    background: rgba(255, 255, 255, 0.95);
    border-color: rgba(10, 36, 99, 0.2);
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.04);
  }

  .history-item-btn.active {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--chat-primary);
  }

  .history-item-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .history-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #1f2937;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-time {
    font-size: 10px;
    color: #9ca3af;
  }

  .btn-delete-history {
    background: transparent;
    border: none;
    color: #9ca3af;
    font-size: 12px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }

  .btn-delete-history:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.08);
  }

  /* Messages list */
  .message-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    margin: auto;
    color: #6b7280;
  }

  .bot-avatar-large {
    font-size: 36px;
    margin-bottom: 12px;
  }

  .empty-state h4 {
    font-size: 14px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 6px 0;
  }

  .empty-state p {
    font-size: 12.5px;
    line-height: 1.5;
    margin: 0;
    max-width: 240px;
  }

  .message-row {
    display: flex;
    width: 100%;
  }

  .message-row.user {
    justify-content: flex-end;
  }

  .message-bubble {
    max-width: 85%;
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    box-sizing: border-box;
  }

  .user .message-bubble {
    background-color: var(--chat-user-bubble-bg);
    color: var(--chat-user-bubble-text);
    border-bottom-right-radius: 2px;
  }

  .assistant .message-bubble {
    background-color: var(--chat-assistant-bubble-bg);
    border: 1px solid var(--chat-assistant-bubble-border);
    color: var(--chat-assistant-bubble-text);
    border-bottom-left-radius: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  }

  .attached-chips-display {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }

  /* Staged Chips */
  .staged-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
    padding: 0 2px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    color: #000000;
  }

  .chip-readonly {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
    color: #ffffff;
  }

  .chip-loading {
    background: rgba(156, 163, 175, 0.06);
    border-color: rgba(156, 163, 175, 0.15);
    color: #6b7280;
    animation: chip-pulse 1.5s infinite ease-in-out;
  }

  .chip.chip-denied {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.3);
    color: #dc2626;
  }

  .chip-readonly.chip-denied {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fee2e2;
  }

  @keyframes chip-pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  .btn-remove-chip {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    margin-left: 2px;
  }

  /* Input panel controls */
  .drawer-input-area {
    padding: 12px;
    border-top: 1px solid rgba(55, 53, 47, 0.08);
    background: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  .error-banner {
    background-color: #fee2e2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    padding: 6px 10px;
    color: #b91c1c;
    font-size: 10px;
    margin-bottom: 8px;
  }

  .chat-input-controls {
    display: flex;
    align-items: center;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.15);
    border-radius: 8px;
    padding: 4px 6px;
    gap: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
  }

  .chat-input-controls:focus-within {
    border-color: var(--chat-primary);
  }

  .attach-dropdown-wrap {
    position: relative;
  }

  .btn-control-icon {
    background: transparent;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    transition: background-color 0.15s;
  }

  .btn-control-icon:hover {
    background-color: #f3f4f6;
    color: #111827;
  }

  .attach-dropdown-menu {
    position: absolute;
    bottom: 30px;
    left: 0;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.15);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    z-index: 600;
  }

  .attach-dropdown-menu button {
    background: transparent;
    border: none;
    font-size: 11px;
    font-weight: 500;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #374151;
    transition: background-color 0.15s;
  }

  .attach-dropdown-menu button:hover:not(:disabled) {
    background-color: #f3f4f6;
  }

  .attach-dropdown-menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-input-controls textarea {
    flex: 1;
    border: none;
    background: transparent;
    font-size: 13.5px;
    font-family: inherit;
    color: #000000;
    outline: none;
    resize: none;
    padding: 6px 0;
    max-height: 80px;
    line-height: 1.4;
  }

  .btn-send-message {
    background: var(--chat-primary);
    border: none;
    color: #ffffff;
    font-size: 11px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s, opacity 0.15s;
  }

  .btn-send-message:hover:not(:disabled) {
    background-color: var(--chat-primary-hover);
  }

  .btn-send-message:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-stop-message {
    background: #ef4444;
  }
  .btn-stop-message:hover {
    background: #dc2626;
  }

  /* Streaming Dots Animation */
  .stream-loading-dots {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
  }

  .stream-loading-dots .dot {
    width: 6px;
    height: 6px;
    background-color: #6b7280;
    border-radius: 50%;
    animation: stream-dot-pulse 1.2s infinite ease-in-out;
  }

  .stream-loading-dots .dot:nth-child(2) { animation-delay: 0.2s; }
  .stream-loading-dots .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes stream-dot-pulse {
    0%, 100% { transform: scale(0.6); opacity: 0.4; }
    50% { transform: scale(1); opacity: 1; }
  }

  /* Markdown prose styling */
  .markdown-content :global(p) {
    margin: 0 0 8px 0;
  }
  .markdown-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .markdown-content :global(strong) {
    font-weight: 700;
  }
  .markdown-content :global(em) {
    font-style: italic;
  }
  .markdown-content :global(code) {
    background: rgba(0, 0, 0, 0.05);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
  }
  .markdown-content :global(pre) {
    background: rgba(0, 0, 0, 0.05);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .markdown-content :global(pre code) {
    background: transparent;
    padding: 0;
  }
  .markdown-content :global(h1), .markdown-content :global(h2), .markdown-content :global(h3) {
    margin: 12px 0 6px 0;
    font-weight: 700;
    color: #111827;
  }
  .markdown-content :global(h1) { font-size: 17px; }
  .markdown-content :global(h2) { font-size: 15px; }
  .markdown-content :global(h3) { font-size: 13.5px; }
  .markdown-content :global(ul) {
    margin: 0 0 8px 0;
    padding-left: 20px;
  }
  .markdown-content :global(li) {
    margin-bottom: 4px;
  }

  .tool-call-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #4b5563;
    background: rgba(10, 36, 99, 0.04);
    border: 1px solid rgba(10, 36, 99, 0.08);
    border-radius: 6px;
    padding: 6px 12px;
    margin: 4px 0;
  }

  .tool-icon {
    font-size: 12px;
    display: inline-block;
    animation: rotate-tool 3s linear infinite;
  }

  @keyframes rotate-tool {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .empty-state-suggestions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
    width: 100%;
    max-width: 280px;
  }

  .suggestion-btn {
    background: #ffffff;
    border: 1px solid var(--chat-input-border);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--chat-text-main);
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    font-family: var(--font-sans);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .suggestion-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--chat-primary);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  }

  .suggestion-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media print {
    .chat-drawer {
      display: none !important;
    }
  }
</style>
