# MCP Sync

> One canonical `~/.skdd/mcp.json` propagated to every AI host on your machine — merge-not-overwrite, secrets never leave your environment.

`skdd mcp` manages a single catalogue of MCP (Model Context Protocol) servers and synchronises it to the seven AI hosts that support MCP. Add a server once and it appears everywhere you've enabled it, in the format each host natively expects.

---

## Quick start

```bash
# Add a server to the canonical catalogue
skdd mcp add my-tool \
  --command npx --args "-y @acme/my-tool-mcp" \
  --env "API_KEY=\${MY_API_KEY}"

# Preview what sync would do without writing anything
skdd mcp sync --dry-run

# Sync to all available hosts
skdd mcp sync

# List configured servers
skdd mcp list

# Remove a server (sync will delete it from hosts on next run)
skdd mcp remove my-tool && skdd mcp sync
```

---

## Canonical schema

The canonical file lives at `~/.skdd/mcp.json` (or `$SKDD_HOME/mcp.json`).

```jsonc
{
  "version": 1,
  "servers": {
    "my-tool": {
      // stdio server
      "command": "npx",
      "args": ["-y", "@acme/my-tool-mcp"],
      "env": { "API_KEY": "${MY_API_KEY}" },
      "hosts": ["claude-code", "droid"],   // optional allowlist; absent = all hosts
      "disabled": false
    },
    "remote-service": {
      // remote server (HTTP or SSE)
      "url": "https://mcp.example.com/mcp",
      "type": "http",                      // "http" | "sse"
      "headers": { "Authorization": "Bearer ${SVCTOKEN}" },
      "disabled": false
    }
  }
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `version` | `1` | Schema version. Always `1` for now. |
| `servers.<name>.command` | string | Executable to launch (stdio servers). Mutually exclusive with `url`. |
| `servers.<name>.args` | string[] | Arguments passed to `command`. |
| `servers.<name>.env` | object | Environment variables. Supports `${VAR}` placeholders (see below). |
| `servers.<name>.url` | string | Endpoint URL (remote servers). Mutually exclusive with `command`. |
| `servers.<name>.type` | `"http"` \| `"sse"` | Transport type for remote servers. |
| `servers.<name>.headers` | object | HTTP headers (remote servers). Supports `${VAR}` placeholders. |
| `servers.<name>.hosts` | string[] | Optional allowlist of host IDs (see table below). If absent, server is synced to all available hosts. |
| `servers.<name>.disabled` | boolean | Skip this server during sync without removing it from the catalogue. |

**Validation rules enforced on every load and save:**
- `version` must equal `1`
- `servers` must be a plain object
- Each server must have exactly one of `command` or `url` (not both)
- Duplicate server names in the raw JSON file are detected **before** `JSON.parse` (which would silently collapse them), and the file is rejected

---

## `${VAR}` placeholders

Environment variable placeholders in `env`, `headers`, and `url` values are resolved from `process.env` **at sync (write) time**, never persisted to the canonical file in resolved form, and never read back from host files.

```jsonc
// In ~/.skdd/mcp.json
"env": { "API_KEY": "${MY_API_KEY}" }

