# Rejection Tracker Aggregator

Collects every unhandled promise rejection over a Node.js process lifetime into an array of `{ timestamp, reason, stack }` entries, while suppressing the default process-exit-on-unhandled-rejection behaviour by registering a listener.

## Usage

```js
import { RejectionTracker } from 'rejection-tracker-aggregator';

const tracker = new RejectionTracker(); // uses Date.now by default
tracker.start();

// ... later, inspect what accumulated ...
for (const entry of tracker.entries) {
  console.log(entry.timestamp, entry.reason, entry.stack);
}

tracker.stop();
```

Exports: `RejectionTracker` (class). Constructor options: `now` (injectable clock returning ms, defaults to `Date.now`), `process` (injectable process object, defaults to the global `process`). Methods: `start()`, `stop()`, `clear()`. Properties: `entries` (returns a shallow copy), `count`.

## Why

Node exits on unhandled rejections by default (Node 15+). For long-running services and test harnesses you often want to *see* every rejection that occurred during a run rather than die on the first one. This library attaches a single `unhandledRejection` listener that records each rejection and lets the process continue. The trade-off: by suppressing exit you accept that a genuinely fatal rejection will not crash the process — that is the point, but it means you are responsible for inspecting `entries` and acting on them.

## Edge cases

- A non-Error rejection reason (string, number, `null`, `undefined`) is recorded with `stack: undefined`. The library does not fabricate a stack.
- An object that has a `stack` field which is not a string is also recorded with `stack: undefined`.
- `start()` is idempotent; calling it twice does not register a second listener. `stop()` is likewise idempotent.
- `entries` returns a copy. Mutating it does not affect the tracker's internal state.
- The library coexists with any other `unhandledRejection` listener you register yourself; it does not consume or swallow rejections from other listeners.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

