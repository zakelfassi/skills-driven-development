---
name: backfill-runbook
description: Safely backfill historical data for a pipeline stage — scope the date range, run a dry-run, execute in chunks to avoid overwhelming the database, and verify row counts after each chunk. Use when historical data is missing, when a pipeline stage is added retroactively, or when asked to "backfill the {stage} table from {start_date}".
metadata:
  forged-by: codex-agent
  forged-from: session-2026-04-20
  forged-reason: "Our first unsupervised backfill (90-day range, 4M rows) locked the production table for 40 minutes. Forged this skill to enforce chunking and dry-run gates."
  usage-count: "3"
  last-used: "2026-04-30"
---

# Backfill Runbook

Safely reprocess historical data for a pipeline stage without locking tables or losing existing rows.

## Inputs
- Stage name (e.g., `customer_ltv`)
- Start date (`YYYY-MM-DD`)
- End date (`YYYY-MM-DD`, defaults to yesterday)
- Chunk size (number of days per chunk, defaults to `7`)
- Dry run? (boolean, defaults to `true` — always start with dry-run)

## Steps

1. **Scope the backfill**
   Estimate the volume:
   ```sql
   select count(*), min(event_date), max(event_date)
   from raw.{source_table}
   where event_date between '{start_date}' and '{end_date}';
   ```
   Multiply by your stage's typical row-expansion ratio. If the result is >10M rows, reduce the chunk size to 3 days.

2. **Dry-run the first chunk**
   ```bash
   python pipelines/transforms/{stage_name}/transform.py \
     --start {start_date} \
     --end {start_date + 6 days} \
     --dry-run
   ```
   The dry-run prints the SQL or DataFrame operations without writing output. Review for correctness before proceeding.

3. **Back up the target table** (if it exists)
   ```sql
   create table {stage_name}_backup_{today} as
   select * from {layer}.{stage_name};
   ```
   Keep the backup for 7 days.

4. **Execute in chunks**
   ```bash
   python scripts/backfill.py \
     --stage {stage_name} \
     --start {start_date} \
     --end {end_date} \
     --chunk-days {chunk_size} \
     --pause-seconds 5
   ```
   The backfill script:
   - Processes one chunk at a time
   - Pauses `{pause_seconds}` between chunks (reduces lock contention)
   - Logs progress: `[chunk {n}/{total}] {start}–{end}: {rows_written} rows`
   - Writes a checkpoint file (`backfill-{stage}-{run_id}.checkpoint`) so it can resume after a failure

5. **Verify each chunk** (or verify the full range after completion)
   ```sql
   -- Row count by date
   select event_date, count(*) as rows
   from {layer}.{stage_name}
   where event_date between '{start_date}' and '{end_date}'
   group by event_date
   order by event_date;
   ```
   Compare against the raw source counts from step 1. Flag any date with zero rows.

6. **Run the data quality gate** (invoke `data-quality-gate` skill)
   Check null rates, ranges, and referential integrity on the backfilled range.

7. **Drop the backup** (after 7 days, if no issues)
   ```sql
   drop table {stage_name}_backup_{today};
   ```

## Conventions
- Always start with `--dry-run`; never skip this step
- Chunk size ≤ 7 days for tables with >1M rows/day; ≤ 30 days for smaller tables
- Backfills run during off-peak hours (after 22:00 UTC on weekdays, any time on weekends)
- The backfill script uses `INSERT OVERWRITE` (or `REPLACE INTO`) semantics — idempotent per chunk
- Checkpoint files are committed to `backfills/` so the team can see what has been run

## Edge Cases
- **Pipeline failure mid-chunk:** Resume from the last checkpoint: `python scripts/backfill.py --resume backfill-{stage}-{run_id}.checkpoint`.
- **Source data changed retroactively (late-arriving events):** Add `--allow-late-data` flag; document in the backfill log that the range was reprocessed for late-arrival reasons.
- **Backfill conflicts with a running daily load:** Check the scheduler; delay the backfill or pause the daily DAG temporarily. Never run both simultaneously on the same partition.
- **Very long date range (>1 year):** Split into multiple backfill jobs of ≤90 days each; run sequentially and verify between jobs.
