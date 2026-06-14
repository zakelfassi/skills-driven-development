---
name: flag-add
description: Add a CLI flag to shipctl end-to-end — argument parser definition, help text, shell completion scripts, documentation, and tests. Use when adding a new option or flag, when extending an existing subcommand, or when asked to "add a --flag-name option".
metadata:
  forged-by: cursor-agent
  forged-from: session-2026-04-02
  forged-reason: "Added --output, --format, and --timeout flags in three consecutive tasks with identical boilerplate — parser, help, completion, docs, test"
  usage-count: "22"
  last-used: "2026-06-01"
---

# Flag Add

Add a new CLI flag to a `shipctl` command end-to-end.

## Inputs
- Command path (e.g., `release`, `build cross`, `config set`)
- Flag name (long form, e.g., `--output-dir`)
- Short alias (optional, e.g., `-o`)
- Type (string, bool, integer, path)
- Default value (or `required` if mandatory)
- Description (one-line, used in help text and docs)

## Steps

1. **Define the flag in the parser**

   For Rust + `clap`:
   ```rust
   // In the relevant Args struct (src/cmd/{command}.rs)
   #[arg(long, short = '{alias}', default_value = "{default}",
         help = "{description}")]
   pub {flag_name}: {type},
   ```

   For Go + `cobra`:
   ```go
   // In the relevant command file (cmd/{command}.go)
   cmd.Flags().{TypeVar}(&opts.{FlagName}, "{flag-name}", {default}, "{description}")
   ```

2. **Wire the value into the command logic**
   Pass the flag value through to whatever downstream call needs it.
   Verify the happy path compiles: `cargo check` / `go build ./...`.

3. **Update the help text**
   Run `shipctl {command} --help` and confirm the flag appears with the correct description and default.

4. **Add shell completions**
   Regenerate completions (invoke `manpage-sync` skill, or manually):
   ```bash
   shipctl completions bash > completions/shipctl.bash
   shipctl completions zsh  > completions/_shipctl
   shipctl completions fish > completions/shipctl.fish
   ```
   Commit the updated completion files.

5. **Update documentation**
   Edit `docs/reference/{command}.md`:
   - Add a row to the **Flags** table: `| --{flag-name} | {type} | {default} | {description} |`
   - Add an **Examples** entry if the flag has a non-obvious use

6. **Write or extend a test**
   ```rust
   // tests/cmd_{command}.rs
   #[test]
   fn test_{flag_name}_flag() {
       let output = Command::cargo_bin("shipctl").unwrap()
           .arg("{command}")
           .arg("--{flag-name}").arg("{test-value}")
           .assert().success();
       // assert output contains expected value
   }
   ```

7. **Verify the full suite passes**
   ```bash
   cargo test --workspace
   ```

## Conventions
- Long flags are kebab-case (`--output-dir`, not `--outputDir`)
- Boolean flags use `--flag` / `--no-flag` pair when toggling a default-on behavior
- Flags that accept file paths validate existence (return error with `ENOENT` message)
- Help text: imperative mood, no trailing period, max 72 chars
- Short aliases: only for the top 10 most-used flags; don't add new ones without team sign-off

## Edge Cases
- **Conflicting short alias:** Run `shipctl --help` on the parent command to audit existing aliases; pick a different letter or omit the alias.
- **Required flag without a default:** Add a clear error message with the flag name and an example invocation.
- **Flag affects multiple subcommands:** Define it at the parent command level with `PersistentFlags()` (cobra) or `Args` flattening (clap).
- **Boolean flag default is `true`:** Document this prominently; many users expect flags to be opt-in.
