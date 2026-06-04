<!-- PolishedPane.svelte -->
<div class="polished-container">
  <!-- Decorative background elements -->
  <div class="glow glow-1"></div>
  <div class="glow glow-2"></div>

  <!-- A4 Canvas Mockup Page -->
  <div class="cv-mock-page">
    <div class="cv-header">
      <div class="mock-line mock-title"></div>
      <div class="mock-line mock-subtitle"></div>
    </div>
    
    <div class="cv-body">
      <div class="cv-left-col">
        <div class="mock-section">
          <div class="mock-line mock-sec-title"></div>
          <div class="mock-line mock-body-line"></div>
          <div class="mock-line mock-body-line short"></div>
        </div>
        <div class="mock-section">
          <div class="mock-line mock-sec-title"></div>
          <div class="mock-line mock-body-line"></div>
          <div class="mock-line mock-body-line"></div>
        </div>
      </div>
      
      <div class="cv-right-col">
        <div class="mock-section">
          <div class="mock-line mock-sec-title"></div>
          <div class="mock-line mock-body-line"></div>
          <div class="mock-line mock-body-line"></div>
          <div class="mock-line mock-body-line short"></div>
        </div>
      </div>
    </div>

    <!-- Glassmorphic overlay message -->
    <div class="overlay-card">
      <div class="icon-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      </div>
      <h2>Polished Canvas</h2>
      <p>Your beautiful resume builder preview will appear here in Phase 2. Drag blocks from the Notion editor to arrange your layout.</p>
      <div class="badge">Phase 2 Coming Soon</div>
    </div>
  </div>
</div>

<style>
  .polished-container {
    width: 100%;
    height: 100%;
    background-color: #f7f7f8;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    padding: 40px;
  }

  /* Decorative glows */
  .glow {
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.15;
    pointer-events: none;
  }
  .glow-1 {
    top: -50px;
    right: -50px;
    background-color: #2383e2;
  }
  .glow-2 {
    bottom: -50px;
    left: -50px;
    background-color: #aa3bff;
  }

  /* A4 Page Mockup */
  .cv-mock-page {
    width: 100%;
    max-width: 500px;
    aspect-ratio: 1 / 1.414; /* A4 aspect ratio */
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04), 0 1px 8px rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(55, 53, 47, 0.06);
    padding: 40px 30px;
    display: flex;
    flex-direction: column;
    gap: 30px;
    position: relative;
  }

  .cv-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1.5px solid #f0f0f0;
    padding-bottom: 20px;
  }

  .mock-line {
    background-color: #f1f1f2;
    border-radius: 4px;
  }

  .mock-title {
    width: 60%;
    height: 24px;
    background: linear-gradient(90deg, #eaeaea, #f5f5f5);
  }

  .mock-subtitle {
    width: 40%;
    height: 12px;
  }

  .cv-body {
    display: flex;
    gap: 24px;
    flex-grow: 1;
  }

  .cv-left-col {
    flex: 2;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .cv-right-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .mock-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mock-sec-title {
    width: 45%;
    height: 14px;
    background-color: #e6e6e8;
  }

  .mock-body-line {
    width: 100%;
    height: 8px;
  }

  .mock-body-line.short {
    width: 75%;
  }

  /* Glassmorphic Overlay Card */
  .overlay-card {
    position: absolute;
    inset: 20px;
    background: rgba(255, 255, 255, 0.75);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 30px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
    z-index: 2;
  }

  .icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: rgba(35, 131, 226, 0.08);
    color: var(--notion-blue);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    animation: float 3s ease-in-out infinite;
  }

  .overlay-card h2 {
    font-size: 20px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 10px;
  }

  .overlay-card p {
    font-size: 14px;
    line-height: 1.5;
    color: #5a5a62;
    max-width: 320px;
    margin-bottom: 20px;
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--notion-blue);
    background: var(--notion-blue-bg);
    padding: 4px 10px;
    border-radius: 100px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }
</style>
