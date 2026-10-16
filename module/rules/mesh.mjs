/**
 * Mesh and intrusion rules of the Core Rulebook (pp. 246-262), as pure functions checked by tools/test-rules.mjs.
 */

/** Mesh gear quality (p. 247): -30 for relics to +30 for state-of-the-art technology. */
export const QUALITY = [-30, -20, -10, 0, 10, 20, 30];

/** Access privileges sought when hacking in (p. 247, 255). */
export const PRIVILEGES = { public: 0, user: 0, security: -20, admin: -30 };

/** Intruder status, from best to worst (p. 256). */
export const STATUSES = ["hidden", "covert", "spotted", "locked"];

/** Alert raised by each status, and the modifier it gives the intruder (p. 257). */
export const ALERTS = { hidden: "none", covert: "none", spotted: "passive", locked: "active" };
export const ALERT_MODIFIERS = { none: 0, passive: -10, active: -20 };

/** Hidden intruders get +30 to subvert the system (p. 256). */
export const HIDDEN_BONUS = 30;
/** Brute-force hacking: +30, 1 minute, always Locked (p. 257). */
export const BRUTE_FORCE_BONUS = 30;
/** Cyberbrains: -30 to hack and subvert; the admin privilege modifier does not apply (p. 261). */
export const CYBERBRAIN_MODIFIER = -30;
/** Lockout: the Locked intruder defends at -20 (p. 257). */
export const LOCKOUT_MODIFIER = -20;

/**
 * Modifier to the Infosec Test that defeats a firewall (p. 255).
 * @param {object} o
 * @param {string} [o.privileges="user"] Account privileges sought
 * @param {number} [o.exploit=0]         Quality of the hacker's exploit (or spoof) software
 * @param {number} [o.firewall=0]        Quality of the target's firewall: a better firewall is harder to defeat
 * @param {boolean} [o.cyberbrain]       Hacking a cyberbrain
 * @param {boolean} [o.bruteForce]       Brute-force hacking
 */
export function intrusionModifier({ privileges = "user", exploit = 0, firewall = 0, cyberbrain = false, bruteForce = false } = {}) {
  let modifier = exploit - firewall;
  modifier += (cyberbrain && (privileges === "admin")) ? 0 : (PRIVILEGES[privileges] ?? 0);
  if ( cyberbrain ) modifier += CYBERBRAIN_MODIFIER;
  if ( bruteForce ) modifier += BRUTE_FORCE_BONUS;
  return modifier;
}

/**
 * Outcome of an intrusion attempt (pp. 255-257).
 * @param {{success: boolean, excellent: boolean}} hacker  The hacker's Infosec Test
 * @param {{success: boolean}|null} monitor               The monitor's Infosec Test, if the system is actively monitored
 * @param {object} [o]
 * @param {boolean} [o.bruteForce]
 * @returns {{status: string|null, retry: boolean}} The new status (null: no access), and whether the test is repeated
 */
export function intrusionOutcome(hacker, monitor = null, { bruteForce = false } = {}) {
  if ( bruteForce ) {
    // A brute-force intruder is always Locked; a monitor who wins locks them out at once
    if ( !hacker.success ) return { status: null, retry: false };
    if ( monitor?.success ) return { status: null, retry: false };
    return { status: "locked", retry: false };
  }
  if ( !monitor ) {
    if ( !hacker.success ) return { status: null, retry: false };
    return { status: hacker.excellent ? "hidden" : "covert", retry: false };
  }
  if ( hacker.success && !monitor.success ) return { status: hacker.excellent ? "hidden" : "covert", retry: false };
  if ( hacker.success && monitor.success ) return { status: "spotted", retry: false };
  if ( !hacker.success && monitor.success ) return { status: "locked", retry: false };
  // Both fail: roll again on the hacker's next Action Phase
  return { status: null, retry: true };
}

/** Modifier to an intruder's tests on a system: alert level, and +30 to subvert while Hidden. */
export function statusModifier(status, { subvert = true } = {}) {
  const alert = ALERTS[status] ?? "none";
  return ALERT_MODIFIERS[alert] + ((status === "hidden") && subvert ? HIDDEN_BONUS : 0);
}

/** One status step better (Locked intruders may not upgrade). */
export function upgradeStatus(status) {
  if ( status === "locked" ) return status;
  const i = STATUSES.indexOf(status);
  return STATUSES[Math.max(0, i - 1)];
}

/** Status after a test manipulating the system (p. 256): Severe Failure -1 step, critical failure Locked. */
export function statusAfterTest(status, result) {
  if ( result.success ) return status;
  if ( result.critical ) return "locked";
  if ( result.severe ) return STATUSES[Math.min(STATUSES.length - 1, STATUSES.indexOf(status) + 1)];
  return status;
}

/** Steps a script may hold: Programming ÷ 10, round down (p. 260). */
export function scriptSteps(programming) {
  return Math.floor(programming / 10);
}

/** Consecutive successful Opposed Tests needed to crash an AI (2) or an AGI/infomorph (3), p. 260. */
export function crashTests(kind) {
  return kind === "ai" ? 2 : 3;
}
