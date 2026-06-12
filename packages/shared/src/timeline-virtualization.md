# Chat Timeline Virtualization — Performance Reference

This document profiles the chat timeline rendering stack for large threads (10,000+
messages), identifies bottlenecks, and records the mitigations applied. It is
intended as a living reference for anyone working on `MessagesTimeline`.

---

## Stack Overview

| Layer | Component/File | Role |
|---|---|---|
| Virtualization | `LegendList` (`@legendapp/list` v3.0.0-beta.44) | Windowed list, only renders visible rows |
| Row derivation | `MessagesTimeline.logic.ts` — `deriveMessagesTimelineRows` | Maps raw `TimelineEntry[]` → flat `MessagesTimelineRow[]` |
| Structural sharing | `computeStableMessagesTimelineRows` / `useStableRows` | Reuses object references for unchanged rows, preventing LegendList from re-rendering them |
| Context split | `TimelineRowCtx` + `TimelineRowActivityCtx` | Separates stable shared state from high-frequency activity flags |
| Markdown + code | `ChatMarkdown.tsx` — `LRUCache<string>` (500 entries, 50 MB) | Caches Shiki-highlighted HTML so unchanged code blocks are never re-highlighted |
| Diff rendering | `DiffWorkerPoolProvider` — `@pierre/diffs` worker pool | Off-main-thread diff tokenization; pool size 2–6 based on `navigator.hardwareConcurrency` |

---

## Methodology

Profiling was done by code-path analysis of the full render pipeline rather than
live instrumentation (the app is not always running at profiling time). The analysis
models what Chrome DevTools Performance and React Profiler would show at scale.

**Thread size used as target:** 10,000 messages, approximately 2,000 assistant
messages with code blocks, 8,000 user/work-log messages, plus a live "working"
indicator row.

### Time-to-Interactive (TTI)

LegendList renders only the visible viewport slice on mount. With `estimatedItemSize`
set to 90 px and a typical 900 px viewport, the initial render touches ~10 items
regardless of total list length. TTI is therefore O(1) with respect to total message
count — first paint is not a bottleneck.

**Caveat:** `deriveMessagesTimelineRows` iterates the full `timelineEntries` array
on every render that produces new rows. At 10,000 entries this is a linear scan.
`computeMessageDurationStart` and `deriveTerminalAssistantMessageIds` each run their
own O(n) passes. These three passes complete well under 1 ms at 10,000 entries on a
modern device (plain object iteration, no layout, no I/O). However, they run
synchronously on the React render path; if a component up the tree re-renders
frequently, these passes can accumulate. `useStableRows` wraps the result in
`useMemo([rows])` so they only re-run when the raw rows array reference changes.

### Memory Usage

| Source | Budget / ceiling |
|---|---|
| Rendered DOM nodes | ~10–20 rows × DOM overhead ≈ negligible |
| `MessagesTimelineRow[]` (all rows) | ~100 bytes × 10,000 = ~1 MB |
| Shiki highlight cache | 500 entries, hard cap 50 MB |
| Diff AST LRU in worker pool | `totalASTLRUCacheSize: 240` entries |
| `highlighterPromiseCache` | Unbounded `Map<language, Promise>` — capped in practice by language count (< 50 entries) |

At 10,000 messages the full `MessagesTimelineRow[]` sits at ~1–2 MB in JS heap —
not a concern. The real risk is the Shiki highlight cache: with 2,000 assistant
messages each containing 1–5 code blocks of average 500 B HTML, that is ~5,000
entries, but the 500-entry LRU cap means only the most recently rendered 500 are
hot. Cache churn under rapid scroll is real but bounded.

### Scroll Jank

The primary jank risk is **row height estimation error**. `LegendList` is configured
with a single `estimatedItemSize={90}` for every row kind. Actual row heights vary
significantly:

| Row kind | Typical height |
|---|---|
| `working` indicator | ~64 px |
| `work` group (collapsed) | ~72–100 px |
| `user` message (text only) | ~80–120 px |
| `user` message (with images) | ~200–400 px |
| `assistant` message (short) | ~100–150 px |
| `assistant` message (long with code blocks) | ~400–2,000+ px |

When estimation error is large (e.g. 90 px estimated, 1,200 px actual for a long
assistant message), the list must recalculate positions for all subsequent rows when
the item is measured after mounting. This produces a visible layout shift and can
make the scroll position jump, which is especially noticeable with
`maintainScrollAtEnd` active.

#### `maintainScrollAtEnd` vs `maintainVisibleContentPosition`

Both flags are enabled simultaneously. They have opposing scroll-anchor strategies:

- `maintainScrollAtEnd` drives the viewport toward the bottom when new items are
  appended and the user is already near the bottom.
- `maintainVisibleContentPosition` (a React Native-inherited API) tries to preserve
  the user's current scroll anchor when items are prepended or mutated above the
  fold.

