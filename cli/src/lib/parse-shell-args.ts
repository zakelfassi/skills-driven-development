/**
 * Shell-style argument tokenizer.
 *
 * Splits `input` into an array of tokens using the same rules a POSIX shell
 * would apply to a simple command line:
 *
 * - Tokens are separated by unquoted whitespace.
 * - Single-quoted segments ('…') are treated verbatim — no escape processing.
 * - Double-quoted segments ("…") strip the surrounding quotes; a backslash
 *   inside doubles escapes the next character.
 * - Unquoted tokens pass through as-is.
 *
 * Examples
 *   parseShellArgs('-y @pkg "/Users/me/My Project"')
 *   // => ['-y', '@pkg', '/Users/me/My Project']
 *
 *   parseShellArgs('-y @pkg')
 *   // => ['-y', '@pkg']
 */
export function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < input.length) {
        i++;
        current += input[i];
      } else {
        current += ch;
      }
    } else {
      if (ch === "'") {
        inSingle = true;
      } else if (ch === '"') {
        inDouble = true;
      } else if (ch === " " || ch === "\t") {
        if (current.length > 0) {
          args.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
