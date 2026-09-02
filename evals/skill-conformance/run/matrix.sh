#!/usr/bin/env bash
# N-run matrix: every scenario x N, sequential.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
N="${N:-5}"
export MODEL="${MODEL:-sonnet}"
echo "matrix start: model=$MODEL N=$N $(date -u +%H:%M:%SZ)"
for i in $(seq 1 "$N"); do
  for scen in f2-control f1-flow; do
    RUN_ID="r$i" bash "$ROOT/run/run.sh" "$scen"
  done
done
echo "matrix done $(date -u +%H:%M:%SZ)"
