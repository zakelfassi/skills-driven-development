#!/usr/bin/env bash
# log-experiment.sh — illustrative script for the experiment-log skill
#
# This is a teaching stub. It appends a fake experiment row to a local
# experiments/log.csv file and prints the row, so the example is
# self-consistent (the skill references this path) without assuming a
# real ML project, model, or database connection.
#
# Replace this with your actual experiment logging logic (MLflow, W&B,
# a real CSV append, a database insert, etc.) when you fork this skill
# into a real project.

set -euo pipefail

NAME="example-run"
PARAMS='{"learning_rate": 0.05, "n_estimators": 300}'
METRICS='{"auc": 0.83, "f1": 0.71, "precision": 0.79, "recall": 0.64}'
ARTIFACT="artifacts/example-run/model.pkl"
NOTES="stub run — no real training performed"

# Parse named arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --params) PARAMS="$2"; shift 2 ;;
    --metrics) METRICS="$2"; shift 2 ;;
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    *) shift ;;
  esac
done

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo 'now')"
RUN_ID="${RUN_ID:-${NAME}-$(date -u '+%Y%m%d-%H%M%S' 2>/dev/null || echo '00000000-000000')}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

LEDGER_DIR="$(dirname "$0")/../../../experiments"
LEDGER="${LEDGER_DIR}/log.csv"

mkdir -p "$LEDGER_DIR"

if [ ! -f "$LEDGER" ]; then
  echo "run_id,experiment_name,timestamp,git_sha,params,metrics,artifact_path,notes,status" > "$LEDGER"
fi

ROW="${RUN_ID},${NAME},${NOW},${GIT_SHA},\"${PARAMS}\",\"${METRICS}\",${ARTIFACT},\"${NOTES}\",completed"

echo "$ROW" >> "$LEDGER"

cat <<EOF
[log-experiment] appended experiment row
[log-experiment] ─────────────────────────────────────────────
[log-experiment] run_id:    ${RUN_ID}
[log-experiment] name:      ${NAME}
[log-experiment] timestamp: ${NOW}
[log-experiment] git_sha:   ${GIT_SHA}
[log-experiment] params:    ${PARAMS}
[log-experiment] metrics:   ${METRICS}
[log-experiment] artifact:  ${ARTIFACT}
[log-experiment] notes:     ${NOTES}
[log-experiment] status:    completed
[log-experiment] ─────────────────────────────────────────────
[log-experiment] ledger:    ${LEDGER}
[log-experiment] total rows: $(wc -l < "$LEDGER")

[log-experiment] (stub) — no real model training performed.
EOF