// Written to ~/.claude.json at sync time (resolved)
"env": { "API_KEY": "sk-actual-secret" }
```

If a placeholder variable is unset at sync time, the CLI prints a warning and skips syncing that server to that host. The canonical file keeps the placeholder unexpanded.

**Exception — Factory Droid**: Droid's MCP format natively supports `${VAR}` placeholders and performs its own runtime expansion. For the Droid adapter, unresolved placeholders are passed through to the host file unexpanded rather than causing a skip.

---

## `hosts` allowlist

Set `hosts` on a server to restrict which hosts it is synced to. Host IDs are:

`claude-code`, `claude-desktop`, `codex`, `droid`, `cursor`, `opencode`, `gemini`

```jsonc
"hosts": ["claude-code", "droid"]   // only sync to Claude Code and Factory Droid
```

If you later **remove** a host from an existing server's `hosts` list, the next `skdd mcp sync` run will **delete** that server from the now-excluded host (because the server was previously managed by skdd on that host and is now explicitly excluded).

---

## 7-host adapter table

| Host | Config file | Format | Key path | Notable quirks |
|------|-------------|--------|----------|----------------|
| **Claude Code** | `~/.claude.json` | JSON | `mcpServers.<name>` | The file holds ~40 sibling keys (project caches, onboarding state, etc.). **Surgical merge**: skdd parses the whole file and touches only `mcpServers`. `disabled: true` → entry removed (no native disabled flag at user scope). |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON | `mcpServers.<name>` | macOS only (`available()` returns false on non-darwin). Remote servers are not natively supported — if a remote server is synced to this host, skdd prints a warning and skips it. File also holds `globalShortcut`, `preferences`, and other keys — surgical merge. |
| **Codex CLI** | `~/.codex/config.toml` | TOML | `[mcp_servers.<name>]` tables | Never reserialised in full. Uses **comment-preserving block splice** (see below). `disabled: true` → `enabled = false` in the TOML entry. |
| **Factory Droid** | `~/.factory/mcp.json` | JSON | `mcpServers.<name>` | Native support for `${VAR}` placeholders, `disabled`, `enabledTools`/`disabledTools`, `timeoutMs`. File also has `persistentPermissions` at the root — surgical merge. Unresolved `${VAR}` values are passed through unexpanded. |
| **Cursor** | `~/.cursor/mcp.json` | JSON | `mcpServers.<name>` | File is typically minified (single line). Written back pretty-printed; Cursor re-reads correctly. `disabled: true` → entry removed. |
| **OpenCode** | `~/.config/opencode/opencode.json` | JSON | `mcp.<name>` | **Different schema**: `command` becomes an argv array (`[cmd, ...args]`); env key is `environment` (not `env`); `disabled` maps to `enabled: false`. Remote → `{type:"remote", url}`. File also has `$schema` and other config — surgical merge. |
| **Gemini CLI** | `~/.gemini/settings.json` | JSON | `mcpServers.<name>` | File holds `general`, `security`, `ui`, etc. — surgical merge. Same Antigravity CLI transition caveat as global skills (see [global-colony.md](global-colony.md)). `disabled: true` → entry removed. |

All adapters share these guarantees:
- **Merge, not overwrite**: only the adapter's own key path is touched; all sibling keys are round-tripped untouched.
- **Removal restricted to managed names**: skdd only removes server entries it originally wrote (tracked in `~/.skdd/.skdd-sync.json`). User-authored entries with the same name as a canonical server but not recorded in managed state are warned about and left untouched.
- **Malformed host config → blocked, no write**: if `read()` fails to parse the host config, that host is marked blocked for this sync run; other hosts continue; the exit code is 1.

---

## Codex TOML block splice

Codex stores its config in `~/.codex/config.toml`, a 380+ line file with comments, sections unrelated to MCP, and nested tables like `[mcp_servers.<name>.tools.<tool>]`. Reserialising the whole document would destroy all that context.

Instead, skdd uses a **text-level block splice**:

1. Each managed `[mcp_servers.<name>]` block is located by scanning for the header line, then finding its extent (all following lines up to the next `[`-header at column 0, including any nested sub-tables).
2. Managed blocks are replaced or deleted in place; new managed blocks are appended at the end of file.
3. The spliced document is **re-parsed with smol-toml** before writing. If the result is not valid TOML, the write is aborted and the original file is left unchanged.

This means comments outside managed blocks survive byte-for-byte across add/update/remove cycles.

---

## Backup and atomic writes

**Before the first write** in any sync run, the target host file is copied to `<file>.bak` (rolling — one backup per host per sync run). Subsequent writes in the same run reuse the backup taken at the start.

All writes are **atomic**: skdd writes to a temp file in the same directory (`.tmp-<pid>-<random>`), then renames it over the target. On POSIX and NTFS, same-volume renames are atomic — the host file is never in a partially-written state.

---

## Secrets never round-trip

The canonical `~/.skdd/mcp.json` file **never receives resolved secret values**. Placeholders like `${MY_API_KEY}` are expanded from `process.env` at write time into host files and nowhere else. The `read()` path of each adapter extracts only server names and enabled/disabled state — it never copies host-file values back into the canonical config.

---

## Managed-server tracking

After each successful `skdd mcp sync`, the managed server names for each host are recorded in `~/.skdd/.skdd-sync.json` under the `mcp.hosts` map:

```jsonc
{
  "version": 2,
  "mirrors": { /* ... */ },
  "mcp": {
    "hosts": {
      "claude-code": { "managed": ["my-tool", "remote-service"], "lastSync": "2026-06-12T..." },
      "droid":       { "managed": ["my-tool"],                   "lastSync": "2026-06-12T..." }
    }
  }
}
```

This record is what makes removal safe: when you run `skdd mcp remove my-tool && skdd mcp sync`, the CLI knows `my-tool` was previously managed on `claude-code` and generates a remove operation for it. Entries not in the managed list are never removed, even if they happen to share a name.

---

## Dry run

```bash
skdd mcp sync --dry-run
```

`--dry-run` runs the full plan phase for every available host — reading each host config, computing adds/updates/removes — and prints the plan without writing anything. No `.bak` files are created. No sync state is updated.

Second-run no-op: when a host's content is already byte-identical to what skdd would write, the plan for that server on that host shows zero operations and no file is written. The managed-state file is also not rewritten in this case.

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All reachable hosts synced successfully (or nothing to do) |
| `1` | One or more hosts blocked (malformed config or parse error). Other hosts were synced. Check stderr for details. |

---

## See also

- [`docs/global-colony.md`](global-colony.md) — the `~/.skdd/` colony layout and `--global` commands
- [`docs/integrations/droid.md`](integrations/droid.md) — Factory Droid MCP config file details
- [`docs/configuration.md`](configuration.md) — per-harness project setup
