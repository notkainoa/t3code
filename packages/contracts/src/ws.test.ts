import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { GIT_PR_CREATE_COMPARE_FALLBACK_ERROR_CODE } from "./git";
import { ORCHESTRATION_WS_METHODS } from "./orchestration";
import { WebSocketRequest, WebSocketResponse } from "./ws";

const decodeWebSocketRequest = Schema.decodeUnknownEffect(WebSocketRequest);
const decodeWebSocketResponse = Schema.decodeUnknownEffect(WebSocketResponse);

it.effect("accepts getTurnDiff requests when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
      },
    });
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
  }),
);

it.effect("rejects getTurnDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWebSocketRequest({
        id: "req-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
          threadId: "thread-1",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims websocket request id and nested orchestration ids", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: " req-1 ",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: " thread-1 ",
        fromTurnCount: 0,
        toTurnCount: 0,
      },
    });
    assert.strictEqual(parsed.id, "req-1");
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
      assert.strictEqual(parsed.body.threadId, "thread-1");
    }
  }),
);

it.effect("accepts websocket responses with structured error metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketResponse({
      id: "req-1",
      error: {
        message: "GitHub CLI failed in execute: GraphQL: Head sha can't be blank",
        code: GIT_PR_CREATE_COMPARE_FALLBACK_ERROR_CODE,
        data: {
          compareUrl:
            "https://github.com/pingdotgg/t3code/compare/main...notkainoa:feature%2Frename-open-pr-label?quick_pull=1",
          baseBranch: "main",
          headBranch: "feature/rename-open-pr-label",
          baseRepo: "pingdotgg/t3code",
          headRepoOwner: "notkainoa",
        },
      },
    });
    assert.strictEqual(parsed.error?.code, GIT_PR_CREATE_COMPARE_FALLBACK_ERROR_CODE);
    assert.deepStrictEqual(parsed.error?.data, {
      compareUrl:
        "https://github.com/pingdotgg/t3code/compare/main...notkainoa:feature%2Frename-open-pr-label?quick_pull=1",
      baseBranch: "main",
      headBranch: "feature/rename-open-pr-label",
      baseRepo: "pingdotgg/t3code",
      headRepoOwner: "notkainoa",
    });
  }),
);
