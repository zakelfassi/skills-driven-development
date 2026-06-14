---
name: dataset-onboard
description: Onboard a new raw dataset into the data platform — sniff the schema, generate a profiling notebook, create the ingestion job, and add an entry to the data dictionary. Use when adding a new data source, when a partner delivers a new CSV/Parquet drop, or when asked to "onboard the {name} dataset".
metadata:
  forged-by: claude-agent
  forged-from: session-2026-02-12
  forged-reason: "Onboarded orders, returns, and inventory datasets in one week; schema sniff + profiling + ingestion job had identical structure each time"
  usage-count: "11"
  last-used: "2026-05-20"
---

# Dataset Onboard

Bring a new raw dataset into the platform with schema documentation, profiling, and an ingestion job.

## Inputs
- Dataset name (snake_case, e.g., `customer_events`)
- Source format (`csv`, `parquet`, `json`, `avro`)
- Source path or URI (S3, GCS, local mount, API endpoint)
- Expected frequency (`daily`, `weekly`, `on-demand`)
- Owner team and contact

## Steps

1. **Schema sniff**
   ```python
   import pandas as pd
   df = pd.read_csv("{source_path}", nrows=1000)   # or read_parquet, etc.
   print(df.dtypes)
   print(df.describe(include="all"))
   print(df.isnull().sum() / len(df))              # null rates
   ```
   Document:
   - Column names, inferred types, null rates, example values
   - Detected anomalies (mixed types, encoding issues, unexpected nulls)

2. **Create the data dictionary entry**
   Edit `docs/data-dictionary/{dataset_name}.md`:
   ```markdown
   # {DatasetName}

   **Owner:** {team}  **Contact:** {email}
   **Source:** {uri}  **Frequency:** {frequency}

   | Column | Type | Nullable | Description |
   |--------|------|----------|-------------|
   | ...    | ...  | ...      | ...         |
   ```

3. **Generate the profiling notebook**
   ```bash
   cp templates/profiling-notebook.ipynb \
      notebooks/profiling/{dataset_name}_profile.ipynb
   ```
   Edit the notebook to use the correct source path and column list.
   Run it to confirm it completes without errors.

4. **Create the ingestion job**
   ```
   pipelines/ingestion/{dataset_name}/
   ├── ingest.py          # main ingestion script
   ├── schema.py          # column definitions and type coercion
   ├── config.yaml        # source path, schedule, destination table
   └── tests/
       └── test_ingest.py # unit test with a small fixture file
   ```
   The ingestion script must be **idempotent** (re-running on the same input produces the same output; no duplicate rows).

5. **Register in the scheduler**
   Add a DAG entry in `dags/{dataset_name}_ingest.py` (Airflow) or a flow in `flows/` (Prefect).
   Set the schedule to match `{frequency}`.

6. **Test the ingestion**
   ```bash
   python -m pytest pipelines/ingestion/{dataset_name}/tests/ -v
   python pipelines/ingestion/{dataset_name}/ingest.py --dry-run
   ```

7. **Run a data quality gate** (invoke `data-quality-gate` skill)
   Add at minimum: null checks for required columns, row-count sanity check.

## Conventions
- Raw datasets land in the `raw/` schema/layer; never write to `staging/` or `marts/` from an ingestion job
- All ingestion jobs accept `--dry-run` and `--date` flags
- Dataset names are snake_case; tables follow the same naming
- Profiling notebooks live in `notebooks/profiling/`; they are committed

## Edge Cases
- **Malformed source file:** Log the error with row number, skip the bad row, emit a `data_quality_alert` metric. Never silently swallow rows.
- **Schema drift (columns added/removed):** The ingestion job must compare the inbound schema to `schema.py` and fail fast on unexpected changes, rather than silently loading partial data.
- **Large datasets (>1GB):** Use chunked reads (`chunksize` in pandas, or native Parquet partitioning); test with a 10k-row sample first.
- **API source with rate limits:** Add exponential back-off and a `--resume-from` flag that uses a checkpoint file.
