import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../lib/logger.js";
import { verifyProofReceipt } from "../lib/proof.js";

export interface ProofVerifyOptions {
  cwd?: string;
  skill?: string;
  json?: boolean;
}

export async function runProofVerify(receiptPath: string, opts: ProofVerifyOptions = {}) {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const receiptFile = resolve(cwd, receiptPath);
  if (!existsSync(receiptFile)) {
    logger.error(`Receipt not found: ${receiptPath}`);
    return 2;
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(receiptFile, "utf8"));
  } catch (error) {
    logger.error(`Could not parse receipt: ${(error as Error).message}`);
    return 2;
  }

  let skillContent: Buffer | undefined;
  if (opts.skill) {
    const skillFile = resolve(cwd, opts.skill);
    if (!existsSync(skillFile)) {
      logger.error(`Skill not found: ${opts.skill}`);
      return 2;
    }
    skillContent = readFileSync(skillFile);
  }

  const result = verifyProofReceipt(value, skillContent);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }

  if (result.valid) logger.success("proof receipt verified");
  else logger.error("proof receipt refused");
  for (const finding of result.findings) {
    logger.error(`${finding.code}: ${finding.message}`);
  }
  for (const warning of result.warnings) {
    logger.warn(`${warning.code}: ${warning.message}`);
  }
  return result.valid ? 0 : 1;
}
