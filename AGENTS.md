# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Running The App

- The easiest full-stack dev command is `npm run tail`. It starts the server on `0.0.0.0:13774`, starts the Vite web dev server on `0.0.0.0:5734`, and prints a Tailscale URL plus a pairing link/code.
- Use the printed `http://<tailscale-ip>:5734` URL when testing from a browser. The web server proxies API and WebSocket traffic to the backend, so browser requests should stay same-origin on `:5734`.
- `npm run tail` runs Vite dev mode by default, so frontend hot reload should work over Tailscale. If you need a production-like static preview, run `T3CODE_TAILSCALE_WEB_MODE=preview npm run tail`; that mode builds the web bundle and uses `vite preview`, so it intentionally has no hot reload.
- If the screen is blank when using `npm run tail`, check the browser console/network tab for CORS errors on `/api/auth/session`. A common failure is the web app calling `http://<tailscale-ip>:13774/api/auth/session` directly from origin `http://<tailscale-ip>:5734`; credentialed fetches cannot use `Access-Control-Allow-Origin: *`, so bootstrap fails before the UI renders.
- For this tail setup, `VITE_HTTP_URL` and `VITE_WS_URL` should point at the web origin on `:5734`, `VITE_DEV_PROXY_TARGET` should point at the backend on `:13774`, and `VITE_HMR_HOST` should be the Tailscale IP. Do not “fix” blank-screen CORS by pointing the browser directly at the backend port unless you also change the server CORS policy correctly.
- Stop `npm run tail` with Ctrl-C when finished, and verify no old listeners are left with `ss -ltnp | rg ':5734|:13774' || true` before starting another tail run.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
