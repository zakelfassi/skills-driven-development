/**
 * Parse an array of "KEY=VALUE" strings into a Record<string, string>.
 *
 * Each entry is split on the FIRST `=` only, so values may contain `=` or `,`
 * (e.g., multi-value Accept headers, Base64 tokens, cookie strings, PATH-like
 * env values, etc.).
 *
 * Keys are trimmed of surrounding whitespace; values are preserved as-is.
 * An entry with no `=` maps to an empty-string value.
 *
 * Intended use: parse the collected values from a repeatable CLI option such as
 * `--headers KEY=VALUE` or `--env KEY=VALUE`, where Commander accumulates each
 * flag occurrence into a string[].
 */
export function parseKvPairs(pairs: string[]): Record<string, string> {
  return Object.fromEntries(
    pairs.map((pair) => {
      const idx = pair.indexOf("=");
      return idx === -1 ? [pair.trim(), ""] : [pair.slice(0, idx).trim(), pair.slice(idx + 1)];
    }),
  );
}
