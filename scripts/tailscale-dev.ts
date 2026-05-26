#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB_PORT = Number(process.env.T3CODE_TAILSCALE_WEB_PORT ?? "5734");
const SERVER_PORT = Number(process.env.T3CODE_TAILSCALE_SERVER_PORT ?? "13774");
const PAIRING_TTL = process.env.T3CODE_TAILSCALE_PAIRING_TTL ?? "30m";
const T3CODE_HOME = process.env.T3CODE_HOME ?? path.join(process.env.HOME ?? ".", ".t3");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "apps/server");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const RUN_STATE_DIR = path.join(tmpdir(), "t3code-tail");
const RUN_STATE_PATH = path.join(
  RUN_STATE_DIR,
  `${createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 16)}.json`,
);

let shuttingDown = false;
const children = new Set<ChildProcess>();

type RunState = {
  readonly repoRoot: string;
  readonly pid: number;
  readonly childPids: readonly number[];
  readonly startedAt: string;
};

function log(message: string) {
  process.stdout.write(`[tailscale-dev] ${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`[tailscale-dev] ${message}\n`);
  process.exit(1);
}

function run(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly quiet?: boolean;
  } = {},
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const suffix = stderr ? `\n${stderr}` : "";
    fail(`Command failed: ${command} ${args.join(" ")}${suffix}`);
  }

  return result.stdout ?? "";
}

function runQuiet(command: string, args: readonly string[], cwd = REPO_ROOT) {
  return run(command, args, { cwd, quiet: true }).trim();
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRunState(): RunState | undefined {
  if (!existsSync(RUN_STATE_PATH)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(RUN_STATE_PATH, "utf8")) as Partial<RunState>;
    if (
      parsed.repoRoot === REPO_ROOT &&
      typeof parsed.pid === "number" &&
      Array.isArray(parsed.childPids)
    ) {
      return {
        repoRoot: parsed.repoRoot,
        pid: parsed.pid,
        childPids: parsed.childPids.filter((pid): pid is number => typeof pid === "number"),
        startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      };
    }
  } catch {
    // Ignore unreadable stale state files.
  }

  return undefined;
}

function writeRunState() {
  mkdirSync(RUN_STATE_DIR, { recursive: true });
  writeFileSync(
    RUN_STATE_PATH,
    JSON.stringify(
      {
        repoRoot: REPO_ROOT,
        pid: process.pid,
        childPids: [...children]
          .map((child) => child.pid)
          .filter((pid): pid is number => typeof pid === "number"),
        startedAt: new Date().toISOString(),
      } satisfies RunState,
      null,
      2,
    ),
  );
}

function removeRunState() {
  try {
    const currentState = readRunState();
    if (currentState?.pid === process.pid) {
      rmSync(RUN_STATE_PATH, { force: true });
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function stopPid(pid: number, label: string) {
  if (pid === process.pid || !isProcessRunning(pid)) {
    return;
  }

  const command = processCommand(pid);
  log(`Stopping previous ${label} pid=${pid}${command ? ` command=${command}` : ""}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

function stopPreviousRunForRepo() {
  const state = readRunState();
  if (!state) {
    return;
  }

  const trackedPids = new Set([state.pid, ...state.childPids]);
  if ([...trackedPids].every((pid) => !isProcessRunning(pid))) {
    rmSync(RUN_STATE_PATH, { force: true });
    return;
  }

  log(`Replacing previous Tailscale dev server for ${REPO_ROOT}`);
  for (const pid of state.childPids) {
    stopPid(pid, "child");
  }
  stopPid(state.pid, "runner");

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ([...trackedPids].every((pid) => !isProcessRunning(pid))) {
      rmSync(RUN_STATE_PATH, { force: true });
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  for (const pid of trackedPids) {
    if (pid === process.pid || !isProcessRunning(pid)) {
      continue;
    }
    log(`Force stopping previous run pid=${pid}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }

  rmSync(RUN_STATE_PATH, { force: true });
}

function readTailscaleIp() {
  const output = runQuiet("tailscale", ["ip", "-4"]);
  const ip = output
    .split(/\s+/)
    .map((value) => value.trim())
    .find(Boolean);
  if (!ip) {
    fail("Could not determine a Tailscale IPv4 address with `tailscale ip -4`.");
  }
  return ip;
}

function processCommand(pid: number) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
}

function parseListeningPids(port: number) {
  const output = runQuiet("ss", ["-ltnp"]);
  const pids = new Set<number>();
  for (const line of output.split("\n")) {
    if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) {
      continue;
    }
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      pids.add(Number(match[1]));
    }
  }
  return [...pids];
}

function stopDefaultPortListeners() {
  const pids = new Set([...parseListeningPids(WEB_PORT), ...parseListeningPids(SERVER_PORT)]);
  if (pids.size === 0) {
    return;
  }

  for (const pid of pids) {
    const command = processCommand(pid);
    log(`Stopping existing listener pid=${pid} command=${command}`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const remaining = [...parseListeningPids(WEB_PORT), ...parseListeningPids(SERVER_PORT)];
    if (remaining.length === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  for (const pid of new Set([
    ...parseListeningPids(WEB_PORT),
    ...parseListeningPids(SERVER_PORT),
  ])) {
    log(`Force stopping existing listener pid=${pid}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function startChild(
  name: string,
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  },
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  writeRunState();

  const prefix = `[${name}] `;
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) process.stdout.write(`${prefix}${line}\n`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) process.stderr.write(`${prefix}${line}\n`);
    }
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    writeRunState();
    if (shuttingDown && children.size === 0) {
      process.exit(0);
    }
    if (!shuttingDown) {
      shutdown(`${name} exited (${signal ?? code ?? "unknown"})`, code ?? 1);
    }
  });

  return child;
}

function waitForUrl(url: string, description: string) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const args = ["-fsS", "--max-time", "10"];
    if (description.includes("web UI")) {
      args.push("-I");
    }
    args.push(url);
    const result = spawnSync("curl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return;
    }
    lastError = result.stderr?.trim() || result.stdout?.trim() || `curl exited ${result.status}`;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  fail(`Timed out waiting for ${description}: ${String(lastError)}`);
}

