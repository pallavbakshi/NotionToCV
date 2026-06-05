<!-- ChatDrawer.svelte -->
<script>
  import { onMount, onDestroy, tick } from 'svelte';

  let {
    resumeId,
    blocks,
    pageTitle,
    paddingMm,
    templateName,
    customTemplates,
    themeColors,
    selectedBlockIds = [],
    stagedChatBlockIds = $bindable([]),
    onClose
  } = $props();

  // Conversation history list and active conversation state
  let chatList = $state([]);
  let activeChatId = $state(null);
  let historyView = $state(false);

  // Message staging and generating state
  let inputText = $state('');
  let stagedAttachments = $state([]); // { type: 'block' | 'polished' | 'file', label, ... }
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
          customTemplates,
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

    // Reset input
    e.target.value = '';
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

    // Create assistant streaming placeholder
    const assistantMsg = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    };

    // Update local state
    chatList = chatList.map(c => {
      if (c.id === activeChatId) {
        // Generate title if it was "New Chat"
        const currentTitle = c.title === 'New Chat' ? (queryText.slice(0, 30) || 'Review Resume') : c.title;
        return {
          ...c,
          title: currentTitle,
          messages: [...c.messages, userMsg, assistantMsg],
          updatedAt: new Date().toISOString()
        };
      }
      return c;
    });

    saveChats();

    // Prepare API call payload
    const systemPrompt = getSystemPromptOutline();

    // Map chat history messages
    const historyPayload = [];
    const activeChatRef = chatList.find(c => c.id === activeChatId);
    // Send all messages except the last empty assistant placeholder
    const pastMessages = activeChatRef.messages.slice(0, -1);

    for (const msg of pastMessages) {
      if (msg.role === 'assistant') {
        historyPayload.push({ role: 'assistant', content: msg.content });
      } else {
        // Reconstruct user message payload including attachments
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

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: historyPayload,
          systemPrompt,
          model: 'google/gemini-2.5-flash'
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Hold incomplete line

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          if (cleanLine.startsWith('data: ')) {
            const dataStr = cleanLine.substring(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              const text = parsed.choices?.[0]?.delta?.content || '';
              if (text) {
                // Append text chunk to the active streaming assistant message
                chatList = chatList.map(c => {
                  if (c.id === activeChatId) {
                    const updatedMessages = [...c.messages];
                    const lastMsg = updatedMessages[updatedMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      lastMsg.content += text;
                    }
                    return { ...c, messages: updatedMessages };
                  }
                  return c;
                });
              }
            } catch (e) {
              // Ignore partial parsing errors
            }
          }
        }
      }
      saveChats();
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
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
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
        <span class="chat-model-tag">Gemini 2.5</span>
      </div>
      <div class="header-actions">
        <button type="button" class="btn-header-action" onclick={() => historyView = true} title="View previous chats">History</button>
        <button type="button" class="btn-header-action btn-add-chat" onclick={startNewConversation} title="Start new conversation">+</button>
        <button type="button" class="btn-close-drawer" onclick={onClose}>✕</button>
      </div>
    {/if}
  </div>

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
            <div class="message-row {msg.role}">
              <div class="message-bubble">
                {#if msg.role === 'user'}
                  <div class="message-text">{msg.content}</div>
                  {#if msg.attachments && msg.attachments.length > 0}
                    <div class="attached-chips-display">
                      {#each msg.attachments as att}
                        <span class="chip chip-readonly" title={att.type}>
                          {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else}📎{/if}
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
            <span class="chip" class:chip-loading={att.loading}>
              {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else}📎{/if}
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
