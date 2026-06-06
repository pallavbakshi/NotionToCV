# Product Requirements Document (PRD)
## Ephemeral Draft: Transitioning NotionToCV AI Subsystem to a Headless Agentic SDK

This document specifies the engineering blueprint to decouple the existing AI system of **NotionToCV** from the Svelte UI, creating an environment-agnostic **Agentic Resume SDK**. This SDK will run seamlessly in three target environments:
1. **The Web Client** (using browser compute for active users).
2. **The CLI Tool** (for localized offline optimization, automated pipelines, testing).
3. **Background Agents** (server-side background queues for passive, scale operation).

---

## 1. System Context & Architecture

The current AI capability is nested within Svelte UI targets (`ChatDrawer.svelte`, Svelte-staged stores, browser-centric parses). To transform this into an environment-agnostic loop, we separate UI bindings, business domain workflows, and engine-resolved layout constraints.

```
       ┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
       │     A: Web App UI      │      │     B: CLI Tool        │      │  C: Background Worker  │
       │    (Svelte/Browser)    │      │     (Node CLI)         │      │      (Bull/Node/Server)│
       └───────────┬────────────┘      └───────────┬────────────┘      └───────────┬────────────┘
                   │                               │                               │
                   │ (State + Event Handlers)      │ (File Stream / JSON State)    │ (Redis Queue State)
                   ▼                               ▼                               ▼
     =============================================================================================
     ==================================   AGENTIC RESUME SDK   ===================================
     
       ┌────────────────────────────────────────────────────────────────────────────────────────┐
       │ 1. Core Agent Engine (agentTools.js / Prompts & LLM Gateway)                           │
       │    - State & History Tracker                                                           │
       │    - Agnostic Execution Engine                                                         │
       └───────────────────────────────────────────┬────────────────────────────────────────────┘
                                                   │
                                                   ▼
       ┌────────────────────────────────────────────────────────────────────────────────────────┐
       │ 2. Tool Integrations (Agnostic implementations)                                        │
       │    - read_block / update_block_content / screenshot                                    │
       └───────────────────────────────────────────┬────────────────────────────────────────────┘
                                                   │ 
                                                   ▼
       ┌────────────────────────────────────────────────────────────────────────────────────────┐
       │ 3. Layout Engine Validation (computeLayout / metrics boundaries)                       │
       │    - Budget Checks (Is overflowing? Remaining line allocations?)                       │
       └────────────────────────────────────────────────────────────────────────────────────────┘
     =============================================================================================
```

---

## 2. Headless SDK Modularization

The AI code currently located in `src/lib/ai-chat/` must be moved to an isolated package/directory (e.g., `src/sdk/` or a standalone workspaces module) with zero dependencies on browser window objects or Svelte reactivity.

### 2.1 Environmental Boundary Resolutions

| Current Dependency | Found In | SDK Boundary Solution |
| :--- | :--- | :--- |
| **Svelte Stores (`stagedChanges`, etc.)** | `agentTools.js`, `ChatDrawer.svelte` | **Decoupled:** SDK outputs state mutations or transaction objects. Host environments (Svelte, CLI harness) dispatch these mutations into their respective state managers. |
| **`DOMParser` (Browser Utility)** | `messageParser.js` | **Isomorphic parsing:** Introduce a lightweight non-UI DOM parser polyfill (e.g., `linkedom` or `jsdom`) inside Node execution entry points, or refactor HTML parsing to use node-safe isomorphic libraries. |
| **Client-side `fetch('/api/screenshot')`** | `agentTools.js` | **Injected Host API:** The screenshot engine interface is passed to the SDK instantiation payload. Browser injects standard HTTP requests; Server agents inject direct Puppeteer rendering loops. |
| **Layout Engine (`/src/lib/layout`)** | `agentTools.js` | **Preserved Integration:** Maintain direct dependency on the headless layout engine. Node entry-points must import layout algorithms natively for inline margin/overflow validations. |

---

## 3. Core SDK Interfaces & API Design

The SDK exposes instantiable Engines that handle targeted tasks (Job matching, coaching, block-level modifications) or host-run chats.

