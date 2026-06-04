<!-- Home.svelte -->
<script>
  import { onMount } from 'svelte';

  // Svelte 5 props
  let { navigate } = $props();

  let isScrolled = $state(false);
  let mobileMenuOpen = $state(false);
  let email = $state('');
  let submitted = $state(false);

  function handleScroll() {
    isScrolled = window.scrollY > 10;
  }

  onMount(() => {
    // Enable body scrolling while on the homepage
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      // Revert styles when leaving the homepage
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  });

  function handleWaitlistSubmit(e) {
    e.preventDefault();
    if (email.trim()) {
      // TODO: replace with real backend once /api/waitlist exists
      fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      }).catch(() => {});
      submitted = true;
    }
  }
</script>

<svelte:head>
  <title>ResumeElite - Stop rewriting your resume</title>
</svelte:head>

<div class="light bg-surface text-on-surface font-body-md antialiased min-h-screen flex flex-col">
  <!-- 1. Top Nav -->
  <header class="fixed top-0 left-0 right-0 z-50 bg-transparent border-b border-transparent" class:scrolled={isScrolled} id="main-nav">
    <div class="max-w-[1280px] mx-auto px-margin-mobile md:px-margin-desktop flex justify-between items-center h-20">
      <a class="font-headline-sm text-headline-sm font-bold text-primary" href="/" onclick={(e) => { e.preventDefault(); navigate('/'); }}>ResumeElite</a>
      <nav class="hidden md:flex items-center space-x-gutter">
        <a class="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors" href="#features">Features</a>
        <a class="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors" href="#how-it-works">How it Works</a>
        <a class="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors" href="#pricing">Pricing</a>
      </nav>
      <div class="hidden md:flex items-center space-x-4">
        <a class="font-label-md text-label-md text-primary font-medium hover:opacity-80 transition-opacity" href="/dashboard" onclick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>Log in</a>
        <button onclick={() => navigate('/new')} class="bg-[#E64833] text-white font-label-md px-6 py-2.5 rounded hover:bg-[#c8321e] transition-colors ambient-lift">
          Start free
        </button>
      </div>
      <button class="md:hidden text-primary" onclick={() => mobileMenuOpen = !mobileMenuOpen} aria-label="Toggle navigation">
        <span class="material-symbols-outlined text-[24px]">{mobileMenuOpen ? 'close' : 'menu'}</span>
      </button>
    </div>
    {#if mobileMenuOpen}
      <nav class="md:hidden bg-surface border-t border-subtle px-margin-mobile py-4 space-y-3">
        <a class="block font-label-md text-on-surface-variant hover:text-primary transition-colors py-2" href="#features" onclick={() => mobileMenuOpen = false}>Features</a>
        <a class="block font-label-md text-on-surface-variant hover:text-primary transition-colors py-2" href="#how-it-works" onclick={() => mobileMenuOpen = false}>How it Works</a>
        <a class="block font-label-md text-on-surface-variant hover:text-primary transition-colors py-2" href="#pricing" onclick={() => mobileMenuOpen = false}>Pricing</a>
        <button onclick={() => { mobileMenuOpen = false; navigate('/new'); }} class="w-full mt-2 bg-[#E64833] text-white font-label-md px-6 py-2.5 rounded hover:bg-[#c8321e] transition-colors">
          Start free
        </button>
      </nav>
    {/if}
  </header>

  <main class="flex-grow pt-20">
    <!-- 2. Hero Section -->
    <section class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24 grid lg:grid-cols-2 gap-12 items-center relative">
      <div class="space-y-8 z-10">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-fixed/30 border border-primary-fixed-dim text-primary text-label-sm font-label-sm">
          <span class="material-symbols-outlined text-[16px]">auto_awesome</span>
          AI-Powered Tailoring
        </div>
        <h1 class="font-headline-xl-mobile md:font-headline-xl text-primary">
          Stop rewriting your resume <span class="text-[#E64833] italic">for every damn</span> job application.
        </h1>
        <p class="font-body-lg text-on-surface-variant max-w-lg">
          Create one master profile. Paste a job description. Get a perfectly tailored, ATS-beating resume in seconds. Because your time is better spent interviewing.
        </p>
        <div class="flex flex-col sm:flex-row gap-4">
          <button onclick={() => navigate('/new')} class="bg-[#E64833] text-white font-label-md px-8 py-4 rounded ambient-lift hover:bg-[#c8321e] transition-colors inline-flex justify-center items-center">
            Start for free
          </button>
          <button onclick={() => navigate('/new')} class="bg-surface text-primary-container font-label-md px-8 py-4 rounded border border-primary-container hover:bg-surface-2 transition-colors inline-flex justify-center items-center gap-2">
            <span class="material-symbols-outlined">play_circle</span>
            Try it now
          </button>
        </div>
      </div>
      <div class="relative lg:ml-auto w-full max-w-xl z-10">
        <div class="absolute inset-0 bg-secondary-fixed/20 rounded-xl -rotate-2 scale-105 transform origin-center"></div>
        <img alt="Live product shot mockup" class="relative rounded-xl shadow-xl w-full h-auto object-cover border border-subtle bg-white" src="/homepage-cv-image.png"/>
        <!-- Floating Badge -->
        <div class="absolute -bottom-6 -left-6 bg-white rounded-lg shadow-lg border border-subtle p-4 flex items-center gap-3 animate-bounce" style="animation-duration: 3s;">
          <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
            <span class="material-symbols-outlined text-[18px]">check</span>
          </div>
          <div>
            <p class="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px]">Match Score</p>
            <p class="font-headline-sm text-primary text-sm">Tailored to this JD ✓</p>
          </div>
        </div>
      </div>
      <!-- Decorative background blob -->
      <div class="absolute top-0 right-0 w-[800px] h-[800px] bg-primary-fixed/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 -z-10 pointer-events-none"></div>
    </section>

    <!-- 3. Social Proof -->
    <section class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 border-y border-subtle bg-surface-2 text-center">
      <p class="font-headline-sm text-primary mb-8">Join professionals getting <span class="text-[#E64833] font-bold">3.4x more interview callbacks</span> at top companies</p>
      <div class="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-60 grayscale">
        <!-- Placeholder SVG logos -->
        <svg class="h-8" fill="currentColor" viewbox="0 0 100 30"><path d="M10,15 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0 M30,5 h10 v20 h-10 z M50,15 l10,-10 v20 z M75,5 h20 v5 h-15 v2 h10 v5 h-10 v3 h15 v5 h-20 z"></path></svg>
        <svg class="h-8" fill="currentColor" viewbox="0 0 100 30"><circle cx="15" cy="15" r="10"></circle><rect height="20" width="20" x="35" y="5"></rect><polygon points="70,25 80,5 90,25"></polygon></svg>
        <svg class="h-8" fill="currentColor" viewbox="0 0 100 30"><path d="M5,25 L15,5 L25,25 M35,5 H55 M45,5 V25 M65,5 Q85,5 85,15 Q85,25 65,25 H65 Z"></path></svg>
        <svg class="h-8" fill="currentColor" viewbox="0 0 100 30"><rect height="10" transform="rotate(45 15 15)" width="10" x="10" y="10"></rect><circle cx="45" cy="15" r="8"></circle><path d="M70,25 Q80,5 90,25"></path></svg>
        <svg class="h-8 hidden sm:block" fill="currentColor" viewbox="0 0 100 30"><path d="M10,25 V5 L25,15 L40,5 V25 M55,5 h20 M65,5 v20 M85,15 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0"></path></svg>
      </div>
    </section>

    <!-- 4. Tailor to JD Section -->
    <section class="bg-primary-container text-white py-24 w-full">
      <div class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid md:grid-cols-2 gap-16 items-center">
        <!-- Left: Animated Before/After -->
        <div class="bg-surface/10 rounded-xl p-6 md:p-8 border border-white/10 relative overflow-hidden backdrop-blur-sm">
          <div class="space-y-6">
            <div class="opacity-50">
              <p class="font-label-sm text-secondary-fixed mb-2 uppercase tracking-wide">Generic Bullet</p>
              <p class="font-body-md line-through decoration-red-400/50">Managed team of 5 software engineers to build new features.</p>
            </div>
            <div class="relative pl-6 border-l-2 border-[#E64833]">
              <span class="absolute -left-[13px] top-1/2 -translate-y-1/2 bg-[#E64833] rounded-full p-1">
                <span class="material-symbols-outlined text-[16px] text-white">auto_fix_high</span>
              </span>
              <p class="font-label-sm text-[#E64833] mb-2 uppercase tracking-wide">Tailored to "Senior Lead Engineer"</p>
              <p class="font-body-md text-white">Spearheaded agile development lifecycle with a 5-person cross-functional engineering squad, accelerating feature deployment by 35% and directly supporting Q3 revenue goals.</p>
            </div>
          </div>
        </div>
        <!-- Right: Copy + Bullets -->
        <div class="space-y-8">
          <h2 class="font-headline-lg">Speak their exact language.</h2>
          <p class="font-body-lg text-primary-fixed-dim">
            Applicant Tracking Systems don't read between the lines. Our AI rewrites your achievements to match the exact keywords and tone of the job description, without lying or losing your unique voice.
          </p>
          <ul class="space-y-6">
            <li class="flex items-start gap-4">
              <div class="mt-1 bg-secondary/30 p-2 rounded text-secondary-fixed">
                <span class="material-symbols-outlined text-[20px]">radar</span>
              </div>
              <div>
                <h4 class="font-headline-sm mb-1">Keyword Optimization</h4>
                <p class="font-body-md text-primary-fixed-dim">Automatically detects and weaves in crucial skills required by the JD.</p>
              </div>
            </li>
            <li class="flex items-start gap-4">
              <div class="mt-1 bg-secondary/30 p-2 rounded text-secondary-fixed">
                <span class="material-symbols-outlined text-[20px]">tune</span>
              </div>
              <div>
                <h4 class="font-headline-sm mb-1">Tone Matching</h4>
                <p class="font-body-md text-primary-fixed-dim">Adjusts phrasing—corporate, startup-casual, or academic—to fit company culture.</p>
              </div>
            </li>
            <li class="flex items-start gap-4">
              <div class="mt-1 bg-secondary/30 p-2 rounded text-secondary-fixed">
                <span class="material-symbols-outlined text-[20px]">format_list_numbered</span>
              </div>
              <div>
                <h4 class="font-headline-sm mb-1">Impact Framing</h4>
                <p class="font-body-md text-primary-fixed-dim">Restructures sentences to lead with metrics and business impact.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 5. Chat Section -->
    <section class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-24 text-center">
      <div class="max-w-3xl mx-auto space-y-6 mb-12">
        <h2 class="font-headline-lg text-primary">Your personal career strategist.</h2>
        <p class="font-body-lg text-on-surface-variant">
          Not sure how to explain that 6-month employment gap? Want to pivot from Sales to Product? Just ask.
        </p>
      </div>
      <!-- Faux Chat UI -->
      <div class="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl border border-subtle overflow-hidden text-left">
        <div class="bg-surface-2 border-b border-subtle p-4 flex items-center gap-3">
          <div class="w-3 h-3 rounded-full bg-red-400"></div>
          <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
          <div class="w-3 h-3 rounded-full bg-green-400"></div>
          <span class="font-label-sm text-on-surface-variant ml-2">ResumeElite AI</span>
        </div>
        <div class="p-6 space-y-6 h-[400px] overflow-y-auto bg-surface/50">
          <!-- User Message -->
          <div class="flex justify-end">
            <div class="bg-primary text-white rounded-2xl rounded-tr-sm px-5 py-3 max-w-[80%]">
              <p class="font-body-md">I'm applying for a Product Manager role, but my background is in B2B Sales. How do I make my quota achievements sound relevant?</p>
            </div>
          </div>
          <!-- AI Message -->
          <div class="flex justify-start">
            <div class="bg-white border border-subtle text-primary rounded-2xl rounded-tl-sm px-5 py-4 max-w-[85%] shadow-sm">
              <p class="font-body-md mb-3">Great pivot! We need to translate "sales" into "customer empathy" and "market research." Let's reframe your achievements.</p>
              <div class="bg-surface-2 p-3 rounded border border-subtle mb-3">
                <p class="font-label-sm text-on-surface-variant mb-1">Instead of:</p>
                <p class="font-body-md text-sm text-red-700/80 line-through">Exceeded Q3 sales quota by 120% through aggressive cold calling.</p>
              </div>
              <div class="bg-green-50 p-3 rounded border border-green-200">
                <p class="font-label-sm text-green-700 mb-1">Try this:</p>
                <p class="font-body-md text-sm text-green-900">Conducted 50+ weekly user discovery calls, identifying key market pain points that drove 120% growth in territory adoption.</p>
              </div>
              <button onclick={() => navigate('/new')} class="mt-3 text-[#E64833] font-label-sm flex items-center gap-1 hover:underline">
                <span class="material-symbols-outlined text-[16px]">add_circle</span> Apply to resume
              </button>
            </div>
          </div>
        </div>
        <div class="p-4 bg-white border-t border-subtle">
          <div class="relative">
            <input onkeydown={(e) => { if (e.key === 'Enter') navigate('/new'); }} class="w-full bg-surface-2 border border-subtle rounded-full py-3 pl-4 pr-12 focus:ring-2 focus:ring-[#E64833]/50 focus:border-[#E64833] outline-none transition-all" placeholder="Ask how to frame your experience..." type="text"/>
            <button onclick={() => navigate('/new')} class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center hover:bg-[#E64833] transition-colors">
              <span class="material-symbols-outlined text-[18px]">arrow_upward</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 7. Features Grid -->
    <section class="bg-surface-2 border-y border-subtle py-24" id="features">
      <div class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
        <div class="text-center max-w-2xl mx-auto mb-16">
          <h2 class="font-headline-lg text-primary mb-4">Everything you need to stand out.</h2>
          <p class="font-body-lg text-on-surface-variant">Built for speed, designed for impact.</p>
        </div>
        <div class="grid md:grid-cols-3 gap-8">
          <!-- Feature 1 -->
          <div class="bg-white p-8 rounded-xl border border-subtle shadow-sm hover:shadow-md transition-shadow">
            <div class="w-12 h-12 bg-primary-container text-white rounded-lg flex items-center justify-center mb-6">
              <span class="material-symbols-outlined text-[24px]">edit_document</span>
            </div>
            <h3 class="font-headline-md text-primary mb-3">Notion-style Editor</h3>
            <p class="font-body-md text-on-surface-variant">
              Write seamlessly with a distraction-free, block-based editor. Rearrange sections with drag-and-drop ease.
            </p>
          </div>
          <!-- Feature 2 -->
          <div class="bg-white p-8 rounded-xl border border-subtle shadow-sm hover:shadow-md transition-shadow">
            <div class="w-12 h-12 bg-primary-container text-white rounded-lg flex items-center justify-center mb-6">
              <span class="material-symbols-outlined text-[24px]">design_services</span>
            </div>
            <h3 class="font-headline-md text-primary mb-3">ATS-Proven Templates</h3>
            <p class="font-body-md text-on-surface-variant">
              Clean, modern, and rigorously tested against popular Applicant Tracking Systems to ensure perfect parsing.
            </p>
          </div>
          <!-- Feature 3 -->
          <div class="bg-white p-8 rounded-xl border border-subtle shadow-sm hover:shadow-md transition-shadow">
            <div class="w-12 h-12 bg-primary-container text-white rounded-lg flex items-center justify-center mb-6">
              <span class="material-symbols-outlined text-[24px]">cloud_upload</span>
            </div>
            <h3 class="font-headline-md text-primary mb-3">One-Click Import</h3>
            <p class="font-body-md text-on-surface-variant">
              Don't start from scratch. Instantly import your LinkedIn profile or existing PDF resume to populate your master file.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 8. How it Works -->
    <section class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-24 overflow-hidden" id="how-it-works">
      <h2 class="font-headline-lg text-primary text-center mb-16">How it works</h2>
      <div class="relative">
        <!-- Connecting Line (Desktop only) -->
        <div class="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-subtle -translate-y-1/2 -z-10"></div>
        <div class="grid md:grid-cols-4 gap-8">
          <!-- Step 1 -->
          <div class="relative flex flex-col items-center text-center group">
            <div class="w-16 h-16 bg-white border-2 border-primary rounded-full flex items-center justify-center font-headline-sm text-primary mb-6 group-hover:bg-primary group-hover:text-white transition-colors">1</div>
            <h4 class="font-headline-sm text-primary mb-2">Build Master</h4>
            <p class="font-body-md text-on-surface-variant">Input your complete career history.</p>
          </div>
          <!-- Step 2 -->
          <div class="relative flex flex-col items-center text-center group">
            <div class="w-16 h-16 bg-white border-2 border-primary rounded-full flex items-center justify-center font-headline-sm text-primary mb-6 group-hover:bg-primary group-hover:text-white transition-colors">2</div>
            <h4 class="font-headline-sm text-primary mb-2">Paste JD</h4>
            <p class="font-body-md text-on-surface-variant">Drop in the specific job you want.</p>
          </div>
          <!-- Step 3 -->
          <div class="relative flex flex-col items-center text-center group font-headline-sm">
            <div class="w-16 h-16 bg-white border-2 border-[#E64833] rounded-full flex items-center justify-center font-headline-sm text-[#E64833] mb-6 group-hover:bg-[#E64833] group-hover:text-white transition-colors shadow-lg shadow-[#E64833]/20">3</div>
            <h4 class="font-headline-sm text-primary mb-2">AI Tailor</h4>
            <p class="font-body-md text-on-surface-variant">Watch it adapt keywords & tone instantly.</p>
          </div>
          <!-- Step 4 -->
          <div class="relative flex flex-col items-center text-center group">
            <div class="w-16 h-16 bg-white border-2 border-primary rounded-full flex items-center justify-center font-headline-sm text-primary mb-6 group-hover:bg-primary group-hover:text-white transition-colors">4</div>
            <h4 class="font-headline-sm text-primary mb-2">Export & Apply</h4>
            <p class="font-body-md text-on-surface-variant">Download PDF and hit submit confidently.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Success Stories -->
    <section class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pb-24">
      <h2 class="font-headline-lg text-primary text-center mb-16">Success Stories</h2>
      <div class="grid md:grid-cols-3 gap-8">
        <!-- Story 1 — placeholder testimonial, replace with real user quote + photo before launch -->
        <div class="flex flex-col items-center text-center bg-white p-8 rounded-xl border border-subtle shadow-sm">
          <div class="w-24 h-24 rounded-full mb-4 border-2 border-subtle flex items-center justify-center bg-primary-fixed/30">
            <span class="font-headline-lg text-primary">PM</span>
          </div>
          <h4 class="font-headline-sm text-primary mb-1">Priya M.</h4>
          <span class="font-label-sm text-[#006496] bg-[#3E92CC]/10 px-3 py-1 rounded-full mb-4">Product Designer</span>
          <p class="font-body-md text-on-surface-variant italic font-serif">
            "Imported my old PDF, tailored it to a JD, and had a recruiter-ready résumé in under five minutes. Two interviews that week."
          </p>
        </div>
        <!-- Story 2 — placeholder testimonial -->
        <div class="flex flex-col items-center text-center bg-white p-8 rounded-xl border border-subtle shadow-sm">
          <div class="w-24 h-24 rounded-full mb-4 border-2 border-subtle flex items-center justify-center bg-primary-fixed/30">
            <span class="font-headline-lg text-primary">DK</span>
          </div>
          <h4 class="font-headline-sm text-primary mb-1">Daniel K.</h4>
          <span class="font-label-sm text-[#006496] bg-[#3E92CC]/10 px-3 py-1 rounded-full mb-4">Backend Engineer</span>
          <p class="font-body-md text-on-surface-variant italic font-serif">
            "The chat caught a gap I would've fumbled in the interview. Genuinely changed how I prep."
          </p>
        </div>
        <!-- Story 3 — placeholder testimonial -->
        <div class="flex flex-col items-center text-center bg-white p-8 rounded-xl border border-subtle shadow-sm">
          <div class="w-24 h-24 rounded-full mb-4 border-2 border-subtle flex items-center justify-center bg-primary-fixed/30">
            <span class="font-headline-lg text-primary">SR</span>
          </div>
          <h4 class="font-headline-sm text-primary mb-1">Sam R.</h4>
          <span class="font-label-sm text-[#006496] bg-[#3E92CC]/10 px-3 py-1 rounded-full mb-4">Marketing Lead</span>
          <p class="font-body-md text-on-surface-variant italic font-serif">
            "I've already told it what I'm looking for. The second the auto-apply agent launches, I'm gone."
          </p>
        </div>
      </div>
    </section>

    <!-- 9. Pricing Teaser -->
    <section class="bg-surface-2 py-24 border-t border-subtle" id="pricing">
      <div class="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop text-center space-y-8">
        <h2 class="font-headline-lg text-primary">Simple, transparent pricing.</h2>
        <p class="font-body-lg text-on-surface-variant max-w-2xl mx-auto">Start for free. Upgrade when you're ready to supercharge your job hunt.</p>
        <div class="grid md:grid-cols-2 gap-8 mt-12 text-left">
          <div class="bg-white p-8 rounded-xl border border-subtle shadow-sm">
            <h3 class="font-headline-md text-primary mb-2">Free Starter</h3>
            <p class="font-headline-xl text-primary mb-4">$0<span class="text-lg text-on-surface-variant font-normal">/mo</span></p>
            <ul class="space-y-3 mb-8 font-body-md text-on-surface-variant">
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-green-500 text-[20px]">check</span> 1 Master Profile</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-green-500 text-[20px]">check</span> 3 AI Tailored Resumes/mo</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-green-500 text-[20px]">check</span> PDF Export</li>
            </ul>
            <button onclick={() => navigate('/new')} class="w-full bg-surface text-primary border border-primary font-label-md py-3 rounded hover:bg-surface-2 transition-colors">Start for free</button>
          </div>
          <div class="bg-primary-container p-8 rounded-xl border border-primary-container shadow-xl relative overflow-hidden">
            <div class="absolute top-4 right-4 bg-[#E64833] text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Most Popular</div>
            <h3 class="font-headline-md text-white mb-2">Elite Professional</h3>
            <p class="font-headline-xl text-white mb-4">$19<span class="text-lg text-primary-fixed-dim font-normal">/mo</span></p>
            <ul class="space-y-3 mb-8 font-body-md text-primary-fixed-dim">
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[#E64833] text-[20px]">check</span> Unlimited Master Profiles</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[#E64833] text-[20px]">check</span> Unlimited AI Tailoring</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[#E64833] text-[20px]">check</span> Cover Letter Generator</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[#E64833] text-[20px]">check</span> Priority Support</li>
            </ul>
            <button onclick={() => navigate('/new')} class="w-full bg-[#E64833] text-white font-label-md py-3 rounded hover:bg-[#c8321e] transition-colors ambient-lift">Upgrade Now</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 6. Coming Soon Section -->
    <section class="relative bg-gradient-to-br from-[#1c3b46] to-[#244855] py-32 overflow-hidden text-center text-white">
      <!-- Dramatic gradient overlay -->
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50"></div>
      <div class="relative z-10 max-w-2xl mx-auto px-margin-mobile space-y-8">
        <div class="inline-flex items-center justify-center bg-white/10 border border-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 font-label-sm tracking-widest text-primary-fixed uppercase">
          Coming Soon
        </div>
        <h2 class="font-headline-lg">Automated Job Application Engine</h2>
        <p class="font-body-lg text-primary-fixed-dim">
          Soon, ResumeElite won't just tailor your resume—it will find jobs and apply for you while you sleep. Join the waitlist for early access.
        </p>
        
        {#if submitted}
          <div class="inline-flex items-center justify-center bg-green-500/20 border border-green-500/30 text-green-200 px-6 py-4 rounded-lg font-body-md max-w-md mx-auto mt-8">
            ✓ Added to waitlist! We'll email you at <span class="underline ml-1 font-mono">{email}</span> as soon as we launch.
          </div>
        {:else}
          <form onsubmit={handleWaitlistSubmit} class="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mt-8">
            <input bind:value={email} class="flex-grow bg-white/5 border border-white/20 rounded px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all backdrop-blur-sm" placeholder="Enter your email" required type="email"/>
            <button class="bg-white text-primary font-label-md px-6 py-3 rounded hover:bg-surface-2 transition-colors whitespace-nowrap" type="submit">
              Join Waitlist
            </button>
          </form>
        {/if}
      </div>
    </section>
  </main>

  <!-- 10. Footer -->
  <footer class="bg-surface-container-highest border-t border-outline-variant/20">
    <div class="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16">
      <!-- 4 Columns -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
        <div class="col-span-2 md:col-span-1">
          <a class="font-headline-sm font-bold text-primary block mb-4" href="/" onclick={(e) => { e.preventDefault(); navigate('/'); }}>ResumeElite</a>
          <p class="font-body-md text-on-surface-variant mb-6 pr-4">
            Precision engineering for your professional future. Stop rewriting, start interviewing.
          </p>
        </div>
        <div>
          <h4 class="font-label-md font-bold text-primary mb-4">Product</h4>
          <ul class="space-y-3">
            <li><a class="font-label-sm text-on-surface-variant hover:text-primary transition-colors" href="#features">Features</a></li>
            <li><a class="font-label-sm text-on-surface-variant hover:text-primary transition-colors" href="#features">Templates</a></li>
            <li><a class="font-label-sm text-on-surface-variant hover:text-primary transition-colors" href="#pricing">Pricing</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-label-md font-bold text-primary mb-4">Resources</h4>
          <ul class="space-y-3">
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">Career Blog (coming soon)</span></li>
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">Resume Examples (coming soon)</span></li>
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">Help Center (coming soon)</span></li>
          </ul>
        </div>
        <div>
          <h4 class="font-label-md font-bold text-primary mb-4">Company</h4>
          <ul class="space-y-3">
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">About Us (coming soon)</span></li>
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">Contact (coming soon)</span></li>
            <li><span class="font-label-sm text-on-surface-variant/50 cursor-default">Privacy Policy (coming soon)</span></li>
          </ul>
        </div>
      </div>
      <!-- Bottom Row with Socials -->
      <div class="pt-8 border-t border-outline-variant/20 flex flex-col md:flex-row justify-between items-center gap-4">
        <div class="font-body-md text-label-sm text-on-surface-variant">
          © 2024 ResumeElite. All rights reserved.
        </div>
        <div class="flex items-center space-x-4 text-on-surface-variant">
          <a class="hover:text-primary transition-colors" href="/dashboard" onclick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
            <span class="sr-only">Twitter</span>
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewbox="0 0 24 24">
              <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84"></path>
            </svg>
          </a>
          <a class="hover:text-primary transition-colors" href="/dashboard" onclick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
            <span class="sr-only">LinkedIn</span>
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewbox="0 0 24 24">
              <path clip-rule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" fill-rule="evenodd"></path>
            </svg>
          </a>
        </div>
      </div>
    </div>
  </footer>
</div>

<style>
  .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  }
  .bg-surface-2 { background-color: #f2dec2; }
  .border-subtle { border-color: rgba(144, 174, 173, 0.2); }
  .ambient-lift { box-shadow: 0 8px 24px -4px rgba(36, 72, 85, 0.15); }
  
  /* Sticky Nav Transition */
  #main-nav { transition: background-color 0.3s, box-shadow 0.3s; }
  #main-nav.scrolled {
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  }
</style>
