<script>
  import { onMount, onDestroy } from 'svelte';
  import NotionPane from './lib/notion/NotionPane.svelte';
  import PolishedPane from './lib/polished/PolishedPane.svelte';
  import TemplateGallery from './lib/views/TemplateGallery.svelte';
  import Dashboard from './lib/views/Dashboard.svelte';
  import './lib/polished/templates/clean.css';
  import './lib/polished/templates/modern.css';
  import './lib/polished/templates/elegant.css';
  import './lib/polished/templates/compact.css';
  import { initFonts } from './lib/layout/index.js';
  import { templateDefaultFonts, normalizeTemplateName } from './lib/shared/templateFonts.js';
  import { stagedChanges, stagedChatBlockIds, stagedAttachments } from './lib/shared/stagingStore.js';

  // Load resumes list from localStorage
  let initialResumes = [];
  try {
    const storedResumes = localStorage.getItem('notionToCV_resumes');
    if (storedResumes) {
      initialResumes = JSON.parse(storedResumes);
    }
  } catch (e) {
    console.error('Error loading resumes from localStorage', e);
  }

  let resumes = $state(initialResumes);

  // templateDefaultFonts + normalizeTemplateName now live in a shared module
  // (./lib/shared/templateFonts.js) so NotionPane's JSON import defaults to the
  // same per-template fonts instead of a blanket Inter.

  // Router state
  let currentPath = $state('/dashboard');
  let activeResumeId = $state(null);

  // Editor states (bound to active CV session)
  let blocks = $state([{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null, locked: false }]);
  let pageTitle = $state('');
  let paddingMm = $state(15);
  let activeTemplate = $state('clean');
  let themeColors = $state({
    h1Color: '#0a2463',
    h2Color: '#0a2463',
    h3Color: '#1e1b18',
    textColor: '#1e1b18',
    backgroundColor: '#ffffff',
    h1Font: 'Inter',
    h2Font: 'Inter',
    h3Font: 'Inter',
    textFont: 'Inter'
  });

  // Shared UI states
  let paneWidth = $state(480);
  let isDragging = $state(false);
  let draggedBlockId = $state(null);
  let isExportMode = $state(false);

  // Phase 3 AI Chat Drawer states
  let isChatDrawerOpen = $state(false);

  function handleAskAI(blockIds) {
    isChatDrawerOpen = true;
    stagedChatBlockIds.set(blockIds);
  }

  // Agent Mode Action Helpers
  function acceptStagedChange(blockId) {
    let change;
    stagedChanges.update(s => {
      change = s[blockId];
      if (!change) return s;
      const updated = { ...s };
      delete updated[blockId];
      return updated;
    });
    if (!change) return;
    blocks = blocks.map(b => b.id === blockId ? { ...b, content: change.proposedContent } : b);
  }

  function denyStagedChange(blockId) {
    let change;
    stagedChanges.update(s => {
      change = s[blockId];
      if (!change) return s;
      const updated = { ...s };
      delete updated[blockId];
      return updated;
    });
    if (!change) return;
    const block = blocks.find(b => b.id === blockId);
    if (block) {
      const nameOrType = block.name ? `@${block.name}` : block.type;
      const label = `Block: ${nameOrType} — Denied`;
      stagedAttachments.update(a => {
        const exists = a.some(x => x.type === 'denied' && x.blockId === blockId);
        if (!exists) return [...a, { type: 'denied', blockId, label }];
        return a;
      });
    }
  }

  function acceptAllStagedChanges() {
    let currentChanges;
    stagedChanges.update(s => { currentChanges = s; return {}; });
    blocks = blocks.map(b => {
      const change = currentChanges[b.id];
      return change ? { ...b, content: change.proposedContent } : b;
    });
  }

  function denyAllStagedChanges() {
    let currentChanges;
    stagedChanges.update(s => { currentChanges = s; return {}; });
    Object.keys(currentChanges).forEach(blockId => {
      const block = blocks.find(b => b.id === blockId);
      if (block) {
        const nameOrType = block.name ? `@${block.name}` : block.type;
        const label = `Block: ${nameOrType} — Denied`;
        stagedAttachments.update(a => {
          const exists = a.some(x => x.type === 'denied' && x.blockId === blockId);
          if (!exists) return [...a, { type: 'denied', blockId, label }];
          return a;
        });
      }
    });
  }

  // Central Undo/Redo History states
  let historyPast = $state([]);
  let historyFuture = $state([]);
  let isUndoRedoing = $state(false);
  let lastSavedStateJson = $state("");
  let debounceTimer;

  function getHistoryState() {
    return {
      blocks: JSON.parse(JSON.stringify(blocks)),
      pageTitle,
      paddingMm,
      activeTemplate,
      themeColors: JSON.parse(JSON.stringify(themeColors))
    };
  }

  function serializeState(state) {
    return JSON.stringify({
      blocks: state.blocks,
      pageTitle: state.pageTitle,
      paddingMm: state.paddingMm,
      activeTemplate: state.activeTemplate,
      themeColors: state.themeColors
    });
  }

  function saveHistoryState(state) {
    historyPast = [...historyPast, JSON.parse(JSON.stringify(state))];
    historyFuture = [];
    if (historyPast.length > 50) {
      historyPast = historyPast.slice(1);
    }
  }

  function undo() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      const prev = JSON.parse(lastSavedStateJson);
      saveHistoryState(prev);
    }

    if (historyPast.length === 0) return;

    isUndoRedoing = true;
    const currentState = getHistoryState();
    historyFuture = [currentState, ...historyFuture];

    const previousState = historyPast[historyPast.length - 1];
    historyPast = historyPast.slice(0, -1);

    blocks = previousState.blocks;
    pageTitle = previousState.pageTitle;
    paddingMm = previousState.paddingMm;
    activeTemplate = previousState.activeTemplate;
    themeColors = previousState.themeColors;

    lastSavedStateJson = serializeState(previousState);

    setTimeout(() => {
      isUndoRedoing = false;
    }, 50);
  }

  function redo() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (historyFuture.length === 0) return;

    isUndoRedoing = true;
    const currentState = getHistoryState();
    historyPast = [...historyPast, currentState];

    const nextState = historyFuture[0];
    historyFuture = historyFuture.slice(1);

    blocks = nextState.blocks;
    pageTitle = nextState.pageTitle;
    paddingMm = nextState.paddingMm;
    activeTemplate = nextState.activeTemplate;
    themeColors = nextState.themeColors;

    lastSavedStateJson = serializeState(nextState);

    setTimeout(() => {
      isUndoRedoing = false;
    }, 50);
  }

  $effect(() => {
    const currentBlocks = blocks;
    const currentPageTitle = pageTitle;
    const currentPaddingMm = paddingMm;
    const currentActiveTemplate = activeTemplate;
    const currentThemeColors = themeColors;

    if (isUndoRedoing) return;
    if (currentBlocks.length === 0) return;

    const currentState = {
      blocks: currentBlocks,
      pageTitle: currentPageTitle,
      paddingMm: currentPaddingMm,
      activeTemplate: currentActiveTemplate,
      themeColors: currentThemeColors
    };
    const currentStateJson = serializeState(currentState);

    if (!lastSavedStateJson) {
      lastSavedStateJson = currentStateJson;
      return;
    }

    if (currentStateJson !== lastSavedStateJson) {
      const prev = JSON.parse(lastSavedStateJson);
      
      const isStructureChanged = 
        prev.blocks.length !== currentBlocks.length ||
        prev.pageTitle !== currentPageTitle ||
        prev.paddingMm !== currentPaddingMm ||
        prev.activeTemplate !== currentActiveTemplate ||
        JSON.stringify(prev.themeColors) !== JSON.stringify(currentThemeColors) ||
        prev.blocks.some((b, i) => !currentBlocks[i] || b.type !== currentBlocks[i].type || b.id !== currentBlocks[i].id) ||
        prev.blocks.some((b, i) => !currentBlocks[i] || JSON.stringify(b.canvas) !== JSON.stringify(currentBlocks[i].canvas));

      if (isStructureChanged) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        saveHistoryState(prev);
        lastSavedStateJson = currentStateJson;
      } else {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          saveHistoryState(prev);
          lastSavedStateJson = currentStateJson;
          debounceTimer = null;
        }, 800);
      }
    }
  });

  // Global Keydown Handler for Undo/Redo
  function handleGlobalKeyDown(e) {
    if (!currentPath.startsWith('/resume/')) return;

    const userPlatform = (navigator.userAgentData?.platform ?? navigator.platform ?? '').toUpperCase();
    const isMac = userPlatform.includes('MAC') || navigator.userAgent.includes('Mac');
    const isUndo = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
    const isRedo = 
      ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
      ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'y');

    if (isUndo) {
      e.preventDefault();
      undo();
    } else if (isRedo) {
      e.preventDefault();
      redo();
    }
  }

  // Sync paneWidth to localStorage
  try {
    const storedWidth = localStorage.getItem('notionToCV_paneWidth');
    if (storedWidth) {
      paneWidth = parseInt(storedWidth, 10);
    }
  } catch (e) {}

  $effect(() => {
    localStorage.setItem('notionToCV_paneWidth', paneWidth.toString());
  });

  // NOTE: We intentionally do NOT inject raw template CSS into the DOM anymore.
  // The layout engine (SVG + PDF) is the sole visual authority; templates supply
  // geometry only, and color/font/background come from themeColors (below).

  // Inject the page background color as a CSS variable.
  // The engine (SVG/PDF) bakes per-block color + font into the rendered output, so the
  // old per-block-type color/font overrides here were dead no-ops on the SVG-containing
  // wrappers and have been removed. Only the page/block BACKGROUND is still CSS-driven
  // (--cv-bg-color, consumed by .canvas-block and the page below).
  $effect(() => {
    let styleEl = document.getElementById('theme-color-overrides');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'theme-color-overrides';
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      .tmpl-${activeTemplate}, [class*="tmpl-"], .polished-container {
        --cv-text-color: ${themeColors.textColor};
        --cv-bg-color: ${themeColors.backgroundColor};
      }

      .polished-container .cv-page-container,
      .polished-container .cv-page {
        color: var(--cv-text-color) !important;
        background-color: var(--cv-bg-color) !important;
      }
    `;
  });

  // Auto-save currently active CV session
  $effect(() => {
    if (activeResumeId && blocks.length > 0) {
      const idx = resumes.findIndex(r => r.id === activeResumeId);
      if (idx !== -1) {
        const currentResume = resumes[idx];
        // Compare to prevent infinite save loops
        if (
          JSON.stringify(currentResume.blocks) !== JSON.stringify(blocks) ||
          currentResume.pageTitle !== pageTitle ||
          currentResume.paddingMm !== paddingMm ||
          currentResume.templateName !== activeTemplate ||
          JSON.stringify(currentResume.themeColors) !== JSON.stringify(themeColors)
        ) {
          resumes[idx] = {
            ...currentResume,
            blocks,
            pageTitle,
            paddingMm,
            templateName: activeTemplate,
            themeColors: { ...themeColors },
            updatedAt: new Date().toISOString()
          };
          localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
        }
      }
    }
  });

  // Helper to parse path and load CV data
  function handleRouteChange(path) {
    // Reset staged agent artifacts when switching context
    stagedChanges.set({});
    stagedAttachments.set([]);
    stagedChatBlockIds.set([]);

    // Reset history when switching resumes
    historyPast = [];
    historyFuture = [];
    lastSavedStateJson = "";
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (path === '/' || path === '/dashboard') {
      if (path === '/') {
        window.history.replaceState({}, '', '/dashboard');
        currentPath = '/dashboard';
      }
      activeResumeId = null;
    } else if (path.startsWith('/resume/')) {
      const id = path.substring(8);
      activeResumeId = id;
      const resume = resumes.find(r => r.id === id);
      if (resume) {
        blocks = JSON.parse(JSON.stringify(resume.blocks));
        // Ensure legacy blocks without a locked field default to unlocked
        blocks = blocks.map(b => ({ locked: false, ...b }));
        pageTitle = resume.pageTitle;
        paddingMm = resume.paddingMm;
        // Migrate any custom-template id to a built-in preset (geometry is ours).
        const normalizedTemplate = normalizeTemplateName(resume.templateName);
        activeTemplate = normalizedTemplate;
        const tdf = templateDefaultFonts[normalizedTemplate];
        themeColors = {
          h1Color: resume.themeColors?.h1Color ?? resume.themeColors?.primaryColor ?? '#0a2463',
          h2Color: resume.themeColors?.h2Color ?? resume.themeColors?.primaryColor ?? '#0a2463',
          h3Color: resume.themeColors?.h3Color ?? resume.themeColors?.textColor ?? '#1e1b18',
          textColor: resume.themeColors?.textColor ?? '#1e1b18',
          backgroundColor: resume.themeColors?.backgroundColor ?? '#ffffff',
          h1Font: resume.themeColors?.h1Font ?? tdf?.h1 ?? 'Inter',
          h2Font: resume.themeColors?.h2Font ?? tdf?.h2 ?? 'Inter',
          h3Font: resume.themeColors?.h3Font ?? tdf?.h3 ?? 'Inter',
          textFont: resume.themeColors?.textFont ?? tdf?.text ?? 'Inter'
        };
      }
    } else {
      activeResumeId = null;
    }
  }

  // Navigation helper
  function navigate(path) {
    window.history.pushState({}, '', path);
    currentPath = path;
    handleRouteChange(path);
  }

  onDestroy(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });

  onMount(async () => {
    // Initialize layout engine fonts (cached — no-op after first call)
    initFonts().catch(e => console.error('Font init error:', e));

    const params = new URLSearchParams(window.location.search);
    const hasExport = params.has('export');
    const printId = params.get('printId');

    if (hasExport) {
      isExportMode = true;
      document.body.classList.add('export-mode');
    }

    if (printId) {
      try {
        const res = await fetch(`/api/print-data?id=${printId}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.blocks)) {
            blocks = data.blocks;
            pageTitle = data.pageTitle ?? '';
            paddingMm = data.paddingMm ?? 15;
            const normalizedTemplate = normalizeTemplateName(data.templateName);
            if (data.templateName) activeTemplate = normalizedTemplate;
            if (data.themeColors) {
              const tdf = templateDefaultFonts[normalizedTemplate];
              themeColors = {
                h1Color: data.themeColors.h1Color ?? data.themeColors.primaryColor ?? '#0a2463',
                h2Color: data.themeColors.h2Color ?? data.themeColors.primaryColor ?? '#0a2463',
                h3Color: data.themeColors.h3Color ?? data.themeColors.textColor ?? '#1e1b18',
                textColor: data.themeColors.textColor ?? '#1e1b18',
                backgroundColor: data.themeColors.backgroundColor ?? '#ffffff',
                h1Font: data.themeColors.h1Font ?? tdf?.h1 ?? 'Inter',
                h2Font: data.themeColors.h2Font ?? tdf?.h2 ?? 'Inter',
                h3Font: data.themeColors.h3Font ?? tdf?.h3 ?? 'Inter',
                textFont: data.themeColors.textFont ?? tdf?.text ?? 'Inter'
              };
            }
          }
        }
      } catch (err) {
        console.error('Failed to load print data:', err);
      }
    } else {
      currentPath = window.location.pathname;
      handleRouteChange(currentPath);

      const handlePopState = () => {
        currentPath = window.location.pathname;
        handleRouteChange(currentPath);
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  });

  // Resizing left pane logic
  function startDragging(e) {
    e.preventDefault();
    isDragging = true;
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    const newWidth = e.clientX;
    const rightPaneMinWidth = 400;
    const maxPaneWidth = window.innerWidth - rightPaneMinWidth;
    if (newWidth >= 320 && newWidth <= maxPaneWidth) {
      paneWidth = newWidth;
    }
  }

  function stopDragging() {
    isDragging = false;
  }

  // Toggle lock state — blocks can be locked from either pane, so this lives
  // at the App level and is threaded through to all components.
  function toggleBlockLock(id) {
    blocks = blocks.map(b => b.id === id ? { ...b, locked: !b.locked } : b);
  }

  // Mutations within active session
  function updateBlockCanvas(id, patch) {
    const target = blocks.find(b => b.id === id);
    if (target?.locked) return;

    blocks = blocks.map(b => {
      if (b.id === id) {
        return {
          ...b,
          canvas: patch === null ? null : { ...(b.canvas || {}), ...patch }
        };
      }
      return b;
    });
  }

  // Update name inside active session
  function updateBlockName(id, name) {
    const target = blocks.find(b => b.id === id);
    if (target?.locked) return;

    blocks = blocks.map(b => b.id === id ? { ...b, name } : b);
  }

  // Canvas-only decorative elements (horizontal_divider, vertical_divider, headshot)
  function addCanvasElement(elementType) {
    const id = 'ce_' + Math.random().toString(36).substring(2, 9);
    blocks = [...blocks, {
      id,
      type: elementType,
      content: [],
      canvas: null,
      name: null,
      locked: false,
      source: 'canvas',
      elementType,
      imageData: null
    }];
    return id;
  }

  function removeCanvasElement(id) {
    const target = blocks.find(b => b.id === id);
    if (target?.locked) return;

    blocks = blocks.filter(b => b.id !== id);
  }

  function updateBlockImageData(id, dataUrl) {
    const target = blocks.find(b => b.id === id);
    if (target?.locked) return;

    blocks = blocks.map(b => b.id === id ? { ...b, imageData: dataUrl } : b);
  }

  // callbacks in /new route
  function handleNewTemplateSelect(templateId) {
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: 'Untitled CV',
      blocks: [{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null, locked: false }],
      paddingMm: 15,
      templateName: normalizeTemplateName(templateId),
      themeColors: {
        h1Color: '#0a2463',
        h2Color: '#0a2463',
        h3Color: '#1e1b18',
        textColor: '#1e1b18',
        backgroundColor: '#ffffff',
        h1Font: templateDefaultFonts[templateId]?.h1 ?? 'Inter',
        h2Font: templateDefaultFonts[templateId]?.h2 ?? 'Inter',
        h3Font: templateDefaultFonts[templateId]?.h3 ?? 'Inter',
        textFont: templateDefaultFonts[templateId]?.text ?? 'Inter'
      },
      updatedAt: new Date().toISOString()
    };
    resumes = [newResume, ...resumes];
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
    navigate('/resume/' + newResume.id);
  }

  // Import carries text (blocks) + a seeded color palette only. Geometry is ours
  // (a built-in preset); any imported CSS/templateId is intentionally ignored.
  function handleNewImport({ blocks: importedBlocks, templateId, themeColors: importedColors }) {
    const normalized = normalizeTemplateName(templateId);
    const tdf = templateDefaultFonts[normalized];
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: 'Imported CV',
      blocks: importedBlocks,
      paddingMm: 15,
      templateName: normalized,
      themeColors: {
        h1Color: importedColors?.h1Color ?? '#0a2463',
        h2Color: importedColors?.h2Color ?? '#0a2463',
        h3Color: importedColors?.h3Color ?? '#1e1b18',
        textColor: importedColors?.textColor ?? '#1e1b18',
        backgroundColor: importedColors?.backgroundColor ?? '#ffffff',
        // Default to the normalized template's fonts (e.g. elegant → Playfair/Lora),
        // not a blanket Inter — matches handleRouteChange so an imported resume looks
        // like its template instead of falling back to the wrong family.
        h1Font: importedColors?.h1Font ?? tdf?.h1 ?? 'Inter',
        h2Font: importedColors?.h2Font ?? tdf?.h2 ?? 'Inter',
        h3Font: importedColors?.h3Font ?? tdf?.h3 ?? 'Inter',
        textFont: importedColors?.textFont ?? tdf?.text ?? 'Inter'
      },
      updatedAt: new Date().toISOString()
    };
    resumes = [newResume, ...resumes];
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
    navigate('/resume/' + newResume.id);
  }

  // callbacks inside /resume/<id> when changing template
  function handleEditTemplateSelect(templateId) {
    activeTemplate = templateId;
  }

  function handleEditImport({ blocks: importedBlocks, templateId }) {
    blocks = importedBlocks.map(b => ({ locked: false, ...b }));
    activeTemplate = normalizeTemplateName(templateId);
  }

  function handleChangeTemplate() {
    activeTemplate = null;
  }

  function handleDeleteResume(id) {
    resumes = resumes.filter(r => r.id !== id);
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
  }

  // Human-review gate for the JD pipeline (Phase 6 FR6.6): an approved tailored
  // ResumeState is materialised as a new editable resume and opened in the editor.
  // This is the explicit approve action that precedes any downstream use — the
  // user reviews and saves from the live editor like any other CV.
  function handleApproveApplication(state) {
    if (!state || !Array.isArray(state.blocks)) return;
    const normalized = normalizeTemplateName(state.templateName);
    const tdf = templateDefaultFonts[normalized];
    const srcColors = state.themeColors || {};
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: state.title || 'Tailored CV',
      blocks: state.blocks.map(b => ({ locked: false, ...b })),
      paddingMm: state.paddingMm ?? 15,
      templateName: normalized,
      themeColors: {
        h1Color: srcColors.h1Color ?? '#0a2463',
        h2Color: srcColors.h2Color ?? '#0a2463',
        h3Color: srcColors.h3Color ?? '#1e1b18',
        textColor: srcColors.textColor ?? '#1e1b18',
        backgroundColor: srcColors.backgroundColor ?? '#ffffff',
        h1Font: srcColors.h1Font ?? tdf?.h1 ?? 'Inter',
        h2Font: srcColors.h2Font ?? tdf?.h2 ?? 'Inter',
        h3Font: srcColors.h3Font ?? tdf?.h3 ?? 'Inter',
        textFont: srcColors.textFont ?? tdf?.text ?? 'Inter'
      },
      updatedAt: new Date().toISOString()
    };
    resumes = [newResume, ...resumes];
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
    navigate('/resume/' + newResume.id);
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={stopDragging}
  onkeydown={handleGlobalKeyDown}
