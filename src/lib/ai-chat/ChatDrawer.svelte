<!-- ChatDrawer.svelte — AI chat sidebar shell. -->
<!-- Sub-components in ./: ChatHeader, ModeToggle, ChatHistoryList, ChatMessageList, ChatInput -->
<!-- Logic modules in ./: agentTools.js, messageParser.js, spatialUtils.js -->
<script>
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import ChatHeader from './ChatHeader.svelte';
  import ModeToggle from './ModeToggle.svelte';
  import ChatHistoryList from './ChatHistoryList.svelte';
  import ChatMessageList from './ChatMessageList.svelte';
  import ChatInput from './ChatInput.svelte';
  import { initFonts } from '../layout/index.js';
  import { AGENT_TOOLS, runAgentTool, getAgentSystemPrompt, getSystemPromptOutline } from './agentTools.js';
  import { stagedChanges, stagedChatBlockIds, stagedAttachments } from '../shared/stagingStore.js';

  let {
    resumeId,
    blocks,
    pageTitle,
    paddingMm,
    templateName,
    themeColors,
    selectedBlockIds = [],
    onClose
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
  let drawerWidth = $state(400);
  let isResizing = $state(false);

  // Derived
  let activeChat = $derived(chatList.find(c => c.id === activeChatId));
  let messages = $derived(activeChat ? activeChat.messages : []);
  let chatMode = $derived(activeChat ? (activeChat.mode || 'chat') : 'chat');

  function handleResizeStart(e) {
    if (e.button !== 0) return;
    isResizing = true;

    const startX = e.clientX;
    const startWidth = drawerWidth;

    function handleResizeMove(e2) {
      const deltaX = e2.clientX - startX;
      const newWidth = Math.max(280, Math.min(700, startWidth - deltaX));
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
    const ids = $stagedChatBlockIds;
    if (ids.length > 0) {
      forceAttachBlocks(ids);
      untrack(() => stagedChatBlockIds.set([]));
    }
  });

  function saveChats() {
    if (!resumeId || chatList.length === 0) return;

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
    initFonts().catch(e => console.error('Font init error:', e));

    try {
      const stored = localStorage.getItem(`notionToCV_chats_${resumeId}`);
      if (stored) {
        chatList = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading chats from localStorage', e);
    }

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

  // Autoscroll on new message / generation
  $effect(() => {
    if (messages.length > 0 || isGenerating) {
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
    stagedAttachments.set([]);
    inputText = '';
    scrollToBottom();
    saveChats();
  }

  function selectChat(id) {
    activeChatId = id;
    historyView = false;
    stagedAttachments.set([]);
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

  function removeAttachment(index) {
    stagedAttachments.update(a => a.filter((_, i) => i !== index));
  }

  function attachSelectedBlocks() {
    if (selectedBlockIds.length === 0) return;
    const selectedBlocks = blocks.filter(b => selectedBlockIds.includes(b.id));
    if (selectedBlocks.length === 0) return;

    const label = selectedBlocks.length === 1
      ? `Block: ${selectedBlocks[0].type}`
      : `${selectedBlocks.length} blocks`;

    const alreadyAttached = $stagedAttachments.some(
      a => a.type === 'block' && JSON.stringify(a.blockIds) === JSON.stringify(selectedBlockIds)
    );

    if (!alreadyAttached) {
      stagedAttachments.update(a => [
        ...a,
        {
          type: 'block',
          blockIds: [...selectedBlockIds],
          blocks: JSON.parse(JSON.stringify(selectedBlocks)),
          label
        }
      ]);
    }
    showAttachDropdown = false;
  }

  function attachAllBlocks() {
    if (blocks.length === 0) return;
    const allBlockIds = blocks.map(b => b.id);
    const label = `All Blocks (${blocks.length})`;

    const alreadyAttached = $stagedAttachments.some(
      a => a.type === 'block' && a.label.startsWith('All Blocks')
    );

    if (!alreadyAttached) {
      stagedAttachments.update(a => [
        ...a,
        {
          type: 'block',
          blockIds: allBlockIds,
          blocks: JSON.parse(JSON.stringify(blocks)),
          label
        }
      ]);
    }
    showAttachDropdown = false;
  }

  async function attachPolishedCV() {
    const loadingId = 'loading_' + Math.random().toString(36).substring(2, 9);
    stagedAttachments.update(a => [
      ...a,
      { id: loadingId, type: 'polished', loading: true, label: 'Polished CV (Rendering...)' }
    ]);
    showAttachDropdown = false;

    try {
      const response = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks, pageTitle, paddingMm, templateName, themeColors })
      });

      if (!response.ok) throw new Error('Failed to render screenshots');

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      stagedAttachments.update(a => a.map(att => {
        if (att.id === loadingId) {
          return {
            type: 'polished',
            screenshots: result.screenshots,
            label: `Polished CV (${result.screenshots.length} Page${result.screenshots.length > 1 ? 's' : ''})`
          };
        }
        return att;
      }));
    } catch (err) {
      console.error('Screenshot error:', err);
      renderError = 'Failed to render CV screenshots.';
      stagedAttachments.update(a => a.filter(x => x.id !== loadingId));
      setTimeout(() => { renderError = ''; }, 4000);
    }
  }

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
      stagedAttachments.update(a => [
        ...a,
        { type: 'file', fileName: file.name, fileType: isImage ? 'image' : 'text', fileData: data, label: `File: ${file.name}` }
      ]);
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

  async function sendMessage() {
    if (!inputText.trim() && $stagedAttachments.length === 0) return;
    if (isGenerating) return;

    const hasLoading = $stagedAttachments.some(a => a.loading);
    if (hasLoading) return;

    isGenerating = true;
    abortController = new AbortController();

    const queryText = inputText;
    inputText = '';

    const attachmentsToSend = [...$stagedAttachments];
    stagedAttachments.set([]);

    const userMsg = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: queryText,
      attachments: attachmentsToSend,
      timestamp: new Date().toISOString()
    };

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

    const systemPrompt = chatMode === 'agent' ? getAgentSystemPrompt(blocks, pageTitle) : getSystemPromptOutline(blocks, pageTitle);
    const activeModel = chatMode === 'agent' ? 'anthropic/claude-sonnet-4-5' : 'google/gemini-2.5-flash';

    const historyPayload = [];
    const activeChatRef = chatList.find(c => c.id === activeChatId);
    const pastMessages = activeChatRef ? activeChatRef.messages : [];

    for (const msg of pastMessages) {
      if (msg.role === 'assistant') {
        const item = { role: 'assistant', content: msg.content || null };
        if (msg.tool_calls) item.tool_calls = msg.tool_calls;
        historyPayload.push(item);
      } else if (msg.role === 'tool' && msg.isToolResult) {
        historyPayload.push({ role: 'tool', tool_call_id: msg.tool_call_id, name: msg.name, content: msg.content });
      } else if (msg.role === 'tool_call') {
        // Skip visual tool call status helpers
      } else if (msg.role === 'user') {
        let textPart = msg.content;

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

        const deniedAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'denied') : [];
        if (deniedAttached.length > 0) {
          textPart += '\n\n[User Rejections]:';
          deniedAttached.forEach(att => {
            textPart += `\n- Proposed content change for Block ID ${att.blockId} has been explicitly REJECTED/DENIED by the user. They did not approve this proposed revision. Please think of another wording/strategy or ask how they want it instead.`;
          });
        }

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

        const screenshotsAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'polished') : [];
        screenshotsAttached.forEach(att => {
          if (att.screenshots && Array.isArray(att.screenshots)) {
            att.screenshots.forEach(s => {
              if (s) msgContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s}` } });
            });
          } else {
            msgContent.push({ type: 'text', text: '\n[Attached Polished CV (visual rendering stripped for storage)]' });
          }
        });

        const imagesAttached = msg.attachments ? msg.attachments.filter(a => a.type === 'file' && a.fileType === 'image') : [];
        imagesAttached.forEach(att => {
          if (att.fileData) msgContent.push({ type: 'image_url', image_url: { url: att.fileData } });
          else if (att.fileName) msgContent.push({ type: 'text', text: `\n[Attached Image: ${att.fileName} (stripped for storage)]` });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: abortController.signal
      });

      if (!response.ok) throw new Error(await response.text());

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
          return { ...c, messages: [...c.messages, assistantMsg] };
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

              const text = delta?.content || '';
              if (text) {
                contentAccumulated += text;
                chatList = chatList.map(c => {
                  if (c.id === activeChatId) {
                    return { ...c, messages: c.messages.map(m => m.id === assistantMsgId ? { ...m, content: contentAccumulated } : m) };
                  }
                  return c;
                });
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallsAccumulated[idx]) {
                    toolCallsAccumulated[idx] = { id: tc.id || '', type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
                  }
                  if (tc.id) toolCallsAccumulated[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAccumulated[idx].function.name = tc.function.name;
                  if (tc.function?.arguments) toolCallsAccumulated[idx].function.arguments += tc.function.arguments;
                }
              }
            } catch (e) {
              // Ignore partial parsing errors
            }
          }
        }
      }

      if (!contentAccumulated && toolCallsAccumulated.length > 0) {
        chatList = chatList.map(c => {
          if (c.id === activeChatId) {
            return { ...c, messages: c.messages.filter(m => m.id !== assistantMsgId) };
          }
          return c;
        });
      }

      saveChats();

      const completedToolCalls = toolCallsAccumulated.filter(Boolean);

      if (completedToolCalls.length > 0) {
        const assistantToolCallMsg = {
          role: 'assistant',
          content: contentAccumulated || null,
          tool_calls: completedToolCalls
        };

        const nextHistory = [...currentHistory, assistantToolCallMsg];

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
          try { parsedArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}

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

          const { result, stagedChangesUpdate } = await runAgentTool(tcName, parsedArgs, {
            blocks, paddingMm, templateName, themeColors, stagedChanges: $stagedChanges, pageTitle
          });

          if (stagedChangesUpdate) {
            stagedChanges.set(stagedChangesUpdate);
          }

          const toolResultMsg = {
            id: 'msg_' + Math.random().toString(36).substring(2, 9),
            role: 'tool',
            isToolResult: true,
            tool_call_id: tc.id,
            name: tcName,
            content: JSON.stringify(result),
            timestamp: new Date().toISOString()
          };

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
            name: tcName,
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
              // Replace the last message with a new object instead of mutating the
              // original reference (which is shared with the shallow array copy).
              updatedMessages[updatedMessages.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + `\n\n*Error: Failed to fetch response. (${err.message})*`
              };
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
      saveChats();
      isGenerating = false;
      abortController = null;
    }
  }

  function renderMarkdown(text) {
    if (!text) return '';
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const codeBlocks = [];
    escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return `\x00CBBLOCK${codeBlocks.length - 1}\x00`;
    });
    escaped = escaped.replace(/`([^`]+)`/g, (_, code) => {
      codeBlocks.push(`<code>${code}</code>`);
      return `\x00CBINLINE${codeBlocks.length - 1}\x00`;
    });

    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');

    escaped = escaped.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h1>$1</h1>');

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

    escaped = escaped.split('\n\n').map(para => {
      const trimmed = para.trim();
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<pre>') || trimmed.startsWith('\x00CBBLOCK')) {
        return para;
      }
      return '<p>' + para.replace(/\n/g, '<br/>') + '</p>';
    }).join('');

    escaped = escaped.replace(/\x00CB(BLOCK|INLINE)(\d+)\x00/g, (_, type, i) => codeBlocks[parseInt(i)]);

    return escaped;
  }

  export function forceAttachBlocks(blockIds) {
    if (!blockIds || blockIds.length === 0) return;
    const selectedBlocks = blocks.filter(b => blockIds.includes(b.id));
    if (selectedBlocks.length === 0) return;

    const label = selectedBlocks.length === 1
      ? `Block: ${selectedBlocks[0].type}`
      : `${selectedBlocks.length} blocks`;

    const alreadyAttached = $stagedAttachments.some(
      a => a.type === 'block' && JSON.stringify(a.blockIds) === JSON.stringify(blockIds)
    );

    if (!alreadyAttached) {
      stagedAttachments.update(a => [
        ...a,
        { type: 'block', blockIds: [...blockIds], blocks: JSON.parse(JSON.stringify(selectedBlocks)), label }
      ]);
    }
  }

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
  <div
    class="resize-handle"
    class:is-resizing={isResizing}
    onpointerdown={handleResizeStart}
    role="separator"
    aria-label="Resize chat drawer"
  ></div>

  <ChatHeader bind:historyView {chatMode} {startNewConversation} {onClose} />

  <ModeToggle {historyView} {chatMode} {setChatMode} />

  <div class="drawer-content">
    {#if historyView}
      <ChatHistoryList {chatList} {activeChatId} {selectChat} {deleteChat} />
    {:else}
      <ChatMessageList
        bind:messageListEl
        {messages}
        {isGenerating}
        {blocks}
        {renderMarkdown}
        {attachPolishedCV}
        {attachAllBlocks}
      />
    {/if}
  </div>

  <ChatInput
    {historyView}
    {renderError}
    stagedAttachments={$stagedAttachments}
    bind:showAttachDropdown
    bind:fileInputEl
    bind:inputText
    {isGenerating}
    {blocks}
    {removeAttachment}
    {attachAllBlocks}
    {attachPolishedCV}
    {triggerFileInput}
    {handleFileUpload}
    {sendMessage}
    {stopGeneration}
  />
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

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 12px;
  }

  @media print {
    .chat-drawer {
      display: none !important;
    }
  }
</style>
