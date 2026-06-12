/**
 * WebSocket Relay Reliability — mid-turn disconnect scenarios
 *
 * This harness verifies that WebSocket message delivery and session state
 * recovery work correctly when the connection drops mid-turn.
 *
 * Key behaviors under test:
 *
 * 1. A live subscription that loses its socket retries indefinitely (transport
 *    error) rather than stopping (application error).
 * 2. When a socket closes mid-stream, the subscriber picks up a fresh stream
 *    on reconnect via the onResubscribe hook — enabling snapshot replay.
 * 3. Events emitted while the client is disconnected are NOT lost: the
 *    subscribe/snapshot+live-stream pattern means a reconnecting client issues
 *    a new stream request and receives a full replay from the server.
 * 4. A unary request that was in-flight when the socket closed never resolves
 *    on the old session; the transport surfaces a rejection so callers can retry.
 * 5. Back-to-back reconnects (double-disconnect) produce only one active
 *    socket at a time and do not ghost stale streams.
 * 6. Cancelling a subscription while the socket is down prevents the subscriber
 *    loop from re-opening a new stream after the socket comes back.
 */

import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWsConnectionStatus,
  getWsConnectionUiState,
  resetWsConnectionStateForTests,
} from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WsEventType = "open" | "message" | "close" | "error";
type WsEvent = { code?: number; data?: unknown; reason?: string; type?: string };
type WsListener = (event?: WsEvent) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const set = this.listeners.get(type) ?? new Set<WsListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason, type: "close" });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  serverMessage(data: unknown) {
    this.emit("message", { data, type: "message" });
  }

  serverError() {
    this.emit("error", { type: "error" });
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const originalWebSocket = globalThis.WebSocket;
const transports: WsTransport[] = [];

function getSocket(index = -1): MockWebSocket {
  const socket = index === -1 ? sockets.at(-1) : sockets[index];
  if (!socket) throw new Error(`Expected websocket at index ${index}`);
  return socket;
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

function createTransport(...args: ConstructorParameters<typeof WsTransport>): WsTransport {
  const transport = new WsTransport(...args);
  transports.push(transport);
  return transport;
}

function makeWelcomeChunk(requestId: string, label: string) {
  return JSON.stringify({
    _tag: "Chunk",
    requestId,
    values: [
      {
        version: 1,
        sequence: 1,
        type: "welcome",
        payload: {
          environment: {
            environmentId: "environment-local",
            label,
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          },
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      },
    ],
  });
}

function makeSuccessExit(requestId: string) {
  return JSON.stringify({
    _tag: "Exit",
    requestId,
    exit: { _tag: "Success", value: null },
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useRealTimers();
  sockets.length = 0;
  transports.length = 0;
  resetWsConnectionStateForTests();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:3020",
        hostname: "localhost",
        port: "3020",
        protocol: "http:",
      },
      desktopBridge: undefined,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(async () => {
  await Promise.allSettled(transports.map((t) => t.dispose()));
  transports.length = 0;
  globalThis.WebSocket = originalWebSocket;
  resetWsConnectionStateForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket relay reliability — mid-turn disconnect", () => {
  it("retries stream subscriptions indefinitely after a socket-level transport close", async () => {
    // Scenario: client subscribes to a live stream; the socket closes mid-stream
    // with a transport error (code 1006). The subscriber must retry rather than give up.
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    let attempts = 0;

    const unsubscribe = transport.subscribe(
      () =>
        Stream.suspend(() => {
          attempts += 1;
          // Simulate an abnormal close (no clean server Exit frame — transport gone).
          return Stream.fail(new Error("SocketCloseError: connection lost mid-turn"));
        }),
      listener,
      { retryDelay: 20 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    getSocket().open();

    await waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2));
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    await transport.dispose();
  });

  it("does NOT retry after an application-level error mid-turn", async () => {
    // Scenario: the server returns a structured error (not a transport close).
    // The subscriber must not keep retrying — the error is terminal.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transport = createTransport("ws://localhost:3020");
    let attempts = 0;

    const unsubscribe = transport.subscribe(
      () =>
        Stream.suspend(() => {
          attempts += 1;
          return Stream.fail(new Error("OrchestrationGetSnapshotError: thread not found"));
        }),
      vi.fn(),
      { retryDelay: 20 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    getSocket().open();

    await waitFor(() => expect(attempts).toBe(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    // Exactly one attempt — not retried.
    expect(attempts).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "WebSocket RPC subscription failed",
      expect.objectContaining({ error: expect.stringContaining("OrchestrationGetSnapshotError") }),
    );

    unsubscribe();
    await transport.dispose();
  });

  it("fires onResubscribe and re-issues stream request after mid-turn socket close", async () => {
    // Scenario: client is mid-stream (received at least one event) then the socket
    // closes. The subscriber loop detects the transport error, waits retryDelay, and
    // opens a new stream on the same session — calling onResubscribe so the caller
    // can reset its snapshot gate before consuming the replay.
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    const onResubscribe = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { onResubscribe, retryDelay: 30 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => expect(socket.sent).toHaveLength(1));

    // Server sends first chunk — subscriber marks hasReceivedValue = true.
    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(makeWelcomeChunk(firstRequest.id, "before-disconnect"));

    await waitFor(() => expect(listener).toHaveBeenCalledOnce());

    // Socket closes mid-turn with abnormal code (transport error).
    socket.close(1006, "network interruption mid-turn");

    // The subscriber loop should re-issue a stream request on the same session.
    await waitFor(
      () => {
        const allRequests = socket.sent.map((m) => JSON.parse(m) as { _tag?: string; id?: string });
        const resubRequests = allRequests.filter(
          (r) => r._tag === "Request" && r.id !== firstRequest.id,
        );
        expect(resubRequests).toHaveLength(1);
      },
      3_000,
    );

    expect(onResubscribe).toHaveBeenCalledOnce();

    const secondRequest = socket.sent
      .map((m) => JSON.parse(m) as { _tag?: string; id?: string; tag?: string })
      .find((r): r is { _tag: string; id: string; tag: string } => r._tag === "Request" && r.id !== firstRequest.id);

    if (!secondRequest) throw new Error("Expected a resubscribe request");

    // Server sends events on the new stream — client receives them normally.
    socket.serverMessage(makeWelcomeChunk(secondRequest.id, "after-reconnect"));

    await waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });

    unsubscribe();
    await transport.dispose();
  });

  it("messages emitted server-side during disconnect are available on re-subscribe via snapshot replay", async () => {
    // Scenario: server continues emitting events into the orchestration log while
    // the client is disconnected. On reconnect the client issues a new subscribeThread
    // stream request. The server responds with a snapshot (all events since turn start)
    // followed by live events. The client receives both batches in order.
    //
    // This test simulates that sequence by verifying the subscriber receives events
    // from both the initial stream AND a second stream opened after disconnect.
    const transport = createTransport("ws://localhost:3020");
    const received: unknown[] = [];

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      (value) => received.push(value),
      { retryDelay: 20 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => expect(socket.sent).toHaveLength(1));

    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };

    // Event 1: before disconnect
    const event1 = {
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "first-event",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/a",
        projectName: "a",
      },
    };
    socket.serverMessage(
      JSON.stringify({ _tag: "Chunk", requestId: firstRequest.id, values: [event1] }),
    );

    await waitFor(() => expect(received).toHaveLength(1));

    // Simulate disconnect. Server-side the turn continues and emits event2, event3.
    // The client won't receive those until it reconnects and replays.
    socket.close(1006, "transient network failure");

    // Wait for subscriber to re-issue a stream request.
    await waitFor(() => {
      const resubRequests = socket.sent
        .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
        .filter((r) => r._tag === "Request" && r.id !== firstRequest.id);
      expect(resubRequests).toHaveLength(1);
    }, 3_000);

    const secondRequest = socket.sent
      .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
      .find((r): r is { _tag: string; id: string } => r._tag === "Request" && r.id !== firstRequest.id);

    if (!secondRequest) throw new Error("Expected a second stream request");

    // Server responds with snapshot: includes event1 (replay) + event2 (missed)
    // + event3 (new) — all three values in the new stream.
    const event2 = {
      version: 1,
      sequence: 2,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "missed-during-disconnect",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/b",
        projectName: "b",
      },
    };
    const event3 = {
      version: 1,
      sequence: 3,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "after-reconnect",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/c",
        projectName: "c",
      },
    };
    socket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: secondRequest.id,
        values: [event1, event2, event3],
      }),
    );

    await waitFor(() => expect(received).toHaveLength(4));

    // Caller is responsible for de-duplicating replayed events by sequence number;
    // the transport delivers everything the server sends.
    expect((received[0] as { payload: { environment: { label: string } } }).payload.environment.label).toBe("first-event");
    expect((received[1] as { payload: { environment: { label: string } } }).payload.environment.label).toBe("first-event");
    expect((received[2] as { payload: { environment: { label: string } } }).payload.environment.label).toBe("missed-during-disconnect");
    expect((received[3] as { payload: { environment: { label: string } } }).payload.environment.label).toBe("after-reconnect");

    unsubscribe();
    await transport.dispose();
  });

  it("a unary request in-flight at disconnect is rejected and does not resolve on reconnect", async () => {
    // Scenario: client sends a dispatchCommand. Before the server replies,
    // the socket closes. The outstanding request promise must reject.
    // The caller is expected to surface an error and let the user retry.
    const transport = createTransport("ws://localhost:3020");

    const requestPromise = transport.request((client) =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: "terminal.toggle",
        key: "ctrl+k",
      }),
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => expect(socket.sent).toHaveLength(1));

    // Drop the socket before server sends an Exit frame.
    socket.close(1006, "connection lost before reply");

    await expect(requestPromise).rejects.toThrow();
    await transport.dispose();
  });

  it("cancelling a subscription while disconnected stops the subscriber from restarting", async () => {
    // Scenario: client subscribes, socket closes mid-turn. Before the retry delay
    // expires and a new stream is opened, the caller cancels the subscription.
    // No further stream requests should be sent after cancellation.
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { retryDelay: 200 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => expect(socket.sent).toHaveLength(1));

    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    // Receive a chunk so the subscriber has hasReceivedValue = true.
    socket.serverMessage(makeWelcomeChunk(firstRequest.id, "before-cancel"));
    await waitFor(() => expect(listener).toHaveBeenCalledOnce());

    // Socket closes — subscriber would normally retry after 200ms.
    socket.close(1006, "network failure");

    // Cancel immediately before the retry fires.
    unsubscribe();

    // Wait longer than retryDelay to confirm no new stream request is sent.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    const streamRequestsAfterFirst = socket.sent
      .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
      .filter((r) => r._tag === "Request" && r.id !== firstRequest.id);

    expect(streamRequestsAfterFirst).toHaveLength(0);
    await transport.dispose();
  });

  it("back-to-back socket closes produce one active stream at a time", async () => {
    // Scenario: network is flappy — two rapid closes happen before a stable
    // reconnect. Each time only one pending stream request should be active.
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { retryDelay: 30 },
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => expect(socket.sent).toHaveLength(1));

    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(makeWelcomeChunk(firstRequest.id, "before-flap"));
    await waitFor(() => expect(listener).toHaveBeenCalledOnce());

    // First close — subscriber will retry.
    socket.close(1006, "first close");

    await waitFor(() => {
      const resubRequests = socket.sent
        .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
        .filter((r) => r._tag === "Request" && r.id !== firstRequest.id);
      expect(resubRequests).toHaveLength(1);
    }, 2_000);

    const secondRequestId = socket.sent
      .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
      .find((r): r is { _tag: string; id: string } => r._tag === "Request" && r.id !== firstRequest.id)!.id;

    // Simulate the second stream also failing before receiving a value.
    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: secondRequestId,
        exit: { _tag: "Failure", cause: { _tag: "Fail", error: { message: "SocketCloseError: second close" } } },
      }),
    );

    // The subscriber treats this as a transport error and retries again.
    await waitFor(() => {
      const resubRequests = socket.sent
        .map((m) => JSON.parse(m) as { _tag?: string; id?: string })
        .filter((r) => r._tag === "Request" && r.id !== firstRequest.id && r.id !== secondRequestId);
      expect(resubRequests).toHaveLength(1);
    }, 3_000);

    unsubscribe();
    await transport.dispose();
  });

  it("connection state transitions through reconnecting and back to connected after mid-turn drop", async () => {
    // Verifies the UI-visible connection state reflects the disconnect correctly
    // so users see a reconnecting indicator rather than an error banner.
    const transport = createTransport("ws://localhost:3020");

    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(getWsConnectionStatus()).toMatchObject({
        hasConnected: true,
        phase: "connected",
      });
    });

    // Mid-turn drop.
    socket.close(1006, "mid-turn network drop");

    await waitFor(() => {
      expect(getWsConnectionStatus()).toMatchObject({
        hasConnected: true,
        phase: "disconnected",
      });
    });
    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe("reconnecting");

    // Simulate reconnect: a new socket is created (by the protocol layer),
    // then opened.
    await waitFor(() => expect(sockets).toHaveLength(2), 5_000);
    getSocket().open();

    await waitFor(() => {
      expect(getWsConnectionStatus()).toMatchObject({
        phase: "connected",
      });
    }, 5_000);
    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe("connected");

    await transport.dispose();
  });
});
