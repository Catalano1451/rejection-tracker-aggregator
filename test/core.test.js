import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { RejectionTracker } from '../src/index.js';

/**
 * Minimal fake process. We only need `on`/`off` for `unhandledRejection` and a
 * way to dispatch events to listeners. This keeps tests off the real global
 * `process` so they are deterministic and do not interfere with node:test's
 * own rejection handling.
 */
class FakeProcess {
  constructor() {
    this._listeners = new Map();
  }
  on(name, fn) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(fn);
  }
  off(name, fn) {
    this._listeners.get(name)?.delete(fn);
  }
  emit(name, ...args) {
    for (const fn of this._listeners.get(name) ?? []) fn(...args);
  }
  listenerCount(name) {
    return this._listeners.get(name)?.size ?? 0;
  }
}

describe('RejectionTracker', () => {
  describe('constructor', () => {
    test('accepts a custom clock', () => {
      let t = 1000;
      const tracker = new RejectionTracker({ now: () => t, process: new FakeProcess() });
      assert.equal(typeof tracker.now, 'undefined'); // not exposed
      assert.equal(tracker.count, 0);
    });

    test('rejects a non-function clock', () => {
      assert.throws(() => new RejectionTracker({ now: 42, process: new FakeProcess() }),
        /must be a function/);
    });

    test('rejects a process without on/off', () => {
      assert.throws(() => new RejectionTracker({ process: {} }),
        /must have `on` and `off` methods/);
    });
  });

  describe('start / stop', () => {
    test('start registers exactly one unhandledRejection listener', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ process: proc });
      assert.equal(proc.listenerCount('unhandledRejection'), 0);
      t.start();
      assert.equal(proc.listenerCount('unhandledRejection'), 1);
      t.stop();
      assert.equal(proc.listenerCount('unhandledRejection'), 0);
    });

    test('start is idempotent', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ process: proc });
      t.start();
      t.start();
      assert.equal(proc.listenerCount('unhandledRejection'), 1);
      t.stop();
    });

    test('stop is idempotent and safe before start', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ process: proc });
      t.stop(); // no throw
      t.start();
      t.stop();
      t.stop();
      assert.equal(proc.listenerCount('unhandledRejection'), 0);
    });
  });

  describe('recording', () => {
    test('records an Error rejection with timestamp, reason, and stack', () => {
      const proc = new FakeProcess();
      let clock = 5000;
      const t = new RejectionTracker({ now: () => clock, process: proc });
      t.start();

      const err = new Error('boom');
      proc.emit('unhandledRejection', err, {});

      const entries = t.entries;
      assert.equal(entries.length, 1);
      assert.equal(entries[0].timestamp, 5000);
      assert.equal(entries[0].reason, err);
      assert.equal(typeof entries[0].stack, 'string');
      assert.match(entries[0].stack, /Error: boom/);
      t.stop();
    });

    test('records a non-Error reason with stack undefined', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 1, process: proc });
      t.start();

      proc.emit('unhandledRejection', 'just a string', {});
      proc.emit('unhandledRejection', 42, {});
      proc.emit('unhandledRejection', null, {});
      proc.emit('unhandledRejection', undefined, {});

      const entries = t.entries;
      assert.equal(entries.length, 4);
      for (const e of entries) {
        assert.equal(e.stack, undefined);
      }
      assert.equal(entries[0].reason, 'just a string');
      assert.equal(entries[1].reason, 42);
      assert.equal(entries[2].reason, null);
      assert.equal(entries[3].reason, undefined);
      t.stop();
    });

    test('records an object with a non-string stack field as undefined', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      t.start();

      const weird = { stack: 12345, message: 'nope' };
      proc.emit('unhandledRejection', weird, {});

      assert.equal(t.entries[0].stack, undefined);
      assert.equal(t.entries[0].reason, weird);
      t.stop();
    });

    test('uses the injected clock for each entry', () => {
      const proc = new FakeProcess();
      let clock = 10;
      const t = new RejectionTracker({ now: () => clock, process: proc });
      t.start();

      proc.emit('unhandledRejection', new Error('a'), {});
      clock = 20;
      proc.emit('unhandledRejection', new Error('b'), {});
      clock = 30;
      proc.emit('unhandledRejection', new Error('c'), {});

      const ts = t.entries.map((e) => e.timestamp);
      assert.deepEqual(ts, [10, 20, 30]);
      t.stop();
    });

    test('count reflects the number of recorded rejections', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      t.start();
      assert.equal(t.count, 0);
      proc.emit('unhandledRejection', 1, {});
      assert.equal(t.count, 1);
      proc.emit('unhandledRejection', 2, {});
      assert.equal(t.count, 2);
      t.stop();
    });

    test('entries returns a copy; mutating it does not affect the tracker', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      t.start();
      proc.emit('unhandledRejection', new Error('x'), {});
      const e1 = t.entries;
      e1.length = 0;
      e1.push({ timestamp: 999, reason: 'fake', stack: 'fake' });
      assert.equal(t.count, 1);
      assert.notEqual(t.entries[0].reason, 'fake');
      t.stop();
    });

    test('clear empties entries without stopping tracking', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      t.start();
      proc.emit('unhandledRejection', new Error('a'), {});
      proc.emit('unhandledRejection', new Error('b'), {});
      assert.equal(t.count, 2);
      t.clear();
      assert.equal(t.count, 0);
      proc.emit('unhandledRejection', new Error('c'), {});
      assert.equal(t.count, 1);
      t.stop();
    });

    test('does not record after stop', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      t.start();
      proc.emit('unhandledRejection', new Error('a'), {});
      t.stop();
      proc.emit('unhandledRejection', new Error('b'), {});
      assert.equal(t.count, 1);
    });

    test('coexists with a user-registered listener', () => {
      const proc = new FakeProcess();
      const t = new RejectionTracker({ now: () => 0, process: proc });
      const seen = [];
      proc.on('unhandledRejection', (r) => seen.push(r));
      t.start();

      const err = new Error('shared');
      proc.emit('unhandledRejection', err, {});

      assert.equal(seen.length, 1);
      assert.equal(seen[0], err);
      assert.equal(t.count, 1);
      t.stop();
    });
  });
});
