<!-- Dashboard.svelte -->
<script>
  import { onMount } from 'svelte';

  let { resumes = [], onEdit, onDelete, onCreateNew, onApprove } = $props();

  let applications = $state([]);
  let showApplications = $state(false);
  // Keys (`<batchId>::<jd>`) of results whose diff/fit detail is expanded.
  let expandedResults = $state(new Set());
  // Keys currently being fetched into the editor (disables the approve button).
  let approvingResults = $state(new Set());
  let approveError = $state('');

  onMount(() => {
    fetch('/api/agent/applications')
      .then(r => r.json())
      .then(data => { applications = Array.isArray(data) ? data : []; })
      .catch(() => {});
  });

  async function discardBatch(batch) {
    if (!batch._batchId) return;
    try {
      await fetch(`/api/agent/applications/${batch._batchId}`, { method: 'DELETE' });
      applications = applications.filter(a => a._batchId !== batch._batchId);
    } catch (_) {}
  }

  function resultKey(batch, result) {
    return `${batch._batchId || ''}::${result.jd || result.role || ''}`;
  }

  function toggleResult(batch, result) {
    const key = resultKey(batch, result);
    const next = new Set(expandedResults);
    if (next.has(key)) next.delete(key); else next.add(key);
    expandedResults = next;
  }

  // Human-review gate (FR6.6): fetch the tailored ResumeState JSON and hand it to
  // the editor via onApprove. Explicit, per-result — nothing loads automatically.
  async function approveResult(batch, result) {
    if (!batch._batchId || !result.jd) return;
    const key = resultKey(batch, result);
    if (approvingResults.has(key)) return;

    approveError = '';
    approvingResults = new Set(approvingResults).add(key);
    try {
      const url = `/api/agent/applications/${batch._batchId}?file=${encodeURIComponent(result.jd)}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load tailored resume (${res.status})`);
      const state = await res.json();
      onApprove?.(state);
    } catch (err) {
      approveError = err.message || 'Failed to load tailored resume.';
      setTimeout(() => { approveError = ''; }, 5000);
    } finally {
      const next = new Set(approvingResults);
      next.delete(key);
      approvingResults = next;
    }
  }

  function formatDate(isoString) {
    if (!isoString) return 'Never';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'Unknown';
    }
  }

  function getTemplateLabel(id) {
    if (!id) return 'Clean';
    if (id.startsWith('custom-')) return 'Custom AI Template';
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function handleDelete(id, title, event) {
    event.stopPropagation();
    const confirmed = confirm(`Are you sure you want to delete "${title || 'Untitled CV'}"?`);
    if (confirmed) {
      onDelete?.(id);
    }
  }
</script>

<div class="dashboard-backdrop">
  <div class="dashboard-container">
    
    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-left">
        <span class="app-logo">🏛️</span>
        <h1 class="dashboard-title">NotionToCV</h1>
      </div>
      <button type="button" class="btn-create-new" onclick={onCreateNew}>
        <span class="plus-icon">+</span> Create New CV
      </button>
    </header>

    <!-- Main List -->
    {#if resumes.length === 0}
      <!-- Empty State -->
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <h2 class="empty-title">No Resumes Found</h2>
        <p class="empty-subtitle">Begin your new document using a premium template or transcribe an existing PDF.</p>
        <button type="button" class="btn-create-new large" onclick={onCreateNew}>
          Create Your First CV
        </button>
      </div>
    {:else}
      <!-- Grid -->
      <div class="cv-grid">
        {#each resumes as cv (cv.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cv-card" onclick={() => onEdit?.(cv.id)}>
            <div class="card-body">
              <h3 class="cv-title">{cv.pageTitle?.trim() || 'Untitled CV'}</h3>
              <div class="cv-meta">
                <span class="meta-item">
                  <span class="meta-icon">🎨</span>
                  {getTemplateLabel(cv.templateName)}
                </span>
                <span class="meta-item">
                  <span class="meta-icon">🧩</span>
                  {cv.blocks ? cv.blocks.length : 0} blocks
                </span>
              </div>
              <p class="cv-date">Updated: {formatDate(cv.updatedAt)}</p>
            </div>
            
            <div class="card-actions">
              <button type="button" class="btn-action edit" onclick={() => onEdit?.(cv.id)}>
                Edit CV
              </button>
              <button type="button" class="btn-action delete" onclick={(e) => handleDelete(cv.id, cv.pageTitle, e)}>
                Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Applications (Phase 6 results surface) -->
    {#if applications.length > 0}
      <section class="applications-section">
        <button type="button" class="applications-toggle" onclick={() => showApplications = !showApplications}>
          <span class="app-icon">📋</span>
          Applications — {applications.length} batch{applications.length !== 1 ? 'es' : ''}
          <span class="toggle-arrow" class:open={showApplications}>▾</span>
        </button>

        {#if showApplications}
          <div class="applications-list">
            {#each applications as batch}
              <div class="app-batch">
                <div class="batch-header">
                  <span class="batch-icon">🎯</span>
                  <span class="batch-count">{batch.pipeline?.jdCount || 0} JDs</span>
                  <span class="batch-cost">${batch.pipeline?.estimatedCost || '0.00'} est.</span>
                </div>
                <div class="batch-results">
                  {#each batch.results || [] as result}
                    {@const reviewable = result.status === 'done' || result.status === 'overflow'}
                    {@const expanded = expandedResults.has(resultKey(batch, result))}
                    {@const approving = approvingResults.has(resultKey(batch, result))}
                    <div class="batch-result-wrap">
                      <div class="batch-result" class:done={result.status === 'done'} class:overflow={result.status === 'overflow'} class:error={result.status === 'error'}>
                        <button type="button" class="result-expand" class:open={expanded}
                          disabled={!reviewable && !result.filterRationale}
                          onclick={() => toggleResult(batch, result)} aria-label="Toggle details">▸</button>
                        <span class="result-name">{result.jd || result.role || 'Unknown'}</span>
                        <span class="result-status">{result.status}</span>
                        <span class="result-detail">
                          {result.blocksChanged || 0}/{result.blocksScoped || 0} blocks
                          {#if result.capacityViolations > 0}
                            · {result.capacityViolations} overflow
                          {/if}
                        </span>
                        <span class="result-actions">
                          {#if reviewable}
                            <button type="button" class="action-link approve" disabled={approving}
                              onclick={() => approveResult(batch, result)}>
                              {approving ? '⏳ Loading…' : '✓ Approve & Edit'}
                            </button>
                            <a href={`/api/agent/applications/${batch._batchId || ''}?file=${encodeURIComponent(result.jd || '')}.pdf`} class="action-link" download>📄 PDF</a>
                          {/if}
                        </span>
                      </div>

                      {#if expanded}
                        <div class="result-detail-panel">
                          {#if result.error}
                            <p class="detail-error">⚠ {result.error}</p>
                          {/if}
                          {#if result.filterRationale}
                            <div class="detail-row">
                              <span class="detail-label">Relevance filter</span>
                              <span class="detail-text">{result.filterRationale}</span>
                            </div>
                          {/if}
                          <div class="detail-row">
                            <span class="detail-label">Fit</span>
                            <span class="detail-text">
                              {result.blocksChanged || 0} of {result.blocksScoped || 0} scoped blocks rewritten ·
                              {result.capacityViolations > 0 ? `${result.capacityViolations} block(s) overflow` : 'all blocks within capacity'}
                              {#if result.doneReason} · ended: {result.doneReason}{/if}
                            </span>
                          </div>

                          {#if (result.changedBlocks || []).length > 0}
                            <div class="diff-list">
                              {#each result.changedBlocks as cb}
                                <div class="diff-block">
                                  <div class="diff-block-head">{cb.name || cb.id} <span class="diff-block-type">{cb.type}</span></div>
                                  {#if cb.diff}
                                    <div class="diff-line removed"><span class="diff-marker">−</span>{cb.diff.old || '(empty)'}</div>
                                    <div class="diff-line added"><span class="diff-marker">+</span>{cb.diff.new || '(empty)'}</div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else if reviewable}
                            <p class="detail-text muted">No block content changed.</p>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
                {#if approveError}
                  <p class="approve-error">{approveError}</p>
                {/if}
                <div class="batch-actions">
                  <button type="button" class="btn-review-action discard"
                    onclick={() => discardBatch(batch)}>🗑 Discard Batch</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

  </div>
</div>

<style>
  .dashboard-backdrop {
    min-height: 100vh;
    background-color: var(--surface-2);
    background-image: radial-gradient(circle at 100% 100%, rgba(62, 146, 204, 0.05) 0%, transparent 40%),
                      radial-gradient(circle at 0% 0%, rgba(10, 36, 99, 0.03) 0%, transparent 30%);
    display: flex;
    justify-content: center;
    padding: 60px 24px 100px;
    font-family: var(--font-serif);
    color: var(--color-carbon-black);
    box-sizing: border-box;
  }

  .dashboard-container {
    width: 100%;
    max-width: 960px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  /* Header styles */
  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--outline-subtle);
    padding-bottom: 24px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .app-logo {
    font-size: 28px;
    color: var(--color-imperial-blue);
  }

  .dashboard-title {
    font-family: var(--font-serif);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--color-imperial-blue);
    margin: 0;
  }

  .btn-create-new {
    background-color: var(--color-magenta-bloom);
    color: #ffffff;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 10px 20px;
    border-radius: var(--radius-default);
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: background-color 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 2px 8px rgba(216, 49, 91, 0.2);
  }

  .btn-create-new:hover {
    background-color: #be284e;
    transform: translateY(-1px);
    box-shadow: var(--shadow-ambient);
  }

  .btn-create-new:active {
    transform: translateY(1px);
  }

  .btn-create-new.large {
    font-size: 14px;
    padding: 12px 28px;
    margin-top: 10px;
  }

  .plus-icon {
    font-size: 16px;
    line-height: 1;
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 80px 40px;
    background: var(--color-ghost-white);
    border: 1px solid var(--outline-subtle);
    border-radius: var(--radius-lg);
    gap: 16px;
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.02);
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: 8px;
    opacity: 0.85;
  }

  .empty-title {
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 700;
    color: var(--color-imperial-blue);
    margin: 0;
  }

  .empty-subtitle {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--notion-text-muted);
    max-width: 340px;
    margin: 0 0 8px;
    line-height: 1.5;
  }

  /* CV Cards Grid */
  .cv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
  }

  .cv-card {
    background: var(--color-ghost-white);
    border: 1px solid var(--outline-subtle);
    border-radius: var(--radius-lg);
    padding: 24px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 180px;
    gap: 20px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  }

  /* Sliding Imperial Blue left-border accent line */
  .cv-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 3px;
    background-color: var(--color-imperial-blue);
    transform: scaleY(0);
    transition: transform 0.2s ease;
  }

  .cv-card:hover {
    border-color: rgba(62, 146, 204, 0.4);
    transform: translateY(-3px);
    box-shadow: var(--shadow-ambient);
  }

  .cv-card:hover::before {
    transform: scaleY(1);
  }

  .cv-title {
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 700;
    color: var(--color-imperial-blue);
    margin: 0 0 12px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cv-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--notion-text-muted);
    font-family: var(--font-sans);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .meta-icon {
    font-size: 13px;
  }

  .cv-date {
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--notion-text-muted);
    opacity: 0.8;
    margin: 0;
  }

  .card-actions {
    display: flex;
    gap: 12px;
    border-top: 1px solid var(--outline-subtle);
    padding-top: 16px;
  }

  .btn-action {
    flex: 1;
    border: none;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 0;
    border-radius: var(--radius-default);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    text-align: center;
  }

  .btn-action.edit {
    background-color: transparent;
    border: 1px solid var(--color-imperial-blue);
    color: var(--color-imperial-blue);
  }

  .btn-action.edit:hover {
    background-color: rgba(10, 36, 99, 0.05);
  }

  .btn-action.delete {
    background-color: rgba(186, 26, 26, 0.03);
    border: 1px solid rgba(186, 26, 26, 0.15);
    color: var(--error);
  }

  .btn-action.delete:hover {
    background-color: rgba(229, 62, 62, 0.08);
    border-color: var(--color-imperial-red);
    color: var(--color-imperial-red);
  }

  /* Applications section (Phase 6) */
  .applications-section {
    margin: 24px 0 0 0;
    border-top: 1px solid var(--outline-subtle);
    padding-top: 20px;
  }
  .applications-toggle {
    width: 100%;
    background: none;
    border: none;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .applications-toggle:hover { opacity: 0.8; }
  .app-icon { font-size: 18px; }
  .toggle-arrow { margin-left: auto; transition: transform 0.2s; }
  .toggle-arrow.open { transform: rotate(180deg); }
  .applications-list { margin-top: 12px; }
  .app-batch {
    background: var(--surface-1);
    border: 1px solid var(--outline-subtle);
    border-radius: var(--radius-default);
    padding: 16px;
    margin-bottom: 12px;
  }
  .batch-header {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .batch-icon { font-size: 16px; }
  .batch-count { font-weight: 600; }
  .batch-cost { margin-left: auto; font-family: monospace; }
  .batch-results { display: flex; flex-direction: column; gap: 6px; }
  .batch-result {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    background: var(--surface-2);
  }
  .batch-result.done { border-left: 3px solid #10b981; }
  .batch-result.overflow { border-left: 3px solid #f59e0b; }
  .batch-result.error { border-left: 3px solid #ef4444; }
  .result-name { font-weight: 600; min-width: 120px; }
  .result-status {
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .done .result-status { background: #d1fae5; color: #065f46; }
  .overflow .result-status { background: #fef3c7; color: #92400e; }
  .error .result-status { background: #fee2e2; color: #991b1b; }
  .result-detail { color: var(--text-muted); font-size: 12px; }
  .result-actions { margin-left: auto; }
  .action-link {
    font-size: 12px;
    color: var(--color-imperial-blue);
    text-decoration: none;
    padding: 2px 8px;
    border: 1px solid var(--outline-subtle);
    border-radius: 4px;
  }
  .action-link:hover { background: rgba(62, 146, 204, 0.08); }
  .action-link.approve {
    background: var(--color-imperial-blue);
    color: #fff;
    border-color: var(--color-imperial-blue);
    cursor: pointer;
    font-family: var(--font-sans);
    font-weight: 600;
  }
  .action-link.approve:hover:not(:disabled) { background: #082052; }
  .action-link.approve:disabled { opacity: 0.6; cursor: default; }

  /* Result detail panel (diff + fit report) */
  .batch-result-wrap { display: flex; flex-direction: column; }
  .result-expand {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 11px;
    padding: 0 2px;
    transition: transform 0.15s;
    line-height: 1;
  }
  .result-expand.open { transform: rotate(90deg); }
  .result-expand:disabled { opacity: 0.25; cursor: default; }
  .result-detail-panel {
    background: var(--surface-1);
    border: 1px solid var(--outline-subtle);
    border-top: none;
    border-radius: 0 0 6px 6px;
    padding: 12px 14px;
    margin: -2px 0 4px;
    font-family: var(--font-sans);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .detail-error { color: #991b1b; font-size: 12px; margin: 0; }
  .detail-row { display: flex; gap: 8px; font-size: 12px; line-height: 1.5; }
  .detail-label {
    flex-shrink: 0;
    min-width: 110px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    color: var(--text-muted);
    padding-top: 1px;
  }
  .detail-text { color: var(--text-secondary); }
  .detail-text.muted { color: var(--text-muted); font-size: 12px; margin: 0; }
  .diff-list { display: flex; flex-direction: column; gap: 10px; }
  .diff-block {
    border-left: 2px solid var(--outline-subtle);
    padding-left: 10px;
  }
  .diff-block-head {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .diff-block-type {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 500;
    margin-left: 4px;
  }
  .diff-line {
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 2px 6px;
    border-radius: 3px;
    display: flex;
    gap: 6px;
  }
  .diff-line.removed { background: #fef2f2; color: #991b1b; }
  .diff-line.added { background: #ecfdf5; color: #065f46; }
  .diff-marker { flex-shrink: 0; font-weight: 700; user-select: none; }
  .approve-error {
    color: var(--color-imperial-red);
    font-size: 12px;
    margin: 8px 0 0;
    font-family: var(--font-sans);
  }
  .batch-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--outline-subtle);
  }
  .btn-review-action {
    background: none;
    border: 1px solid var(--outline-subtle);
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 4px 12px;
    border-radius: var(--radius-default);
    cursor: pointer;
    color: var(--text-muted);
  }
  .btn-review-action:hover { color: var(--color-imperial-red); border-color: var(--color-imperial-red); }
</style>
