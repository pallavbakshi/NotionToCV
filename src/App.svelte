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

  // Default font mapping for each template
  const templateDefaultFonts = {
    clean: { h1: 'Inter', h2: 'Inter', h3: 'Inter', text: 'Inter' },
    modern: { h1: 'Space Grotesk', h2: 'Space Grotesk', h3: 'Space Grotesk', text: 'Space Grotesk' },
    elegant: { h1: 'Playfair Display', h2: 'Playfair Display', h3: 'Playfair Display', text: 'Lora' },
    compact: { h1: 'Outfit', h2: 'Outfit', h3: 'Outfit', text: 'Outfit' }
  };

  // Router state
  let currentPath = $state('/dashboard');
  let activeResumeId = $state(null);

  // Editor states (bound to active CV session)
  let blocks = $state([{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null }]);
  let pageTitle = $state('');
  let paddingMm = $state(15);
  let activeTemplate = $state('clean');
  let customTemplates = $state({}); // { [id]: cssString }
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

  // Inject theme-color-overrides CSS variables
  $effect(() => {
    let styleEl = document.getElementById('theme-color-overrides');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'theme-color-overrides';
      document.head.appendChild(styleEl);
    }
    // Helper function to format font stack
    function getFontStack(f) {
      const serif = ['Lora', 'Playfair Display'];
      const mono = ['Fira Code'];
      const generic = serif.includes(f) ? 'serif' : mono.includes(f) ? 'monospace' : 'sans-serif';
      return `'${f}', ${generic}`;
    }

    styleEl.textContent = `
      .tmpl-${activeTemplate}, [class*="tmpl-"], .polished-container {
        --cv-h1-color: ${themeColors.h1Color};
        --cv-h2-color: ${themeColors.h2Color};
        --cv-h3-color: ${themeColors.h3Color};
        --cv-text-color: ${themeColors.textColor};
        --cv-bg-color: ${themeColors.backgroundColor};
        --cv-h1-font: ${getFontStack(themeColors.h1Font ?? 'Inter')};
        --cv-h2-font: ${getFontStack(themeColors.h2Font ?? 'Inter')};
        --cv-h3-font: ${getFontStack(themeColors.h3Font ?? 'Inter')};
        --cv-text-font: ${getFontStack(themeColors.textFont ?? 'Inter')};
      }
      
      .polished-container .cv-page-container,
      .polished-container .cv-page {
        color: var(--cv-text-color) !important;
        background-color: var(--cv-bg-color) !important;
      }
      
      .polished-container .block-type-h1 {
        color: var(--cv-h1-color) !important;
        font-family: var(--cv-h1-font);
        background-color: transparent !important;
      }
      .polished-container .block-type-h2 {
        color: var(--cv-h2-color) !important;
        border-color: var(--cv-h2-color) !important;
        font-family: var(--cv-h2-font);
        background-color: transparent !important;
      }
      .polished-container .block-type-h3 {
        color: var(--cv-h3-color) !important;
        font-family: var(--cv-h3-font);
        background-color: transparent !important;
      }
      
      .polished-container .block-type-paragraph,
      .polished-container .block-type-todo,
      .polished-container .block-type-bullet,
      .polished-container .block-type-number {
        color: var(--cv-text-color) !important;
        font-family: var(--cv-text-font);
        background-color: transparent !important;
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
          JSON.stringify(currentResume.customTemplates) !== JSON.stringify(customTemplates) ||
          JSON.stringify(currentResume.themeColors) !== JSON.stringify(themeColors)
        ) {
          resumes[idx] = {
            ...currentResume,
            blocks,
            pageTitle,
            paddingMm,
            templateName: activeTemplate,
            customTemplates,
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
        customTemplates = JSON.parse(JSON.stringify(resume.customTemplates || {}));
        themeColors = {
          h1Color: resume.themeColors?.h1Color ?? resume.themeColors?.primaryColor ?? '#0a2463',
          h2Color: resume.themeColors?.h2Color ?? resume.themeColors?.primaryColor ?? '#0a2463',
          h3Color: resume.themeColors?.h3Color ?? resume.themeColors?.textColor ?? '#1e1b18',
          textColor: resume.themeColors?.textColor ?? '#1e1b18',
          backgroundColor: resume.themeColors?.backgroundColor ?? '#ffffff',
          h1Font: resume.themeColors?.h1Font ?? templateDefaultFonts[resume.templateName]?.h1 ?? 'Inter',
          h2Font: resume.themeColors?.h2Font ?? templateDefaultFonts[resume.templateName]?.h2 ?? 'Inter',
          h3Font: resume.themeColors?.h3Font ?? templateDefaultFonts[resume.templateName]?.h3 ?? 'Inter',
          textFont: resume.themeColors?.textFont ?? templateDefaultFonts[resume.templateName]?.text ?? 'Inter'
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
            if (data.themeColors) {
              themeColors = {
                h1Color: data.themeColors.h1Color ?? data.themeColors.primaryColor ?? '#0a2463',
                h2Color: data.themeColors.h2Color ?? data.themeColors.primaryColor ?? '#0a2463',
                h3Color: data.themeColors.h3Color ?? data.themeColors.textColor ?? '#1e1b18',
                textColor: data.themeColors.textColor ?? '#1e1b18',
                backgroundColor: data.themeColors.backgroundColor ?? '#ffffff',
                h1Font: data.themeColors.h1Font ?? templateDefaultFonts[data.templateName]?.h1 ?? 'Inter',
                h2Font: data.themeColors.h2Font ?? templateDefaultFonts[data.templateName]?.h2 ?? 'Inter',
                h3Font: data.themeColors.h3Font ?? templateDefaultFonts[data.templateName]?.h3 ?? 'Inter',
                textFont: data.themeColors.textFont ?? templateDefaultFonts[data.templateName]?.text ?? 'Inter'
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

  function handleNewImport({ blocks: importedBlocks, css, templateId, themeColors: importedColors }) {
    const newResume = {
      id: 'res_' + Math.random().toString(36).substring(2, 9),
      pageTitle: 'Imported CV',
      blocks: importedBlocks,
      paddingMm: 15,
      templateName: templateId,
      customTemplates: { [templateId]: css },
      themeColors: {
        h1Color: importedColors?.h1Color ?? '#0a2463',
        h2Color: importedColors?.h2Color ?? '#0a2463',
        h3Color: importedColors?.h3Color ?? '#1e1b18',
        textColor: importedColors?.textColor ?? '#1e1b18',
        backgroundColor: importedColors?.backgroundColor ?? '#ffffff',
        h1Font: importedColors?.h1Font ?? 'Inter',
        h2Font: importedColors?.h2Font ?? 'Inter',
        h3Font: importedColors?.h3Font ?? 'Inter',
        textFont: importedColors?.textFont ?? 'Inter'
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
            bind:customTemplates={customTemplates}
            bind:themeColors={themeColors}
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
            bind:themeColors={themeColors}
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
