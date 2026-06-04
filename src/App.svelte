<script>
  import { onMount } from 'svelte';
  import NotionPane from './lib/notion/NotionPane.svelte';
  import PolishedPane from './lib/polished/PolishedPane.svelte';
  import TemplateGallery from './lib/polished/TemplateGallery.svelte';
  import Dashboard from './lib/polished/Dashboard.svelte';
  import './lib/polished/templates/clean.css';
  import './lib/polished/templates/modern.css';
  import './lib/polished/templates/elegant.css';
  import './lib/polished/templates/compact.css';

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

  // Router state
  let currentPath = $state('/dashboard');
  let activeResumeId = $state(null);

  // Editor states (bound to active CV session)
  let blocks = $state([{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null }]);
  let pageTitle = $state('');
  let paddingMm = $state(15);
  let activeTemplate = $state('clean');
  let customTemplates = $state({}); // { [id]: cssString }

  // Shared UI states
  let paneWidth = $state(480);
  let isDragging = $state(false);
  let draggedBlockId = $state(null);
  let isExportMode = $state(false);

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

  // Inject custom template CSS
  $effect(() => {
    const allCss = Object.values(customTemplates).join('\n');
    let styleEl = document.getElementById('custom-template-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-template-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = allCss;
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
          JSON.stringify(currentResume.customTemplates) !== JSON.stringify(customTemplates)
        ) {
          resumes[idx] = {
            ...currentResume,
            blocks,
            pageTitle,
            paddingMm,
            templateName: activeTemplate,
            customTemplates,
            updatedAt: new Date().toISOString()
          };
          localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
        }
      }
    }
  });

  // Helper to parse path and load CV data
  function handleRouteChange(path) {
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
        pageTitle = resume.pageTitle;
        paddingMm = resume.paddingMm;
        activeTemplate = resume.templateName;
        customTemplates = resume.customTemplates;
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

  onMount(async () => {
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
            if (data.templateName) activeTemplate = data.templateName;
            if (data.customTemplates) customTemplates = data.customTemplates;
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

  // Mutations within active session
  function updateBlockCanvas(id, patch) {
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
    blocks = blocks.map(b => {
      if (b.id === id) {
        return { ...b, name };
      }
      return b;
    });
  }

  // callbacks in /new route
  function handleNewTemplateSelect(templateId) {
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: 'Untitled CV',
      blocks: [{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null }],
      paddingMm: 15,
      templateName: templateId,
      customTemplates: {},
      updatedAt: new Date().toISOString()
    };
    resumes = [newResume, ...resumes];
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
    navigate('/resume/' + newResume.id);
  }

  function handleNewImport({ blocks: importedBlocks, css, templateId }) {
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: 'Imported CV',
      blocks: importedBlocks,
      paddingMm: 15,
      templateName: templateId,
      customTemplates: { [templateId]: css },
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

  function handleEditImport({ blocks: importedBlocks, css, templateId }) {
    customTemplates = { ...customTemplates, [templateId]: css };
    blocks = importedBlocks;
    activeTemplate = templateId;
  }

  function handleChangeTemplate() {
    activeTemplate = null;
  }

  function handleDeleteResume(id) {
    resumes = resumes.filter(r => r.id !== id);
    localStorage.setItem('notionToCV_resumes', JSON.stringify(resumes));
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={stopDragging}
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
        customTemplates={customTemplates}
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
            bind:customTemplates={customTemplates}
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
            isExportMode={false}
            pageTitle={pageTitle}
            templateName={activeTemplate ?? 'clean'}
            customTemplates={customTemplates}
            onGoToDashboard={() => navigate('/dashboard')}
            onChangeTemplate={handleChangeTemplate}
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
