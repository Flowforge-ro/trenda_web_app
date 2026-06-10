---
name: handoff
description: Use when context is running low, a session is ending mid-task, or the user asks to hand off work so a fresh session can continue it
---

# Handoff

Write or update a handoff document so the next agent with fresh context can continue this work.

## Steps

1. Check if `HANDOFF.md` exists in the project root. If it exists, read it first to understand prior context before updating.
2. Create or update it with these sections:
   - **Goal**: what we're trying to accomplish
   - **Current Progress**: what's been done so far (include branch name and key file paths)
   - **What Worked**: approaches that succeeded
   - **What Didn't Work**: approaches that failed, and why — so they're not repeated
   - **Next Steps**: concrete action items, most important first
3. Save as `HANDOFF.md` in the project root and tell the user the file path so they can start a fresh conversation with just that path.

## Rules

- Write for an agent with zero conversation context: no shorthand, no "as discussed", absolute paths.
- State facts you verified (tests passing, commands run) separately from assumptions.
- Keep it current: delete completed next steps rather than appending forever.