function createPairingToken(tailscaleIp: string) {
  const output = runQuiet("node", [
    "apps/server/src/bin.ts",
    "auth",
    "pairing",
    "create",
    "--base-dir",
    T3CODE_HOME,
    "--dev-url",
    `http://${tailscaleIp}:${WEB_PORT}`,
    "--base-url",
    `http://${tailscaleIp}:${WEB_PORT}`,
    "--ttl",
    PAIRING_TTL,
    "--json",
  ]);
  return JSON.parse(output) as {
    readonly credential: string;
    readonly expiresAt: string;
    readonly pairUrl: string;
  };
}

function shutdown(reason: string, exitCode = 0) {
  shuttingDown = true;
  log(reason);
  removeRunState();
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already exited.
    }
  }
  if (children.size === 0) {
    process.exit(exitCode);
  }
  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already exited.
      }
    }
    process.exit(exitCode);
  }, 1_000).unref();
}

async function main() {
  stopPreviousRunForRepo();
  writeRunState();

  const tailscaleIp = readTailscaleIp();
  const webUrl = `http://${tailscaleIp}:${WEB_PORT}`;
  const backendUrl = `http://${tailscaleIp}:${SERVER_PORT}`;

  log(`Tailscale IP: ${tailscaleIp}`);
  stopDefaultPortListeners();

  const webEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: webUrl,
    VITE_HTTP_URL: backendUrl,
    VITE_WS_URL: `ws://${tailscaleIp}:${SERVER_PORT}`,
  };
  log("Building web bundle for Tailscale URLs...");
  run("bun", ["run", "--cwd", "apps/web", "build"], { env: webEnv });

  const serverEnv = {
    ...process.env,
    T3CODE_HOME,
    T3CODE_MODE: "web",
    T3CODE_HOST: "0.0.0.0",
    T3CODE_PORT: String(SERVER_PORT),
    VITE_DEV_SERVER_URL: webUrl,
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "1",
  };

  startChild("server", "node", ["--watch", "src/bin.ts"], {
    cwd: SERVER_DIR,
    env: serverEnv,
  });
  startChild(
    "web",
    "bunx",
    ["vite", "preview", "--host", "0.0.0.0", "--port", String(WEB_PORT), "--strictPort"],
    {
      cwd: WEB_DIR,
      env: webEnv,
    },
  );

  waitForUrl(webUrl, "web UI over Tailscale");
  waitForUrl(`${backendUrl}/api/auth/session`, "backend over Tailscale");

  const pairing = createPairingToken(tailscaleIp);
  process.stdout.write(`
T3 Code is running over Tailscale.

Open:
${webUrl}

Pairing link:
${pairing.pairUrl}

Pair code:
${pairing.credential}

Expires:
${pairing.expiresAt}

Press Ctrl-C to stop the server.
`);
}

process.on("SIGINT", () => shutdown("Received SIGINT. Stopping Tailscale dev server."));
process.on("SIGTERM", () => shutdown("Received SIGTERM. Stopping Tailscale dev server."));

main().catch((error: unknown) => {
  shutdown(error instanceof Error ? error.message : String(error), 1);
});
