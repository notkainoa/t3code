import path from "node:path";
import { spawnSync } from "node:child_process";

export function preferRealGitOnPathForTests(): void {
  process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  const result = spawnSync("git", ["ai", "git-path"], { encoding: "utf8" });
  if (result.status !== 0) {
    return;
  }

  const gitPath = result.stdout.trim();
  if (gitPath.length === 0) {
    return;
  }

  const gitDir = path.dirname(gitPath);
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0 && entry !== gitDir);

  process.env.PATH = [gitDir, ...pathEntries].join(path.delimiter);
}
