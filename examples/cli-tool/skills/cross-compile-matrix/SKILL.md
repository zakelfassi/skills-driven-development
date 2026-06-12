---
name: cross-compile-matrix
description: Add a new target triple to the shipctl cross-platform build matrix — CI YAML, Makefile, and a smoke test. Use when adding support for a new OS/architecture, when a user requests a new platform binary, or when a target triple is missing from the release artifacts.
metadata:
  forged-by: claude-agent
  forged-from: session-2026-03-11
  forged-reason: "Added aarch64-unknown-linux-musl, x86_64-pc-windows-gnu, and arm-unknown-linux-gnueabihf in three consecutive sessions with identical steps — encoded the pattern"
  usage-count: "7"
  last-used: "2026-05-18"
---

# Cross-Compile Matrix

Add a new target triple to the build matrix so CI produces a binary for the new platform.

## Inputs
- Target triple (e.g., `aarch64-apple-darwin`, `x86_64-pc-windows-gnu`)
- Cross-compiler image (Docker image or `native` if the runner natively supports the target)
- Smoke test command (a simple invocation to verify the binary works, e.g., `shipctl --version`)

## Steps

1. **Verify the triple is valid**
   ```bash
   rustup target list | grep {triple}
   ```
   For Go: check `go tool dist list | grep {os}/{arch}`.

2. **Add the target to the CI matrix**
   Edit `.github/workflows/release.yml` — add the triple to the `matrix.target` array:
   ```yaml
   strategy:
     matrix:
       include:
         - target: {triple}
           runner: ubuntu-latest      # or macos-latest, windows-latest
           cross: true                # false if runner supports the target natively
           image: ghcr.io/cross-rs/{triple}:latest  # omit if cross: false
   ```

3. **Add the Makefile target**
   ```makefile
   build-{safe-triple}:
   	cargo build --release --target {triple}
   	mkdir -p dist
   	cp target/{triple}/release/shipctl dist/shipctl-{triple}
   ```
   `{safe-triple}` replaces `-` with `_` in Make target names.

4. **Register the rustup target** (Rust only)
   ```bash
   rustup target add {triple}
   ```
   For CI: add to the `rustup target add` step in the workflow.

5. **Add a smoke test step** in the workflow:
   ```yaml
   - name: Smoke test ({triple})
     run: ./dist/shipctl-{triple} --version
     if: matrix.target == '{triple}'
   ```
   If cross-testing is not feasible (e.g., Windows binary on a Linux runner), document this in a comment.

6. **Test locally** (if the host supports the target)
   ```bash
   make build-{safe-triple}
   ./dist/shipctl-{triple} --version
   ```

7. **Update the release notes template**
   Add a row to `docs/install.md`:
   ```markdown
   | {OS} | {Arch} | `{triple}` | `shipctl-{version}-{triple}.tar.gz` |
   ```

## Conventions
- Target naming in artifacts: `shipctl-{version}-{triple}.tar.gz`
- Windows targets produce `.exe` and are archived as `.zip` instead of `.tar.gz`
- `musl` targets are preferred for Linux binaries to avoid glibc dependency issues
- All targets are smoke-tested in CI before a release is published

## Edge Cases
- **Cross-compilation fails with linker errors:** Switch to the `cross-rs` Docker image for that triple; add the `image:` field in the matrix.
- **Target is tier 3 (Rust):** Add a comment noting reduced support guarantees; test manually before each release.
- **macOS arm64 on amd64 runner:** Use `--target aarch64-apple-darwin` with Rosetta or a self-hosted arm64 runner; document in the workflow.
- **Windows MSVC vs GNU:** Prefer `x86_64-pc-windows-msvc` for best compatibility; GNU works but requires MinGW on the runner.
