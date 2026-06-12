---
name: data-quality-gate
description: Add or extend data validation checks in the pipeline when data quality issues are detected — null-percentage thresholds, value ranges, referential integrity, and row-count sanity checks. Use when a pipeline breaks on bad data, when onboarding a new dataset, or when asked to "add a quality check for {column}".
metadata:
  forged-by: claude-agent
  forged-from: session-2026-03-22
  forged-reason: "Forked from analytics-core/data-quality-gate — that skill only covered numeric-range checks; this version adds null-percentage and referential-integrity checks for ETL pipelines"
  fork-of: analytics-core/data-quality-gate
  usage-count: "8"
  last-used: "2026-05-28"
---

# Data Quality Gate

Add or extend validation checks that block bad data from propagating through the pipeline.

## Inputs
- Stage name where the gate should run (e.g., `customer_events`)
- Check type: `null_rate` | `range` | `referential` | `row_count` | `custom`
- Column(s) affected
- Threshold or reference table (depending on check type)
- Severity: `warn` (log and continue) or `fail` (halt the pipeline)

## Steps

1. **Identify where to add the gate**
   Gates run after ingestion (raw → staging) or after a transform (staging → marts).
   Most gaps are caught earliest; prefer adding checks at the earliest stage where the data is available.

2. **Write the check**

   **Null-rate check:**
   ```python
   def check_null_rate(df, column, threshold=0.05):
       rate = df[column].isnull().mean()
       if rate > threshold:
           raise DataQualityError(
               f"{column} null rate {rate:.1%} exceeds threshold {threshold:.1%}"
           )
   ```

   **Range check:**
   ```python
   def check_range(df, column, min_val, max_val):
       out_of_range = df[(df[column] < min_val) | (df[column] > max_val)]
       if len(out_of_range) > 0:
           raise DataQualityError(
               f"{column}: {len(out_of_range)} rows outside [{min_val}, {max_val}]"
           )
   ```

   **Referential integrity check:**
   ```python
   def check_referential(df, fk_column, reference_df, pk_column):
       orphans = df[~df[fk_column].isin(reference_df[pk_column])]
       if len(orphans) > 0:
           raise DataQualityError(
               f"{fk_column}: {len(orphans)} rows with no matching {pk_column}"
           )
   ```

   **Row-count sanity check:**
   ```python
   def check_row_count(df, min_rows, max_rows=None):
       n = len(df)
       if n < min_rows:
           raise DataQualityError(f"Only {n} rows; expected at least {min_rows}")
       if max_rows and n > max_rows:
           raise DataQualityError(f"{n} rows exceeds max {max_rows}")
   ```

3. **Register the check in the stage's test suite**
   Add the check to `pipelines/ingestion/{stage_name}/tests/test_quality.py` or the dbt schema YAML:
   ```yaml
   # dbt schema
   - name: {column}
     tests:
       - not_null
       - dbt_utils.accepted_range:
           min_value: {min}
           max_value: {max}
   ```

4. **Set the severity**
   - `warn`: emit a metric + log; allow the pipeline to continue.
   - `fail`: raise `DataQualityError`; the scheduler marks the run as failed.
   Document the choice and rationale in the check's docstring.

5. **Test the check**
   Write a test that intentionally violates the threshold and confirms the exception is raised:
   ```python
   def test_null_rate_fails():
       bad_df = pd.DataFrame({"col": [None] * 10})
       with pytest.raises(DataQualityError):
           check_null_rate(bad_df, "col", threshold=0.05)
   ```

6. **Document in the data dictionary**
   Add a "Quality checks" section to `docs/data-dictionary/{stage_name}.md`:
   | Check | Column | Threshold | Severity |
   |-------|--------|-----------|----------|
   | null_rate | {col} | < 5% | fail |

## Conventions
- All checks are functions in `pipelines/quality/checks.py`; imported by stage test files
- `DataQualityError` is defined in `pipelines/quality/errors.py`
- Metrics emitted: `data_quality.{stage}.{check}.{column}` (gauge, 0=pass, 1=fail)
- Null-rate thresholds are per-column, not global
- Referential checks are `warn` severity by default unless the FK is critical for downstream joins

## Edge Cases
- **Threshold is too tight and causes false positives:** Increase the threshold and document the change in git with a comment; don't just bump it silently.
- **Data arrives in batches (some partitions are empty):** Add a `min_rows_per_partition` check rather than a total row-count check.
- **Reference table is unavailable (API down):** Wrap the referential check in a try/except; emit a `warn`-level metric and continue rather than failing the pipeline.
- **Check runs too slowly on large datasets:** Sample 10% of rows for range/null checks; document the sampling in the check's docstring.
