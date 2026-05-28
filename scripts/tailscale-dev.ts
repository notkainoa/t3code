#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as NodeNet from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_PORT = 65_535;
const PREFERRED_WEB_PORT = readPreferredPort("T3CODE_TAILSCALE_WEB_PORT", 5_734);
const PREFERRED_SERVER_PORT = readPreferredPort("T3CODE_TAILSCALE_SERVER_PORT", 13_774);
const PORT_PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::1", "::"] as const;
const PAIRING_TTL = process.env.T3CODE_TAILSCALE_PAIRING_TTL ?? "30m";
const WEB_MODE =
  process.env.T3CODE_TAILSCALE_WEB_MODE?.trim().toLowerCase() === "preview" ? "preview" : "dev";
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

function readPreferredPort(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const port = raw ? Number(raw) : fallback;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    fail(`${name} must be an integer port between 1 and ${MAX_PORT}. Received: ${raw ?? port}`);
  }
  return port;
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

function removeStaleRunStateForRepo() {
  const state = readRunState();
  if (!state) {
    return;
  }

  const trackedPids = new Set([state.pid, ...state.childPids]);
  if ([...trackedPids].every((pid) => !isProcessRunning(pid))) {
    rmSync(RUN_STATE_PATH, { force: true });
  }
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

function isErrnoExceptionWithCode(cause: unknown): cause is { readonly code: string } {
  return (
    typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
  );
}

function canListenOnHost(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const server = NodeNet.createServer();
    let settled = false;

    const settle = (available: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(available);
    };

    server.unref();
    server.once("error", (cause) => {
      if (isErrnoExceptionWithCode(cause) && cause.code === "EADDRNOTAVAIL") {
        settle(true);
        return;
      }
      settle(false);
    });
    server.once("listening", () => {
      server.close(() => settle(true));
    });
    try {
      server.listen({ host, port });
    } catch {
      settle(false);
    }
  });
}

async function isPortAvailable(port: number) {
  for (const host of PORT_PROBE_HOSTS) {
    if (!(await canListenOnHost(port, host))) {
      return false;
    }
  }
  return true;
}

async function findAvailableTailPorts() {
  for (let offset = 0; ; offset += 1) {
    const webPort = PREFERRED_WEB_PORT + offset;
    const serverPort = PREFERRED_SERVER_PORT + offset;
    if (webPort > MAX_PORT || serverPort > MAX_PORT) {
      break;
    }

    const [webAvailable, serverAvailable] = await Promise.all([
      isPortAvailable(webPort),
      isPortAvailable(serverPort),
    ]);
    if (webAvailable && serverAvailable) {
      return { webPort, serverPort };
    }
  }

  fail(
    `No available Tailscale dev port pair found from web=${PREFERRED_WEB_PORT} server=${PREFERRED_SERVER_PORT}`,
  );
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

function createPairingToken(tailscaleIp: string, webPort: number) {
  const output = runQuiet("node", [
    "apps/server/src/bin.ts",
    "auth",
    "pairing",
    "create",
    "--base-dir",
    T3CODE_HOME,
    "--dev-url",
    `http://${tailscaleIp}:${webPort}`,
    "--base-url",
    `http://${tailscaleIp}:${webPort}`,
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
  removeStaleRunStateForRepo();
  writeRunState();

  const tailscaleIp = readTailscaleIp();
  const { webPort, serverPort } = await findAvailableTailPorts();
  const webUrl = `http://${tailscaleIp}:${webPort}`;
  const backendUrl = `http://${tailscaleIp}:${serverPort}`;

  log(`Tailscale IP: ${tailscaleIp}`);
  log(`Selected ports: web=${webPort} server=${serverPort}`);

  const webEnv = {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: String(webPort),
    VITE_DEV_PROXY_TARGET: backendUrl,
    VITE_DEV_SERVER_URL: webUrl,
    VITE_HMR_CLIENT_PORT: String(webPort),
    VITE_HMR_HOST: tailscaleIp,
    VITE_HTTP_URL: webUrl,
    VITE_WS_URL: `ws://${tailscaleIp}:${webPort}`,
  };
  if (WEB_MODE === "preview") {
    log("Building web bundle for Tailscale URLs...");
    run("bun", ["run", "--cwd", "apps/web", "build"], { env: webEnv });
  } else {
    log("Starting Vite dev server with HMR over Tailscale...");
  }

  const serverEnv = {
    ...process.env,
    T3CODE_HOME,
    T3CODE_MODE: "web",
    T3CODE_HOST: "0.0.0.0",
    T3CODE_PORT: String(serverPort),
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
    [
      "vite",
      ...(WEB_MODE === "preview" ? ["preview"] : []),
      "--host",
      "0.0.0.0",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: WEB_DIR,
      env: webEnv,
    },
  );

  waitForUrl(webUrl, "web UI over Tailscale");
  waitForUrl(`${backendUrl}/api/auth/session`, "backend over Tailscale");

  const pairing = createPairingToken(tailscaleIp, webPort);
  process.stdout.write(`
T3 Code is running over Tailscale.

Open:
${webUrl}

Web mode:
${WEB_MODE}${WEB_MODE === "dev" ? " (hot reload enabled)" : " (production preview, no hot reload)"}

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
