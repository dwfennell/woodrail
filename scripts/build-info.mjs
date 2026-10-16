// Facts about the build that need Node, kept out of vite.config.ts (which is type-checked without Node's types).
import { execSync } from "node:child_process";

/** The commit being built (short hash), or empty if git isn't there. */
export function gitShortHash() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

/** Set by the artifact build: no update check in that build. */
export function updateCheckOn() {
  return !process.env.WOODRAIL_NO_UPDATE_CHECK;
}
