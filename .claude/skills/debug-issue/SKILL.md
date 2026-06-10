---
name: debug-issue
description: Use when investigating a bug, failing test, error message, or unexpected behavior in this repo and you need to locate the responsible code path
---

# Debug Issue

Use the code-review-graph MCP tools to locate the faulty code path before proposing any fix. Exact tool names carry a `_tool` suffix.

## Workflow

1. `get_minimal_context_tool(task="<bug description>")` — includes risk score and recent-change signal.
2. `detect_changes_tool` — recent changes are the most common source of new bugs; check them before going wide.
3. `semantic_search_nodes_tool` with terms from the error/symptom to find candidate code.
4. `query_graph_tool` with `callers_of` / `callees_of` on candidates to trace the call chain in both directions.
5. `get_flow_tool` to see the full execution path and find the entry point that triggers the bug.
6. `get_impact_radius_tool` on the suspect file to know what else your fix may affect.

## Rules

- The graph locates code; it does not prove root cause. Confirm by reading the actual source and reproducing before fixing.
- Pass `detail_level="minimal"`; escalate to `"standard"` only when minimal output blocks progress.
- If the trail leads outside graph coverage (config, env, SQL, third-party deps), switch to Grep/Read — don't force graph tools.
