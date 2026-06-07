<!-- ChatDrawer.svelte — AI chat sidebar shell. -->
<!-- Sub-components in ./: ChatHeader, ModeToggle, ChatHistoryList, ChatMessageList, ChatInput -->
<!-- Agent loop delegated to src/sdk/engine.js — this component is a thin event consumer. -->
<script>
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import ChatHeader from './ChatHeader.svelte';
  import ModeToggle from './ModeToggle.svelte';
  import ChatHistoryList from './ChatHistoryList.svelte';
  import ChatMessageList from './ChatMessageList.svelte';
  import ChatInput from './ChatInput.svelte';
  import { initFonts } from '../layout/index.js';
  import { ResumeAgentEngine, browserModelProvider, browserScreenshotProvider, getAgentSystemPrompt, getSystemPromptOutline, getLayoutDesignerPrompt } from '../../sdk/index.js';
  import { stagedChanges, stagedChatBlockIds, stagedAttachments } from '../shared/stagingStore.js';

  let {
    resumeId,
    blocks,
    pageTitle,
    paddingMm,
    templateName,
    themeColors,
    selectedBlockIds = [],
    onClose,
    onPlaceBlock = null,
    onSetBlockContent = null
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

  // Background job state (Phase 5)
  let backgroundJobId = $state(null);
  let backgroundJobStatus = $state('idle'); // 'idle' | 'polling' | 'done' | 'error'
  let backgroundPollTimer = $state(null);

  // Resizable drawer width state and handler
  let drawerWidth = $state(400);
  let isResizing = $state(false);

  // Layout Designer state — snapshot + rollback
  let layoutCanvasSnapshot = $state(null);
  let layoutResultMsgId = $state(null);

  function acceptLayout() {
    layoutCanvasSnapshot = null;
    if (layoutResultMsgId) {
      chatList = chatList.map(c => c.id === activeChatId
        ? { ...c, messages: c.messages.map(m => m.id === layoutResultMsgId ? { ...m, layoutResult: undefined, layoutAccepted: true } : m) }
        : c);
      layoutResultMsgId = null;
    }
  }

  function denyLayout() {
    if (!layoutCanvasSnapshot) return;
    for (const item of layoutCanvasSnapshot) {
      onPlaceBlock?.(item.id, item.canvas);
    }
    layoutCanvasSnapshot = null;
    if (layoutResultMsgId) {
      chatList = chatList.map(c => c.id === activeChatId
        ? { ...c, messages: c.messages.filter(m => m.id !== layoutResultMsgId) }
        : c);
      layoutResultMsgId = null;
    }
    saveChats();
  }

  // Derived
  let activeChat = $derived(chatList.find(c => c.id === activeChatId));
  let messages = $derived(activeChat ? activeChat.messages : []);
  let chatMode = $derived(activeChat ? (activeChat.mode || 'chat') : 'chat');
  let subAgent = $derived(activeChat ? (activeChat.subAgent || 'editor') : 'editor');

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

  function setSubAgent(newSubAgent) {
    if (!activeChatId) return;
    chatList = chatList.map(c => {
      if (c.id === activeChatId) {
        return { ...c, subAgent: newSubAgent };
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

    // Restore background job polling across page reloads (FR5.5 DoD)
    try {
      const storedJobId = localStorage.getItem(`notionToCV_bgJob_${resumeId}`);
      if (storedJobId) {
        backgroundJobId = storedJobId;
        backgroundJobStatus = 'polling';
        pollJobResult();
      }
    } catch (e) {
      console.error('Error restoring background job from localStorage', e);
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

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      renderError = `File too large: ${file.name} (max 10MB)`;
      setTimeout(() => { renderError = ''; }, 4000);
      return;
    }

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

    const isLayoutDesigner = chatMode === 'agent' && subAgent === 'layout_designer';
    const systemPrompt = isLayoutDesigner
      ? getLayoutDesignerPrompt(blocks, pageTitle)
      : chatMode === 'agent'
        ? getAgentSystemPrompt(blocks, pageTitle)
        : getSystemPromptOutline(blocks, pageTitle);
    const activeModel = isLayoutDesigner
      ? 'google/gemini-3.1-flash-lite'
      : chatMode === 'agent' ? 'anthropic/claude-sonnet-4-5' : 'google/gemini-2.5-flash';

    const historyPayload = [];
    const activeChatRef = chatList.find(c => c.id === activeChatId);
    const pastMessages = activeChatRef ? activeChatRef.messages : [];

    // Layout Designer: track placements and screenshots to enforce
    // deterministic visual verification + old-image cleanup.
    let placementCount = 0;
    let screenshotInfos = []; // [{ index, blockId, tool_call_id }]
    let lastScreenshotPlacedAt = 0;
    if (isLayoutDesigner) {
      pastMessages.forEach((msg, i) => {
        if (msg.role === 'tool' && msg.isToolResult && msg.name === 'place_block') {
          placementCount++;
        }
        if (msg.role === 'tool' && msg.isToolResult && msg.name === 'get_block_screenshot') {
          let blockId = '';
          try { blockId = JSON.parse(msg.content).blockId || ''; } catch {}
          screenshotInfos.push({ index: i, blockId, tool_call_id: msg.tool_call_id });
          lastScreenshotPlacedAt = placementCount;
        }
      });
    }

    // Inject screenshot reminder if 10+ placements since last screenshot
    // (injected after history payload is built, below)

    for (let i = 0; i < pastMessages.length; i++) {
      const msg = pastMessages[i];

      // Apply the breadcrumb screenshot cleanup AFTER the reminder (if any) is already
      // in the payload, so the LLM sees the reminder first, then the history.
      if (msg.role === 'tool' && msg.isToolResult && msg.name === 'get_block_screenshot') {
        const isLatest = screenshotInfos.length > 0 && i === screenshotInfos[screenshotInfos.length - 1].index;
        if (isLatest) {
          // Keep the latest screenshot intact
          historyPayload.push({ role: 'tool', tool_call_id: msg.tool_call_id, name: msg.name, content: msg.content });
        } else {
          // Replace older screenshots with a breadcrumb — keeps history flow intact
          const num = screenshotInfos.findIndex(s => s.index === i) + 1;
          const blockLabel = screenshotInfos.find(s => s.index === i)?.blockId || 'unknown';
          historyPayload.push({
            role: 'tool',
            tool_call_id: msg.tool_call_id,
            name: msg.name,
            content: `[Screenshot #${num} (block ${blockLabel}) — image data pruned. The agent reviewed this and summarized findings in the following assistant message.]`
          });
        }
        continue;
      }

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

    // Layout Designer: inject screenshot reminder if 10+ placements since last visual check.
    // This acts as a system prompt-level nudge, keeping the agent visually grounded.
    if (isLayoutDesigner && placementCount > 0 && placementCount - lastScreenshotPlacedAt >= 10) {
      historyPayload.push({
        role: 'user',
        content: `[SYSTEM REMINDER] You have placed ${placementCount - lastScreenshotPlacedAt} blocks since your last visual check. Pause now and call get_block_screenshot on a recently placed block to verify the layout looks correct. Summarize what you see, then continue placing remaining blocks.`
      });
    }

    const resumeState = {
      title: pageTitle,
      paddingMm,
      templateName,
      themeColors,
      pageCount: blocks.filter(b => b.canvas).reduce((max, b) => Math.max(max, b.canvas?.page || 1), 1),
      blocks
    };

    const engine = new ResumeAgentEngine({
      modelProvider: browserModelProvider,
      screenshotProvider: browserScreenshotProvider,
      maxTurns: isLayoutDesigner ? 100 : 30
    });

    let contentAccumulated = ''; // first-turn content — used by done handler to detect empty opener
    let hadToolCalls = false;
    let stepMsgIdMap = {};

    // Per-turn tracking: each assistant speaking turn gets its own message bubble.
    // After every tool_result, needNewBubble=true so the next text event inserts
    // a fresh bubble rather than appending to the opener.
    const assistantMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
    let currentTurnMsgId = assistantMsgId;
    let currentTurnContent = '';
    let needNewBubble = false;

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

    try {
      // Snapshot canvas before layout designer runs so we can roll back
      if (isLayoutDesigner) {
        layoutCanvasSnapshot = blocks.map(b => ({ id: b.id, canvas: b.canvas ? { ...b.canvas } : null }));
      }

      for await (const ev of engine.optimizeResume(resumeState, queryText, {
        messages: historyPayload,
        systemPrompt,
        model: activeModel,
        signal: abortController.signal,
        mode: chatMode === 'agent' ? 'agent' : 'coach',
        subAgent
      })) {
        switch (ev.type) {
          case 'text': {
            // After a tool_result, open a fresh assistant bubble for this turn's text.
            if (needNewBubble) {
              needNewBubble = false;
              currentTurnMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
              currentTurnContent = '';
              chatList = chatList.map(c => {
                if (c.id === activeChatId) {
                  return { ...c, messages: [...c.messages, { id: currentTurnMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString() }] };
                }
                return c;
              });
            }
            currentTurnContent += ev.delta;
            // Track first-turn content separately so done handler can detect an empty opener.
            if (currentTurnMsgId === assistantMsgId) contentAccumulated = currentTurnContent;
            chatList = chatList.map(c => {
              if (c.id === activeChatId) {
                return { ...c, messages: c.messages.map(m => m.id === currentTurnMsgId ? { ...m, content: currentTurnContent } : m) };
              }
              return c;
            });
            break;
          }

          case 'tool_call': {
            hadToolCalls = true;
            const stepMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
            stepMsgIdMap[ev.name + '_' + ev.id] = stepMsgId;
            const stepMsg = {
              id: stepMsgId,
              role: 'tool_call',
              tool_call_id: ev.id,
              name: ev.name,
              content: `⚙️ Tool use: ${ev.name}(${Object.keys(ev.args).length ? JSON.stringify(ev.args) : ''})...`,
              timestamp: new Date().toISOString()
            };
            chatList = chatList.map(c => {
              if (c.id === activeChatId) {
                return { ...c, messages: [...c.messages, stepMsg] };
              }
              return c;
            });
            break;
          }

          case 'tool_result': {
            const toolResultMsg = {
              id: 'msg_' + Math.random().toString(36).substring(2, 9),
              role: 'tool',
              isToolResult: true,
              tool_call_id: ev.id,
              name: ev.name,
              content: JSON.stringify(ev.result),
              timestamp: new Date().toISOString()
            };
            const stepKey = ev.name + '_' + ev.id;
            const stepMsgId = stepMsgIdMap[stepKey];
            chatList = chatList.map(c => {
              if (c.id === activeChatId) {
                return {
                  ...c,
                  messages: [
                    ...c.messages.map(m => m.id === stepMsgId ? { ...m, content: `⚙️ Executed tool ${ev.name}` } : m),
                    toolResultMsg
                  ]
                };
              }
              return c;
            });
            // Next text event belongs to a new assistant turn — open a fresh bubble.
            needNewBubble = true;
            break;
          }

          case 'staged_change':
            // Merge delta into store — earlier staged blocks from the same run are preserved
            stagedChanges.update(s => ({ ...s, [ev.blockId]: ev.change }));
            break;

          case 'canvas_change':
            onPlaceBlock?.(ev.blockId, ev.canvas);
            break;

          case 'content_change':
            console.log('[ChatDrawer] content_change', ev.blockId, 'content len:', ev.content?.filter(n => n.type === 'text').map(n => n.text).join('').length);
            onSetBlockContent?.(ev.blockId, ev.content);
            break;

          case 'error':
            // Append error to whichever bubble is currently active.
            chatList = chatList.map(c => {
              if (c.id === activeChatId) {
                return { ...c, messages: c.messages.map(m => m.id === currentTurnMsgId ? { ...m, content: m.content + `\n\n*Error: ${ev.error}*` } : m) };
              }
              return c;
            });
            break;

          case 'done':
            // Remove the opener bubble if it was empty (agent started straight with a tool call).
            if (!contentAccumulated && hadToolCalls) {
              chatList = chatList.map(c => {
                if (c.id === activeChatId) {
                  return { ...c, messages: c.messages.filter(m => m.id !== assistantMsgId) };
                }
                return c;
              });
            }

            // Append the turn-limit notice to whatever the last active bubble is.
            if (ev.reason === 'max_turns') {
              chatList = chatList.map(c => {
                if (c.id === activeChatId) {
                  return { ...c, messages: c.messages.map(m => m.id === currentTurnMsgId ? { ...m, content: m.content + '\n\n*Agent reached the 30-turn limit. Some optimisations may be incomplete.*' } : m) };
                }
                return c;
              });
            }

            // Merge final transaction — catches blocks updated more than once during
            // the run (second update to same block skips the staged_change event).
            if (ev.transaction?.stagedChanges) {
              stagedChanges.update(s => ({ ...s, ...ev.transaction.stagedChanges }));
            }

            // Layout Designer: append accept/deny message if blocks were placed
            if (isLayoutDesigner && layoutCanvasSnapshot) {
              let placedCount = 0;
              for (const snap of layoutCanvasSnapshot) {
                const current = blocks.find(b => b.id === snap.id);
                if (JSON.stringify(snap.canvas) !== JSON.stringify(current?.canvas ?? null)) {
                  placedCount++;
                }
              }
              if (placedCount > 0) {
                const resultMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
                layoutResultMsgId = resultMsgId;
                chatList = chatList.map(c => {
                  if (c.id === activeChatId) {
                    return { ...c, messages: [...c.messages, {
                      id: resultMsgId,
                      role: 'assistant',
                      content: `Layout complete. ${placedCount} block${placedCount !== 1 ? 's' : ''} placed.`,
                      layoutResult: true,
                      layoutAccepted: false,
                      timestamp: new Date().toISOString()
                    }] };
                  }
                  return c;
                });
              }
            }

            saveChats();
            break;
        }
      }

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
    // Also cancel any running background job
    if (backgroundJobStatus === 'polling' && backgroundJobId) {
      fetch(`/api/agent/job/${backgroundJobId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': getUserId() }
      }).catch(() => {});
      clearPolling();
      try { localStorage.removeItem(`notionToCV_bgJob_${resumeId}`); } catch (_) {}
      backgroundJobId = null;
      backgroundJobStatus = 'idle';
    }
  }

  function getUserId() {
    const key = 'ntcv_user_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'u_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem(key, id);
    }
    return id;
  }

  async function handleRunInBackground() {
    if (!inputText.trim()) return;
    if (backgroundJobStatus === 'polling') return;

    const state = {
      title: pageTitle,
      paddingMm,
      templateName,
      themeColors,
      pageCount: blocks.filter(b => b.canvas).reduce((max, b) => Math.max(max, b.canvas?.page || 1), 1),
      // Strip inline imageData before sending — server dehydrates to file:// URIs,
      // keeping the payload well below the 10 MB cap for image-heavy resumes.
      blocks: blocks.map(b => {
        if (!b.imageData) return b;
        const { imageData: _stripped, ...rest } = b;
        return rest;
      })
    };

    const instruction = inputText;
    inputText = '';

    try {
      const res = await fetch('/api/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': getUserId() },
        body: JSON.stringify({ state, instruction })
      });

      if (!res.ok) {
        const err = await res.json();
        renderError = `Background job failed: ${err.error}`;
        setTimeout(() => { renderError = ''; }, 4000);
        return;
      }

      const { jobId } = await res.json();
      backgroundJobId = jobId;
      backgroundJobStatus = 'polling';
      try { localStorage.setItem(`notionToCV_bgJob_${resumeId}`, jobId); } catch (_) {}
      pollJobResult();
    } catch (err) {
      renderError = `Failed to start background job: ${err.message}`;
      setTimeout(() => { renderError = ''; }, 4000);
    }
  }

  function pollJobResult() {
    if (!backgroundJobId) return;

    backgroundPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/job/${backgroundJobId}`, {
          headers: { 'X-User-Id': getUserId() }
        });

        if (!res.ok) {
          clearPolling();
          backgroundJobStatus = 'error';
          return;
        }

        const job = await res.json();

        if (job.status === 'done' && job.output?.transaction?.stagedChanges) {
          clearPolling();
          backgroundJobStatus = 'done';
          try { localStorage.removeItem(`notionToCV_bgJob_${resumeId}`); } catch (_) {}
          // Load transaction into stagedChanges store (same path as Phase 4 live agent)
          const tx = job.output.transaction.stagedChanges;
          stagedChanges.update(s => ({ ...s, ...tx }));
        } else if (job.status === 'error' || job.status === 'cancelled') {
          clearPolling();
          backgroundJobStatus = job.status === 'cancelled' ? 'idle' : 'error';
          try { localStorage.removeItem(`notionToCV_bgJob_${resumeId}`); } catch (_) {}
          if (job.error) {
            renderError = `Background job failed: ${job.error}`;
            setTimeout(() => { renderError = ''; }, 4000);
          }
        }
      } catch (_err) {
        // Network error during poll — keep trying
      }
    }, 5000);
  }

  function clearPolling() {
    if (backgroundPollTimer) {
      clearInterval(backgroundPollTimer);
      backgroundPollTimer = null;
    }
  }

  function dismissBackgroundBanner() {
    clearPolling();
    try { localStorage.removeItem(`notionToCV_bgJob_${resumeId}`); } catch (_) {}
    backgroundJobId = null;
    backgroundJobStatus = 'idle';
  }

  // Cleanup poll timer on destroy
  onDestroy(() => {
    clearPolling();
  });

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

    escaped = escaped.replace(/\x00CB(BLOCK|INLINE)(\d+)\x00/g, (_, type, i) => codeBlocks[parseInt(i, 10)]);

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

  <ChatHeader bind:historyView {chatMode} {subAgent} {startNewConversation} {onClose} />

  <ModeToggle {historyView} {chatMode} {subAgent} {setChatMode} {setSubAgent} />

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
        {acceptLayout}
        {denyLayout}
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
    {backgroundJobStatus}
    {blocks}
    {removeAttachment}
    {attachAllBlocks}
    {attachPolishedCV}
    {triggerFileInput}
    {handleFileUpload}
    {sendMessage}
    {stopGeneration}
    {handleRunInBackground}
  />
</div>

<!-- Background job banner (Phase 5) -->
{#if backgroundJobStatus !== 'idle'}
  <div class="bg-job-banner" class:bg-job-done={backgroundJobStatus === 'done'} class:bg-job-error={backgroundJobStatus === 'error'}>
    {#if backgroundJobStatus === 'polling'}
      <span class="bg-job-spinner"></span>
      Optimisation running in background… (you can close this tab)
    {:else if backgroundJobStatus === 'done'}
      ✓ Optimisation complete — review the staged changes in the Notion pane
    {:else if backgroundJobStatus === 'error'}
      ✗ Background job failed
    {/if}
    <button class="bg-job-dismiss" onclick={dismissBackgroundBanner}>×</button>
  </div>
{/if}

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
    left: -5px;
    width: 10px;
    cursor: col-resize;
    z-index: 1000;
    background: transparent;
    transition: background-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .resize-handle::after {
    content: '';
    width: 2px;
    height: 32px;
    border-radius: 1px;
    background: transparent;
    transition: background-color 0.15s, height 0.15s;
  }

  .resize-handle:hover,
  .resize-handle.is-resizing {
    background-color: rgba(10, 36, 99, 0.08);
  }

  .resize-handle:hover::after,
  .resize-handle.is-resizing::after {
    background-color: rgba(10, 36, 99, 0.35);
    height: 48px;
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

  /* Background job banner (Phase 5) */
  .bg-job-banner {
    position: absolute;
    bottom: 72px;
    left: 12px;
    right: 12px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 510;
    background: #eef2ff;
    color: #3730a3;
    border: 1px solid #c7d2fe;
  }
  .bg-job-banner.bg-job-done {
    background: #ecfdf5;
    color: #065f46;
    border-color: #a7f3d0;
  }
  .bg-job-banner.bg-job-error {
    background: #fef2f2;
    color: #991b1b;
    border-color: #fecaca;
  }
  .bg-job-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #c7d2fe;
    border-top-color: #3730a3;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .bg-job-dismiss {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: inherit;
    opacity: 0.5;
    padding: 0 2px;
    line-height: 1;
  }
  .bg-job-dismiss:hover { opacity: 1; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
