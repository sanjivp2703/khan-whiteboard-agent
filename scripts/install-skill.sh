#!/usr/bin/env bash
# Installs the khan skill as a PERSONAL Claude Code skill (~/.claude/skills/khan) so `/khan`
# works from any project. The copy points at this repo by absolute path; re-run after pulling.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/.claude/skills/khan/SKILL.md"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/khan"
mkdir -p "$DEST_DIR"
# Replace the project-relative CLI path with this repo's absolute path.
sed "s#\${CLAUDE_PROJECT_DIR}#$REPO#g" "$SRC" > "$DEST_DIR/SKILL.md"
printf '# Installed by %s on %s from %s\n' "$0" "$(date -u +%Y-%m-%dT%H:%MZ)" "$REPO" > "$DEST_DIR/INSTALLED.md"
echo "installed: $DEST_DIR/SKILL.md"
echo "CLI: $REPO/bin/khan"
echo "Needs in the shell that runs Claude Code: OPENAI_API_KEY exported (see README). Lessons go to $REPO/.khan/lessons unless KHAN_HOME is set."