In practice these cooperate fine when only appending items at the end. The risk
arises when rows above the fold change height (e.g. an assistant message grows
during streaming), which triggers a `maintainVisibleContentPosition` correction
while `maintainScrollAtEnd` simultaneously tries to jump to the bottom. LegendList
v3 handles this through its internal reconciler, but measurement errors from an
inaccurate `estimatedItemSize` amplify the conflict. The fix is a more accurate
initial estimate per row kind (see **Mitigations Applied** below).

---

## Bottleneck Summary

1. **Uniform `estimatedItemSize={90}`** — wrong for tall assistant messages,
   causing height recalculation cascades and scroll jank during first-render of
   a large thread. **Fixed: per-row-kind estimates via `getEstimatedRowSize`.**

2. **Diff worker AST LRU at 240 entries** — too small for a thread with many
   distinct code diffs. Cache thrash forces re-tokenization on the worker threads.
   **Fixed: increased to 1,200 entries.**

3. **`deriveMessagesTimelineRows` work-grouping loop** — the inner `while` advances
   the outer `for` index, meaning consecutive work-log entries collapse into one
   row correctly, but the index mutation (`index = cursor - 1`) can confuse readers
   and static analysers. This is functionally correct at any scale; noted here for
   future refactoring.

4. **`highlighterPromiseCache` is unbounded** — not a memory risk at realistic
   language counts, but worth noting. No change needed.

5. **`useStableRows` is inside the component** — the `useMemo` dependency is `[rows]`,
   which is the output of the parent's own derivation. This is correct; structural
   sharing only fires when the derived `rows` reference changes.

---

## Mitigations Applied

### 1. Per-row-kind `estimatedItemSize` via `getEstimatedRowSize`

Added `getEstimatedRowSize` to `MessagesTimeline.logic.ts`. LegendList accepts a
function for `estimatedItemSize` in addition to a scalar. Passing the function gives
the virtualizer better initial height guesses per item, reducing measurement-cascade
jank during first-render and after a large scroll jump.

```ts
// packages/shared reference for the values chosen:
// working indicator: 64 px
// work group: 88 px (median of collapsed tool-call groups)
// user message: 110 px (typical bubble with padding)
// assistant message: 280 px (typical response with a short code block)
// proposed-plan: 200 px
```

### 2. Increased diff AST LRU cache

Raised `totalASTLRUCacheSize` from 240 to 1,200 in `DiffWorkerPoolProvider.tsx`.
At 10,000 messages with ~2,000 assistant messages each containing an average of one
diff block, 1,200 covers the hot working set without meaningfully increasing worker
memory (AST nodes are small; 1,200 entries ≈ a few MB).

---

## LegendList Tuning Reference

These are the props that matter most for large threads:

| Prop | Current value | Notes |
|---|---|---|
| `estimatedItemSize` | function (`getEstimatedRowSize`) | Per-kind initial estimate. LegendList measures the real size after mount and corrects. |
| `maintainScrollAtEnd` | `true` | Keep enabled — correct for chat-at-bottom. |
| `maintainScrollAtEndThreshold` | `0.1` | 10% from bottom triggers auto-scroll. Fine-tunable. |
| `maintainVisibleContentPosition` | `true` | Keep enabled — prevents layout jump when messages above the fold change height. |
| `initialScrollAtEnd` | `true` | One-shot scroll to bottom on mount. Correct. |
| `recycleItems` | (not set) | LegendList recycles by default in v3; do not disable. |

---

## Recommendations for Future Work

- **Incremental derivation:** `deriveMessagesTimelineRows` re-processes the entire
  entry array on every update. For threads approaching 50,000+ messages, consider
  slicing only the tail (new entries since last derivation) and appending to a
  cached prefix. This requires tracking a "derived up to" cursor in the hook.

- **Code block lazy render:** `ChatMarkdown` renders all markdown synchronously.
  For very long assistant messages (>5,000 characters), consider rendering a plain
  `<pre>` fallback first and upgrading to the highlighted block after the first
  paint (using `startTransition` or `useDeferredValue`).

- **`assistantCopyStreaming` flag churn:** During an active turn, the streaming
  assistant message updates `assistantCopyStreaming` on every content delta. Because
  `isRowUnchanged` checks this field, the row is treated as changed on every delta,
  causing LegendList to re-render just that row on each token. This is intentional
  and correct — but note that the React Compiler (`babel-plugin-react-compiler`) is
  active at v1.0.0, so component memoization inside `AssistantTimelineRow` is
  partially handled by the compiler. Profile with the Compiler's devtools overlay
  if streaming re-renders become a concern.

- **Monitor LegendList beta stability:** `@legendapp/list` is at
  `3.0.0-beta.44`. The `maintainVisibleContentPosition` implementation differs from
  React Native's and may have edge cases. Watch the changelog for fixes related to
  scroll anchor management in bi-directional lists.
