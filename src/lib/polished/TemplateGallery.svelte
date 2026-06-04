<!-- TemplateGallery.svelte -->
<script>
  import { onMount } from 'svelte';

  let { onSelect } = $props();

  // Compute scale so the 210mm-wide preview-page fills its wrapper
  let previewWrappers = $state([]);
  let previewScale = $state(0.19);

  onMount(() => {
    function updateScale() {
      if (previewWrappers[0]) {
        const wrapperPx = previewWrappers[0].getBoundingClientRect().width;
        const pageWidthPx = 210 * (96 / 25.4); // 210mm in CSS px at 96dpi
        previewScale = wrapperPx / pageWidthPx;
      }
    }
    updateScale();
    const ro = new ResizeObserver(updateScale);
    previewWrappers.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  });

  const templates = [
    {
      id: 'clean',
      name: 'Clean',
      tagline: 'Minimal & Timeless',
      desc: 'Inter · Pure black on white · Uppercase section dividers'
    },
    {
      id: 'modern',
      name: 'Modern',
      tagline: 'Bold & Technical',
      desc: 'Space Grotesk · Navy blue accents · Left-border section style'
    },
    {
      id: 'elegant',
      name: 'Elegant',
      tagline: 'Classic & Refined',
      desc: 'Playfair Display · Lora body · Terracotta italic headings'
    },
    {
      id: 'compact',
      name: 'Compact',
      tagline: 'Efficient & Dense',
      desc: 'Outfit · Deep green accents · Tight line heights for more content'
    }
  ];
</script>

<div class="gallery-backdrop">
  <div class="gallery-content">
    <div class="gallery-header">
      <h1 class="gallery-title">Choose a template</h1>
      <p class="gallery-subtitle">You can change this any time from the toolbar</p>
    </div>

    <div class="gallery-grid">
      {#each templates as tmpl, i}
        <button class="template-card" onclick={() => onSelect(tmpl.id)} type="button">
          <div class="preview-wrapper" bind:this={previewWrappers[i]}>
            <div class="preview-page" style="--preview-scale: {previewScale}">
              <div style="padding: 15mm;">
                <div class="block-type-h1 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Jane Smith</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}" style="margin-bottom: 6mm;">Product Designer · San Francisco, CA</div>
                <div class="block-type-h2 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Experience</div>
                <div class="block-type-h3 tmpl-{tmpl.id}" style="margin-bottom: 2mm;">Senior Designer, Acme Corp</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}" style="margin-bottom: 6mm;">Led product design across mobile platforms. Collaborated with engineers to ship features used by 2M+ users.</div>
                <div class="block-type-h2 tmpl-{tmpl.id}" style="margin-bottom: 4mm;">Education</div>
                <div class="block-type-h3 tmpl-{tmpl.id}" style="margin-bottom: 2mm;">BSc Computer Science, MIT</div>
                <div class="block-type-paragraph tmpl-{tmpl.id}">2015 — 2019 · GPA 3.9/4.0</div>
              </div>
            </div>
          </div>

          <div class="card-info">
            <span class="card-name">{tmpl.name}</span>
            <span class="card-tagline">{tmpl.tagline}</span>
            <span class="card-desc">{tmpl.desc}</span>
          </div>

          <div class="card-cta">Use template →</div>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .gallery-backdrop {
    position: fixed;
    inset: 0;
    background-color: #f8fafc;
    overflow-y: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 60px 24px 80px;
    z-index: 1000;
  }

  .gallery-content {
    width: 100%;
    max-width: 960px;
  }

  .gallery-header {
    text-align: center;
    margin-bottom: 48px;
  }

  .gallery-title {
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.5px;
    margin: 0 0 8px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .gallery-subtitle {
    font-size: 14px;
    color: #64748b;
    margin: 0;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }

  @media (max-width: 860px) {
    .gallery-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .template-card {
    background: #ffffff;
    border: 1.5px solid rgba(55, 53, 47, 0.1);
    border-radius: 12px;
    padding: 16px 16px 20px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .template-card:hover {
    border-color: #2383e2;
    box-shadow: 0 4px 20px rgba(35, 131, 226, 0.12);
    transform: translateY(-2px);
  }

  .template-card:focus-visible {
    outline: 2px solid #2383e2;
    outline-offset: 2px;
  }

  /* Scaled A4 preview */
  .preview-wrapper {
    /* 210mm × 0.19 ≈ 159px, 297mm × 0.19 ≈ 225px */
    width: 100%;
    aspect-ratio: 210 / 297;
    overflow: hidden;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    position: relative;
  }

  .preview-page {
    width: 210mm;
    height: 297mm;
    background: #ffffff;
    position: absolute;
    top: 0;
    left: 0;
    /* Scale is set inline via JS since it depends on rendered width */
    transform-origin: 0 0;
    transform: scale(var(--preview-scale, 0.19));
    pointer-events: none;
  }

  .card-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .card-name {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
  }

  .card-tagline {
    font-size: 12px;
    font-weight: 600;
    color: #2383e2;
    line-height: 1.3;
  }

  .card-desc {
    font-size: 11px;
    color: #64748b;
    line-height: 1.4;
    margin-top: 2px;
  }

  .card-cta {
    font-size: 12px;
    font-weight: 600;
    color: #2383e2;
    padding: 6px 12px;
    border-radius: 6px;
    background-color: rgba(35, 131, 226, 0.08);
    text-align: center;
    transition: background-color 0.15s;
  }

  .template-card:hover .card-cta {
    background-color: rgba(35, 131, 226, 0.15);
  }
</style>
