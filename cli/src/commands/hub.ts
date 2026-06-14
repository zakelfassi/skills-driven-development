import { resolve } from "node:path";

export interface HubOptions {
  cwd?: string;
}

export async function runHub(opts: HubOptions = {}): Promise<number> {
  if (!process.stdout.isTTY) {
    process.stderr.write("skdd hub requires an interactive terminal\n");
    return 1;
  }
  const { renderHub } = await import("../hub/app.js");
  const cwd = resolve(opts.cwd ?? process.cwd());
  return renderHub(cwd);
}
