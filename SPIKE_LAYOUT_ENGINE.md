# SUPERSEDED — see `specs/layout-engine/`

This one-page spike has been replaced by the full PRD set in **`specs/layout-engine/`** (README + `PHASE_0`–`PHASE_4`). Use those, not this file.

In particular, this file's earlier Phase 3 description mentioned **bullet/ordered lists and indents** — that was wrong. The codebase has **no list block types** (StarterKit disables `bulletList`/`orderedList`/`listItem`); multi-line content comes only from `hardBreak` + wrapping. The PRDs reflect the correct model.

→ Start at `specs/layout-engine/README.md`.
