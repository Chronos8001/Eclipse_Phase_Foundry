/**
 * Gear rules of the Core Rulebook (pp. 294-349), as pure functions checked by tools/test-rules.mjs.
 */

/** Action Turns in each time unit (an Action Turn lasts 3 seconds, p. 189). */
const UNIT_TURNS = { turn: 1, minute: 20, hour: 1200, day: 28800, week: 201600 };

/**
 * Length of a duration written in the book ("20 minutes", "3 Action Turns", "2 hours–1 day"), in Action Turns.
 * Ranges and "A/B" alternatives use their first value.
 * @returns {number|null} null for durations that are not a time ("special", "death")
 */
export function durationTurns(text) {
  const m = String(text ?? "").toLowerCase().match(/(\d+)\s*(action turns?|turns?|minutes?|hours?|days?|weeks?)/);
  if ( !m ) return null;
  const unit = m[2].replace(/^action /, "").replace(/s$/, "");
  return Number(m[1]) * (UNIT_TURNS[unit] ?? 1);
}

/** Seconds of a duration in Action Turns. */
export function turnsToSeconds(turns) {
  return turns * 3;
}

/** Target of the addiction test when using an addictive substance: WIL x 3 + the addiction modifier (p. 318). */
export function addictionTarget(wil, modifier) {
  const n = Number(String(modifier ?? "").replace(/[–−]/g, "-").match(/[+-]?\d+/)?.[0] ?? 0);
  return (wil * 3) + n;
}
