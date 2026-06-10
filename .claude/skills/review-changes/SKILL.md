---
name: review-changes
description: Use when reviewing a diff, branch, commit, or PR in this repo before merge, or when asked whether changes are safe to ship
---

# Review Changes

Use the code-review-graph MCP tools for a risk-aware review instead of reading whole files. Exact tool names carry a `_tool` suffix.

## Workflow

1. `detect_changes_tool` — risk-scored analysis of what changed.
2. `get_affected_flows_tool` — which execution paths the changes touch.
3. For each high-risk function: `query_graph_tool(pattern="tests_for")` to check coverage.
4. `get_impact_radius_tool` for blast radius of the riskiest files.
5. `get_review_context_tool` for token-efficient source snippets — read full files only when a snippet is ambiguous.

## Output

Group findings by risk (high/medium/low). For each: what changed and why it matters, test coverage status, suggested improvement. End with a merge recommendation. For untested high-risk changes, name the specific test cases to add.

## Rules

- Risk scores prioritize attention; they don't replace judgment. A low-risk score on an auth or payment path still deserves a read.
- Pass `detail_level="minimal"`; escalate to `"standard"` only when minimal output is insufficient.
- Diffs in files outside graph coverage (config, SQL, CI) must still be reviewed — use git diff and Read for those.