/>

{#if isExportMode}
  <!-- Render split-pane in export mode directly -->
  <div class="split-container export-mode">
    <div class="right-pane" style="width: 100%; max-width: none; flex: 1;">
      <PolishedPane
        blocks={blocks}
        bind:paddingMm={paddingMm}
        {updateBlockCanvas}
        {updateBlockName}
        isExportMode={true}
        pageTitle={pageTitle}
        templateName={activeTemplate ?? 'clean'}
        bind:themeColors={themeColors}
      />
    </div>
  </div>
{:else if currentPath === '/new'}
  <TemplateGallery
    onSelect={handleNewTemplateSelect}
    onImport={handleNewImport}
    onBackToDashboard={() => navigate('/dashboard')}
  />
{:else if currentPath.startsWith('/resume/')}
  {#if resumes.some(r => r.id === activeResumeId)}
    {#if !activeTemplate}
      <TemplateGallery
        onSelect={handleEditTemplateSelect}
        onImport={handleEditImport}
        onBackToDashboard={() => navigate('/dashboard')}
      />
    {:else}
      <div class="split-container">
        <div class="left-pane" style="width: {paneWidth}px;">
          <NotionPane
            bind:blocks={blocks}
            bind:pageTitle={pageTitle}
            bind:draggedBlockId={draggedBlockId}
            bind:paddingMm={paddingMm}
            bind:activeTemplate={activeTemplate}
            bind:themeColors={themeColors}
            undo={undo}
            redo={redo}
            historyPastLength={historyPast.length}
            historyFutureLength={historyFuture.length}
            onAskAI={handleAskAI}
            {acceptStagedChange}
            {denyStagedChange}
            {acceptAllStagedChanges}
            {denyAllStagedChanges}
            {toggleBlockLock}
          />
        </div>

        <button
          type="button"
          class="divider"
          class:active={isDragging}
          onpointerdown={startDragging}
          aria-label="Resize layout panes"
          style="border: none; outline: none; padding: 0; display: block;"
        ></button>

        <div class="right-pane">
            <PolishedPane
            blocks={blocks}
            bind:paddingMm={paddingMm}
            bind:draggedBlockId={draggedBlockId}
            {updateBlockCanvas}
            {updateBlockName}
            {addCanvasElement}
            {removeCanvasElement}
            {updateBlockImageData}
            isExportMode={false}
            pageTitle={pageTitle}
            templateName={activeTemplate ?? 'clean'}
            bind:themeColors={themeColors}
            onGoToDashboard={() => navigate('/dashboard')}
            onChangeTemplate={handleChangeTemplate}
            undo={undo}
            redo={redo}
            historyPastLength={historyPast.length}
            historyFutureLength={historyFuture.length}
            activeResumeId={activeResumeId}
            bind:isChatDrawerOpen={isChatDrawerOpen}
            {toggleBlockLock}
          />
        </div>
      </div>
    {/if}
  {:else}
    <div class="error-page">
      <h2>Resume not found</h2>
      <button onclick={() => navigate('/dashboard')}>Go to Dashboard</button>
    </div>
  {/if}
{:else}
  <!-- Default route /dashboard -->
  <Dashboard
    resumes={resumes}
    onEdit={(id) => navigate('/resume/' + id)}
    onDelete={handleDeleteResume}
    onCreateNew={() => navigate('/new')}
    onApprove={handleApproveApplication}
  />
{/if}

<style>
  .error-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background-color: #0f172a;
    color: #ffffff;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    gap: 16px;
  }

  .error-page h2 {
    font-size: 24px;
    font-weight: 700;
  }

  .error-page button {
    background-color: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .error-page button:hover {
    background-color: #1d4ed8;
  }
</style>
