---
name: pipeline-stage
description: Scaffold a new transform stage in the data pipeline — create the transformation script, schema contract, idempotency logic, and tests. Use when adding a new dbt model or pandas transform, when a new business metric needs a dedicated stage, or when asked to "add a {name} stage to the pipeline".
metadata:
  forged-by: codex-agent
  forged-from: session-2026-02-28
  forged-reason: "Added customer_ltv, order_summary, and refund_rate stages in one sprint; each needed the same skeleton: transform file, contract, idempotency test, registration"
  usage-count: "19"
  last-used: "2026-06-02"
---

# Pipeline Stage

Create a new transform stage with idempotency guarantees, a schema contract, and tests.

## Inputs
- Stage name (snake_case, e.g., `customer_ltv`)
- Input tables/models (list of upstream stage names or raw tables)
- Output table name (usually matches stage name)
- Grain (the primary key or unique key, e.g., `customer_id`, `(order_id, date)`)
- Layer (`staging`, `intermediate`, `marts`)

## Steps

1. **Create the transform file**

   For dbt:
   ```
   models/{layer}/{stage_name}.sql
   ```
   ```sql
   {{ config(
       materialized='table',
       unique_key='{grain}'
   ) }}

   select
       {grain},
       -- TODO: add business logic
       current_timestamp as updated_at
   from {{ ref('{input_table}') }}
   ```

   For pandas ETL:
   ```
   pipelines/transforms/{stage_name}/transform.py
   ```
   ```python
   def run(df: pd.DataFrame) -> pd.DataFrame:
       """Transform {input_table} → {stage_name}."""
       # TODO: add business logic
       return df
   ```

2. **Define the schema contract**
   Create `models/{layer}/schema/{stage_name}.yaml` (dbt) or `pipelines/transforms/{stage_name}/schema.py`:
   ```yaml
   - name: {stage_name}
     columns:
       - name: {grain}
         tests:
           - unique
           - not_null
   ```
   Every non-nullable column must have `not_null` test; every unique key must have `unique` test.

3. **Add idempotency logic**
   - For `materialized='table'`: dbt handles full replacement — no extra work.
   - For incremental models: use `is_incremental()` filter on `updated_at` or an event timestamp.
   - For pandas: the output must be deterministic given the same input; add a dedup step on `{grain}`.

4. **Write tests**
   ```
   tests/transforms/test_{stage_name}.py
   ```
   Required tests:
   - Input fixture → expected output shape (column names, row count)
   - Idempotency: running twice produces identical output
   - Null check: no nulls in required columns after transform

5. **Register in the pipeline DAG**
   Add the stage after its upstream dependencies:
   ```python
   # dags/pipeline.py
   {stage_name}_task = DbtRunOperator(
       task_id="{stage_name}",
       models="{stage_name}",
   )
   {upstream_task} >> {stage_name}_task
   ```

6. **Run locally**
   ```bash
   dbt run --select {stage_name}
   dbt test --select {stage_name}
   # or for pandas:
   python -m pytest tests/transforms/test_{stage_name}.py -v
   ```

## Conventions
- Layer hierarchy: `raw` → `staging` → `intermediate` → `marts`
- Never skip a layer (e.g., don't read from `raw` in a `marts` model)
- All stages have at least one `unique` + `not_null` test on the grain column
- Incremental models use `updated_at` as the watermark; add it to every model

## Edge Cases
- **Fan-out (multiple downstream consumers):** Create the stage at the `intermediate` layer; let downstream `marts` models reference it.
- **Slowly changing dimension (SCD):** Use dbt's `snapshot` materialization or add `valid_from`/`valid_to` columns manually.
- **Cross-database join:** Materialize both inputs to the same database first, then join; cross-database SQL is not portable.
- **Very wide table (>200 columns):** Split into a core model plus an extension model; document the split in the schema YAML.
