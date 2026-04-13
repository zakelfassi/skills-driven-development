import pc from "picocolors";

export type LogLevel = "info" | "success" | "warn" | "error" | "debug";

const isDebug = process.env.SKDD_DEBUG === "1" || process.env.DEBUG?.includes("skdd");

export const logger = {
  info(message: string): void {
    console.log(message);
  },
  success(message: string): void {
    console.log(`${pc.green("✓")} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${pc.yellow("!")} ${message}`);
  },
  error(message: string): void {
    console.error(`${pc.red("✗")} ${message}`);
  },
  dim(message: string): void {
    console.log(pc.dim(message));
  },
  heading(message: string): void {
    console.log(`\n${pc.bold(message)}`);
  },
  debug(message: string): void {
    if (isDebug) console.error(pc.gray(`[skdd] ${message}`));
  },
};

export { pc };
