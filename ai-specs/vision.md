# Product Vision: The Environment-Agnostic Resume Agent & Pipeline

## 1. The Core Philosophy: The Agentic SDK
The fundamental shift in this architecture is moving away from a tightly coupled "UI Chat" feature toward an **Agentic SDK for Resumes**. The AI optimization loop is being elevated into a first-class, standalone primitive. 

The primary mandate is the **Agnostic Loop**: The core AI agent orchestrating the resume refinement must be entirely decoupled from its execution environment. Whether it is calculating line budgets, staging structural revisions, or contextually rewriting work experience, the agent does not know—and does not care—where it is running. It simply receives a state, processes layout and content constraints, and returns optimizations.

## 2. Development Workflow & The CLI First Approach
Before the agent touches a graphical interface, it must be bulletproof in isolation.
* **The Headless Environment:** The core layout math and LLM orchestration are packaged into a headless SDK.
* **CLI Testing:** Development begins with a Command Line Interface. This allows for rapid iteration, deterministic testing, and deep debugging without the overhead of UI state or browser hot-reloading. Developers can pipe a JSON resume state and a prompt into the terminal and watch the agentic loop process block-by-block optimizations.
* **Frictionless Integration:** Because the SDK is perfectly isolated, integrating it into the production environment is seamless. The exact same core logic used in the CLI is simply imported and wrapped by the web application or backend services.

## 3. Dynamic Execution & User Experience Tiers
By making the SDK environment-agnostic, the product unlocks flexible execution models that optimize both user experience and infrastructure costs.

### A. The Active User (Client-Side Execution)
When the user is actively working inside the standard web application, the agentic loop runs **directly on the user's computer** (within the browser).
* **UX Impact:** Interactions are instantaneous. The user sees micro-adjustments and block rewrites happen in real-time on their visual canvas, with zero server latency.
* **Business Impact:** By utilizing the user's local compute power for live sessions, the platform completely eliminates server overhead and concurrent connection costs during active design phases.

### B. The Passive User (Server-Side Background Agents)
If the user requests a massive, document-wide overhaul or a deep-optimization task, they shouldn't have to keep their browser tab open.
* **The Handoff:** The webapp seamlessly serializes the current canvas state and passes it to the backend infrastructure.
* **UX Impact:** The user can close their laptop or navigate away. The exact same Agentic SDK spins up as a background worker on the server. Once the intensive loop is complete, the user receives a notification that their newly optimized CV is ready for review.

## 4. The Grand Vision: The Automated JD-Matching Pipeline
The ultimate endpoint of this architecture is an automated, high-throughput career-operations engine. The Agentic SDK serves as the engine for programmatic, scale-driven job applications.

### The Mechanism
1.  **Ingestion:** The pipeline ingests the user's master CV database (their comprehensive career history) and a specific target Job Description (JD).
2.  **Block-by-Block Micro-Optimization:** The background agent runs a targeted loop across the document. It maps the JD requirements directly to specific resume blocks.
3.  **Spatial Context:** The agent rewrites the content of each block to perfectly align with the JD, while strictly adhering to the spatial and physical limits (line constraints, page breaks) dictated by the layout engine.
4.  **Auto-Apply at Scale:** The pipeline outputs a mathematically perfect, structurally sound, and highly tailored PDF designed specifically for that single application. 

### The Result
Users are empowered to execute programmatic auto-applications at scale. Instead of sending one generic resume to fifty companies, the background agent autonomously tailors fifty distinct, perfectly formatted resumes, giving the user a massive, automated advantage in the job market.

