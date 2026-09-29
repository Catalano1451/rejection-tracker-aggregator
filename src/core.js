/**
 * Core implementation of the Rejection Tracker Aggregator.
 *
 * The single job of this module is to attach one `unhandledRejection` listener
 * to the current Node.js process, record every rejection that fires into an
 * array, and prevent Node from terminating the process as it normally would
 * once the listener count exceeds zero.
 *
 * Design decisions worth stating up front, because they are the ambiguous parts
 * of the brief and we picked one reading for each:
 *
 * 1. "Suppressing the default process exit" is interpreted as: while a tracker
 *    is active, Node's built-in behaviour of exiting on an unhandled rejection
 *    (Node >= 15, when no listener is registered) is disabled, because we
 *    register a listener. We do NOT call `process.exit` ourselves, and we do
 *    not swallow rejections from user code that has its own `unhandledRejection`
 *    listeners — we only add one of our own.
 *
 * 2. The clock is injectable. Tests must never depend on wall-clock time, so
 *    the constructor takes a `now` function that returns the current timestamp
 *    in milliseconds. The default is `Date.now`.
 *
 * 3. Each recorded entry captures `{ timestamp, reason, stack }`. `reason` is
 *    the raw value passed to the rejection. `stack` is the stack string if the
 *    reason is an Error with a stack, otherwise `undefined`. We do not fabricate
 *    a stack for non-Error reasons.
 *
 * 4. Calling `stop()` removes our listener. After `stop()`, new rejections are
 *    no longer recorded and Node's default behaviour resumes.
 */

/**
 * @typedef {Object} RejectionEntry
 * @property {number} timestamp   Milliseconds-since-epoch from the injected clock.
 * @property {*}      reason      The raw rejection value, unchanged.
 * @property {string|undefined} stack  The Error.stack string, or undefined when
 *                                    the reason is not an Error with a stack.
 */

/**
 * @typedef {() => number} ClockFn
 */

/**
 * Internal symbol used to tag our listener so we can reliably remove exactly
 * the function we added, even if a user also registers their own listener with
 * the same body. Using a Symbol field avoids relying on function identity across
 * bound copies.
 */
const TRACKER_TAG = Symbol('rejection-tracker-aggregator');

/**
 * Collects unhandled promise rejections for the lifetime of a Node.js process.
 */
export class RejectionTracker {
  /**
   * @param {Object}  [opts]
   * @param {ClockFn} [opts.now]  Injectable clock returning ms since epoch.
   *                               Defaults to `Date.now`. Pass a fake in tests.
   * @param {NodeJS.Process} [opts.process]
   *                               Injectable process object. Defaults to the
   *                               global `process`. Pass a fake in tests so the
   *                               suite never touches the real process listeners.
   */
  constructor(opts = {}) {
    const { now = Date.now, process: proc = process } = opts;

    if (typeof now !== 'function') {
      throw new TypeError('`now` must be a function');
    }
    if (proc === null || typeof proc !== 'object') {
      throw new TypeError('`process` must be an object');
    }
    if (typeof proc.on !== 'function' || typeof proc.off !== 'function') {
      throw new TypeError('`process` must have `on` and `off` methods');
    }

    /** @private @type {ClockFn} */
    this._now = now;
    /** @private @type {NodeJS.Process} */
    this._process = proc;
    /** @private @type {RejectionEntry[]} */
    this._entries = [];
    /** @private @type {((reason: unknown, promise: Promise<unknown>) => void) | null} */
    this._listener = null;
  }

  /**
   * Begin recording rejections. Safe to call once; calling again while active
   * is a no-op so consumers cannot accidentally double-register.
   *
   * @returns {void}
   */
  start() {
    if (this._listener !== null) return;

    const listener = (reason) => {
      /** @type {RejectionEntry} */
      const entry = {
        timestamp: this._now(),
        reason,
        stack: undefined,
      };
      if (reason !== null && typeof reason === 'object' && 'stack' in reason) {
        const s = /** @type {{ stack?: unknown }} */ (reason).stack;
        if (typeof s === 'string') entry.stack = s;
      }
      this._entries.push(entry);
    };
    // Tag for defensive identity, though we also keep the reference.
    Object.defineProperty(listener, TRACKER_TAG, { value: true });

    this._listener = listener;
    this._process.on('unhandledRejection', listener);
  }

  /**
   * Stop recording and detach our listener. After this call, new unhandled
   * rejections will no longer be captured and Node's default behaviour resumes.
   * Idempotent.
   *
   * @returns {void}
   */
  stop() {
    if (this._listener === null) return;
    this._process.off('unhandledRejection', this._listener);
    this._listener = null;
  }

  /**
   * @returns {RejectionEntry[]} A shallow copy of the recorded entries so
   *   callers cannot mutate the internal array.
   */
  get entries() {
    return this._entries.slice();
  }

  /**
   * @returns {number} How many rejections have been recorded.
   */
  get count() {
    return this._entries.length;
  }

  /**
   * Clear all recorded entries. Does not stop tracking.
   *
   * @returns {void}
   */
  clear() {
    this._entries.length = 0;
  }
}
