---
name: experiment-log
description: Record a model training run — log parameters, metrics, and artifact paths, then append a structured row to the experiments ledger. Use when a training run completes, when asked to "log this experiment", or when comparing runs to decide which model to promote.
metadata:
  forged-by: cursor-agent
  forged-from: session-2026-03-10
  forged-reason: "Logged 3 training runs in three days; each time the ledger entry format was different and comparison was impossible — encoded a consistent schema"
  usage-count: "26"
  last-used: "2026-06-10"
---

# Experiment Log

Record a training run's parameters, metrics, and artifact paths in the experiments ledger.

## Inputs
- Experiment name (e.g., `churn-v3-lgbm`)
- Run ID (auto-generated if omitted: `{name}-{YYYYMMDD-HHmmss}`)
- Parameters (key-value pairs, e.g., `learning_rate=0.05 n_estimators=500`)
- Metrics (key-value pairs, e.g., `auc=0.83 f1=0.71 precision=0.79 recall=0.64`)
- Artifact path (model checkpoint, serialized pipeline, etc.)
- Notes (free-form, optional)

## Steps

1. **Collect run metadata**
   ```python
   import datetime, hashlib, json, os

   run_id = "{name}-" + datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
   git_sha = os.popen("git rev-parse --short HEAD").read().strip()
   dataset_version = open("data/.version").read().strip()  # semver or hash
   ```

2. **Capture parameters and metrics**
   If using a training script that outputs JSON:
   ```bash
   python train.py --config config/{name}.yaml --output-metrics /tmp/metrics.json
   ```
   Otherwise, capture values directly from the trainer object:
   ```python
   params = model.get_params()
   metrics = {"auc": roc_auc_score(y_test, y_pred), "f1": f1_score(y_test, y_pred)}
   ```

3. **Save artifacts**
   ```python
   import joblib
   artifact_path = f"artifacts/{run_id}/model.pkl"
   os.makedirs(os.path.dirname(artifact_path), exist_ok=True)
   joblib.dump(model, artifact_path)
   ```

4. **Append to the experiments ledger**
   ```bash
   scripts/log-experiment.sh \
     --name "{name}" \
     --run-id "{run_id}" \
     --params '{"learning_rate": 0.05}' \
     --metrics '{"auc": 0.83, "f1": 0.71}' \
     --artifact "{artifact_path}" \
     --notes "{notes}"
   ```
   The ledger is `experiments/log.csv` — a flat CSV with one row per run.

5. **Verify the entry**
   ```bash
   tail -n 5 experiments/log.csv
   ```
   Confirm: run_id is unique, metrics are numeric, artifact path exists.

6. **Compare with previous runs** (optional)
   ```bash
   python scripts/compare-runs.py --metric auc --top 5
   ```

7. **Promote if best** (invoke `pipeline-stage` skill to wire the new model into serving)
   Only promote after peer review of the metrics and a sanity-check on the holdout set.

## Conventions
- Ledger location: `experiments/log.csv` — never delete rows; mark superseded runs with `status=superseded`
- Artifact naming: `artifacts/{run_id}/` — one directory per run
- Required fields: `run_id`, `experiment_name`, `timestamp`, `git_sha`, `auc` (or primary metric), `artifact_path`
- All metrics are floats; parameters are JSON strings
- Every run references the dataset version it trained on (`dataset_version` column)

## Edge Cases
- **Duplicate run_id:** Append a counter suffix (`-2`, `-3`) rather than overwriting; log a warning.
- **Training failed mid-run:** Log the entry with `status=failed` and the error message in `notes`; don't leave the ledger entry absent.
- **Very large artifact:** Store only the path; add a `artifact_size_mb` column for reference.
- **Remote artifact store (S3/GCS):** Use the full URI as `artifact_path`; the log script accepts both local paths and URIs.
