import { isStdio, type McpHostId, type McpServer } from "./schema.js";

/**
 * Determine whether a server is "intended" for a host when env expansion fails.
 *
 * Returns false (not intended) when:
 * - The server is excluded from this host by the hosts allowlist, OR
 * - The server is disabled AND this adapter omits disabled entries
 *   (omitsDisabled=true: claude-code, claude-desktop, cursor, gemini), OR
 * - The server is a remote server AND this adapter does not support remote
 *   servers (acceptsRemote=false: claude-desktop is stdio-only).
 *
 * When false, env-variable resolution is not required to determine the correct
 * host status — the adapter will omit or remove the entry regardless of env
 * values. Callers can then compute the real status (excluded / drift /
 * pending-removal) without requiring all placeholders to be set.
 *
 * When true, the server IS intended for this host and unresolved placeholders
 * are a genuine blocker → show `needs-env`.
 */
export function isIntendedForHost(
  server: McpServer,
  hostId: McpHostId,
  adapter: { omitsDisabled: boolean; acceptsRemote?: boolean },
): boolean {
  const hostExcluded = server.hosts != null && !server.hosts.includes(hostId);
  const disabledOnOmittingHost = server.disabled === true && adapter.omitsDisabled;
  const remoteOnNonRemoteHost = !isStdio(server) && !(adapter.acceptsRemote ?? true);
  return !hostExcluded && !disabledOnOmittingHost && !remoteOnNonRemoteHost;
}
