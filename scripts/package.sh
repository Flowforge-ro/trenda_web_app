#!/usr/bin/env bash
#
# Package the project into a zip for deployment to the VPS.
# Excludes deps, build output, git, AI-tooling dirs, docs/markdown, and scratch files.
#
# Usage:
#   ./scripts/package.sh                 # -> dist-pkg/trenda_web_app_<timestamp>.zip
#   ./scripts/package.sh /tmp/out.zip    # custom output path
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-$ROOT/dist-pkg/trenda_web_app_${TS}.zip}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Directories / globs to leave out of the archive.
EXCLUDES=(
  # dependencies & build output
  '*/node_modules/*' 'node_modules/*'
  '*/dist/*' 'dist/*' '*/build/*' 'build/*'
  'dist-pkg/*'
  'backend/src/generated/*'
  # vcs & CI
  '.git/*' '.github/*'
  # AI / editor tooling
  '.claude/*' '.gemini/*' '.kiro/*' '.qoder/*' '.code-review-graph/*'
  '.cursorrules' '.windsurfrules' '.opencode.json' '.mcp.json'
  'AGENTS.md' 'GEMINI.md' 'QODER.md'
  # planning / scratch / docs
  'PATHFINDER-*/*' 'docs/*'
  '*.md'
  '*.log'
  # large scratch transcripts
  '*-local-command-caveat*.txt'
)

EXARGS=()
for e in "${EXCLUDES[@]}"; do
  EXARGS+=( -x "$e" )
done

echo "Packaging -> $OUT"
zip -r -q "$OUT" . "${EXARGS[@]}"

echo "Done. $(du -h "$OUT" | cut -f1)  $OUT"