```javascript
// src/sdk/index.js (Exposed SDK Entry Point)

export class ResumeAgentEngine {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - LlM API Token
   * @param {string} [config.model] - Target model override
   * @param {Function} [config.screenshotProvider] - External system capability to retrieve base64 view
   */
  constructor({ apiKey, model, screenshotProvider }) {
    this.apiKey = apiKey;
    this.model = model || 'anthropic/claude-sonnet-4-5';
    this.screenshotProvider = screenshotProvider;
  }

  /**
   * Run optimization loop over target resume state using guidelines (Optionally JD-driven)
   * @param {Object} state - The full current resume state JSON (title, blocks, padding, template, etc.)
   * @param {string} instruction - Prompt parameters (e.g., User's prompt, targeted Job Description)
   * @returns {Promise<Object>} Updated resume state containing proposed/accepted blocks
   */
  async optimizeResume(state, instruction) {
    // 1. Establish Layout context
    // 2. Initialize prompt configuration with system parameters
    // 3. Coordinate LLM loops and perform block-by-block structural tests
    // 4. Return serialized staged operations map
  }

  /**
   * Low-level method to evaluate updates against the layout budget constraints directly
   */
  validateBlockLayout(block, rect, layoutCtx) {
     // Runs computeLayout dynamically inside the Node process
  }
}
```

---

## 4. CLI Execution Harness Requirements

To support the "CLI First" approach, a node execution harness will be established.

### 4.1 Interface Specification
```bash
./scripts/resume-agent.cjs \
  --input ~/path/to/resume.json \
  --output ~/path/to/optimized-resume.json \
  --jd ~/path/to/job-description.txt \
  --prompt "Emphasize cloud architecture scale metrics" \
  --verbose
```

### 4.2 CLI Core Features
1. **Headless Execution:** Read resume json formats directly. Ensure local filesystem parses operate safely.
2. **Deterministic Run Capability:** Return inline structural differentials (Unified Diff syntax console logs) showing changes to text alongside simulated Layout engine capacity outputs before writing updates.
3. **Execution Safety Limits:** Allow setting execution flags to reject LLM alterations that trigger a layout budget overflow (`--strict-capacity`).

---

## 5. Web App & Server Handoff Workflow Integration

With the SDK extracted, `ChatDrawer.svelte` and server engines become consumers:

### 5.1 Client (Active Session) Execution
```javascript
import { ResumeAgentEngine } from '../sdk/index.js';

const agent = new ResumeAgentEngine({
  apiKey: import.meta.env.VITE_AI_API_KEY,
  screenshotProvider: async (blockId) => {
    // Local web runtime fires browser endpoint screenshots
    const res = await fetch('/api/screenshot', { ... });
    return res.json();
  }
});

// Reacting to UI interactions...
```

### 5.2 Decoupled Staged Flow Execution (Background Workers)
1. Active client serializes workspace state JSON and targeting instructions.
2. Client transmits bundle to background queues via HTTP POST (`/api/agent/queue`).
3. Passive worker node pulls jobs, loads CLI-optimized execution paths utilizing the identical SDK, and processes heavy multiloop computations off the browser main-thread.
4. Finished payload is flagged ready for active review upon UI reload.

---

## 6. Implementation Checklist & Phase Plan

- [ ] **Phase 1: Isolate Parsers & Domain Helpers**
  - Extract browser `DOMParser` wrappers within `messageParser.js` into standard environmental abstractions. Ensure compatibility with `linkedom` inside Node runtimes.
- [ ] **Phase 2: Assemble `/src/sdk` Directory Tree**
  - Migrate system prompt configurations, tool registrations (`AGENT_TOOLS`), and spatial helper formulas (`spatialUtils.js`) into `/src/sdk`.
- [ ] **Phase 3: Code Node CLI Command Harness Container**
  - Create `./scripts/resume-agent.cjs` targeting file system paths to verify integration boundaries function completely without browser contexts.
- [ ] **Phase 4: Wire Web Client Back to Isolated SDK Core**
  - Bind `ChatDrawer.svelte` and existing workflows to the updated SDK imports. Ensure no visual or functionality degradation occurs in active Svelte instances.

<chatName="resume_agentic_sdk_prd"/>
