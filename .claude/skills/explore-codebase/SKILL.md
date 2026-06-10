---
name: explore-codebase
description: Use when you need to understand unfamiliar code in this repo, locate a function or feature, trace relationships between modules, or answer "where is X / how does X work" questions
---

# Explore Codebase

Use the code-review-graph MCP tools instead of Grep/Glob/Read — they return structural context (callers, dependents, test coverage) at a fraction of the tokens. Exact tool names carry a `_tool` suffix.

## Workflow

1. `get_minimal_context_tool(task="<your task>")` first — ~100 tokens of stats, risk, top communities/flows, and suggested next tools.
2. Pick the tool that matches the question:
   - Find a symbol by name/keyword → `semantic_search_nodes_tool`
   - Trace relationships → `query_graph_tool` with pattern `callers_of` / `callees_of` / `imports_of` / `children_of` / `tests_for`
   - High-level structure → `get_architecture_overview_tool`, then `list_communities_tool` / `get_community_tool`
   - Execution paths → `list_flows_tool`, `get_flow_tool`
   - Complexity hotspots → `find_large_functions_tool`
3. Read source only for the handful of nodes that matter (`get_review_context_tool`, or Read with line ranges).

## Efficiency

- Pass `detail_level="minimal"`; escalate to `"standard"` only when minimal output is insufficient to proceed.
- Most exploration resolves in about 5 graph calls. If you're past that, restate the question instead of fanning out.
- Fall back to Grep/Read when the graph lacks coverage: config files, SQL migrations, docs, brand-new untracked files.
