#!/usr/bin/env bash
# Skill-conformance eval runner (working-to-standard). One scenario per
# invocation. Each run gets a FRESH copy of fixtures/base (runs mutate it;
# the post-state is evidence). The skill under test is staged from THIS
# checkout's packages/cli/templates, so the suite always evaluates HEAD.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
SCEN="${1:?usage: run.sh <f1-flow|f2-control>}"
MODEL="${MODEL:-haiku}"
TAG="$SCEN${RUN_ID:+-$RUN_ID}"
mkdir -p "$ROOT/results" "$ROOT/logs" "$ROOT/work"

case "$SCEN" in
  f1-flow)
    PROMPT="You have the working-to-standard skill at .claude/skills/working-to-standard/SKILL.md. Follow it exactly while doing this task: add a farewell(name) function to src/greet.mjs, mirroring greet(name), with a test. Then report done."
    ;;
  f2-control)
    PROMPT="You have the working-to-standard skill at .claude/skills/working-to-standard/SKILL.md. Follow it. Task: run the guards (node guards/run.mjs) and the unit tests, and use the Edit tool to add the line '- control marker' to CHANGELOG.md (unconditionally - it marks this run, not the results). Report the results."
    ;;
  *) echo "unknown scenario: $SCEN"; exit 2;;
esac

# The eval sub-session inherits this PATH: without nvm sourced here, the
# fixture's node/npm commands fail (and Windows npm leaks in via /mnt/c).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
nvm use 24 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
command -v node >/dev/null || { echo "FATAL: node not on PATH for eval sub-session"; exit 3; }

WORK="$ROOT/work/$TAG"
rm -rf "$WORK"
cp -r "$ROOT/fixtures/base" "$WORK"
mkdir -p "$WORK/.claude/skills/working-to-standard"
cp "$REPO/packages/cli/templates/claude/skills/working-to-standard/SKILL.md" \
   "$WORK/.claude/skills/working-to-standard/SKILL.md"

cd "$WORK"
# Tier-1 canary: the runner itself must pass the fixture's own ladder before
# any model session starts. Measuring behavior on a broken substrate produces
# plausible-looking garbage (learned the hard way — see REPORT.md, round 1).
node guards/run.mjs >/dev/null || { echo "FATAL: fixture guards fail pre-flight"; exit 3; }
npm test >/dev/null 2>&1 || { echo "FATAL: fixture tests fail pre-flight"; exit 3; }

claude -p "$PROMPT" \
  --model "$MODEL" --max-turns 20 \
  --output-format stream-json --verbose \
  --allowedTools "Bash(node:*)" "Bash(npm:*)" "Read" "Glob" "Grep" "Edit" "Write" \
  > "$ROOT/results/$TAG.jsonl" 2> "$ROOT/results/$TAG.err" || true

echo "run=$TAG model=$MODEL events=$(wc -l < "$ROOT/results/$TAG.jsonl")"
