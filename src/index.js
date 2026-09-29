/**
 * Public entry point for the Rejection Tracker Aggregator.
 *
 * Re-exports the `RejectionTracker` class so consumers can do:
 *
 *   import { RejectionTracker } from 'rejection-tracker-aggregator';
 *
 * Keeping a barrel separate from the implementation lets us grow the module
 * later (types, helpers) without churning every import site.
 */
export { RejectionTracker } from './core.js';
