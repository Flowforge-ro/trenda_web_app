---
name: refactor-safely
description: Use when renaming symbols, moving or deleting code, extracting modules, or any restructuring where silently breaking callers or flows is a risk
---

# Refactor Safely

Use the code-review-graph MCP tools to see the blast radius before touching code. Exact tool names carry a `_tool` suffix.

## Workflow

1. `get_minimal_context_tool(task="<refactor goal>")` first.
2. Scope the risk before editing:
   - `get_impact_radius_tool` on files you plan to change
   - `get_affected_flows_tool` to check no critical execution path breaks
3. Pick the mode:
   - Rename → `refactor_tool(mode="rename")` to preview every affected location, then `apply_refactor_tool` with the returned refactor_id
   - Delete code → `refactor_tool(mode="dead_code")` to confirm it's actually unreferenced
   - Decompose → `find_large_functions_tool` and `refactor_tool(mode="suggest")` for targets
4. After changes, `detect_changes_tool` to verify the impact matches what you intended.

## Rules

- Never apply a rename without previewing the edit list first.
- Dead-code results miss dynamic references (string-based imports, reflection, route tables) — grep for the symbol name before deleting.
- Pass `detail_level="minimal"`; escalate to `"standard"` only when needed.
- Run the test suite after applying; graph verification doesn't replace tests.
