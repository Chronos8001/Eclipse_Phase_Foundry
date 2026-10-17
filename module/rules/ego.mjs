/**
 * Ego rules (Core pp. 268-275, 285-289): resleeving tests, forks and merging, reputation favors.
 * Pure functions on plain numbers and test results, so they can be checked outside Foundry (tools/test-rules.mjs).
 * Test results are those of dice/tests.mjs#evaluateTest: { success, critical, margin, outcome }.
 */

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/* -------------------------------------------- */
/*  Resleeving (pp. 271-272)                    */
/* -------------------------------------------- */

/**
 * Integration and Alienation Modifiers table (p. 272). alienation: the modifier applies to the Alienation Test only.
 * auto: how the resleeving dialog detects it (trait key and level, or the new morph's type).
 */
export const SLEEVING_MODIFIERS = [
  { key: "familiar", value: 30 },
  { key: "clone", value: 20 },
  { key: "original", value: 20 },
  { key: "adaptability2", value: 20, trait: "adaptability", level: 2 },
  { key: "adaptability1", value: 10, trait: "adaptability", level: 1 },
  { key: "previous", value: 10 },
  { key: "firstTime", value: -10 },
  { key: "agi", value: -10 },
  { key: "uplift", value: -10 },
  { key: "synthetic", value: -10, morphType: "synthmorph" },
  { key: "sexChange", value: -10 },
  { key: "heavilyModified", value: -10 },
  { key: "morphingDisorder1", value: -10, trait: "morphingDisorder", level: 1 },
  { key: "morphingDisorder2", value: -20, trait: "morphingDisorder", level: 2 },
  { key: "infomorph", value: -20, alienation: true, morphType: "infomorph" },
  { key: "fork", value: -20, alienation: true },
  { key: "morphingDisorder3", value: -30, trait: "morphingDisorder", level: 3 },
  { key: "exotic", value: -30 }
];

/** Sum of the chosen modifiers for the integration or alienation test. */
export function sleevingModifier(keys, test) {
  return SLEEVING_MODIFIERS
    .filter(m => keys.includes(m.key) && ((test === "alienation") || !m.alienation))
    .reduce((sum, m) => sum + m.value, 0);
}

/** Integration Test (SOM x 3, morph bonuses do not apply): its target before modifiers. */
export const integrationTarget = egoSom => egoSom * 3;

/**
 * Effect of an Integration Test (Integration Test table, p. 272).
 * @returns {{modifier: number, physical: boolean, days: number|null, moxie: number}}
 *   days: null for "until resleeved"; modifier 0 for no ill effects; moxie 1 on a critical success (for the session)
 */
export function integrationEffect(result) {
  const days = 2 + Math.floor(result.margin / 10);
  switch ( result.outcome ) {
    case "criticalFailure": return { modifier: -30, physical: true, days: null, moxie: 0 };
    case "severeFailure": return { modifier: -10, physical: false, days, moxie: 0 };
    case "failure": return { modifier: -10, physical: true, days, moxie: 0 };
    case "success": return { modifier: -10, physical: true, days: 1, moxie: 0 };
    case "criticalSuccess": return { modifier: 0, physical: false, days: 0, moxie: 1 };
    default: return { modifier: 0, physical: false, days: 0, moxie: 0 };
  }
}

/**
 * Alienation Test (INT x 3, p. 272): stress suffered, or a healing formula on a critical success.
 * @returns {{stress: number, heal: string|null}}
 */
export function alienationStress(result) {
  if ( result.outcome === "criticalSuccess" ) return { stress: 0, heal: "ceil(1d10 / 2)" };
  if ( result.success ) return { stress: 0, heal: null };
  const per10 = Math.floor(result.margin / 10);
  return { stress: (result.outcome === "criticalFailure") ? per10 * 2 : per10, heal: null };
}

/** Continuity Stress table (p. 272): stress formula of each situation. notKnowing adds +2 to any of them. */
export const CONTINUITY_SITUATIONS = {
  stackPeaceful: "floor(1d10 / 2)",
  stackViolent: "1d10",
  archiveShort: "floor(1d10 / 2)",
  archiveLong: "1d10",
  continuity: "0",
  noContinuity: "floor(1d10 / 2)",
  fork: "2"
};
export const NOT_KNOWING_STRESS = 2;

/**
 * Continuity Test (WIL x 3, p. 272): the stress rolled on the table, lowered by 1 per 10 full points of MoS or
 * raised by 1 per 10 full points of MoF.
 */
export function continuityStress(rolled, result, { notKnowing = false } = {}) {
  const shift = Math.floor(result.margin / 10) * (result.success ? -1 : 1);
  return Math.max(0, rolled + (notKnowing ? NOT_KNOWING_STRESS : 0) + shift);
}

/* -------------------------------------------- */
/*  Backups (p. 270)                            */
/* -------------------------------------------- */

/** Backup complications: a failed LUC Test gives the backup 1 stress per 10 full points of MoF. */
export const backupStress = result => (result.success ? 0 : Math.floor(result.margin / 10));

/* -------------------------------------------- */
/*  Forks (pp. 273-274)                         */
/* -------------------------------------------- */

/**
 * Fork limits. aptitude, luc, init: reductions; activeMax/knowledgeMax: highest skill totals; activeCount and
 * knowledgeCount: most skills kept; moxie: the fork's Moxie (null: unchanged); psi: whether the Psi trait remains.
 */
export const FORKS = {
  alpha: { aptitude: 0, luc: 0, init: 0, activeMax: null, knowledgeMax: null, activeCount: null, knowledgeCount: null, moxie: null, psi: true },
  beta: { aptitude: -5, luc: -10, init: -20, activeMax: 60, knowledgeMax: null, activeCount: null, knowledgeCount: null, moxie: 1, psi: false },
  delta: { aptitude: -10, luc: -20, init: -40, activeMax: 40, knowledgeMax: 80, activeCount: 5, knowledgeCount: 5, moxie: 0, psi: false }
};

/** A fork's aptitude: reduced, to a minimum of 1. */
export const forkAptitude = (value, kind) => Math.max(1, value + FORKS[kind].aptitude);

/**
 * Ranks a fork keeps in a skill so that its total does not exceed the maximum.
 * @param {number} ranks  The skill's ranks
 * @param {number} rest   Everything else in the fork's total (aptitude, bonuses)
 * @param {number|null} max
 */
export const forkRanks = (ranks, rest, max) => ((max === null) ? ranks : Math.max(0, Math.min(ranks, max - rest)));

/**
 * The skills a delta fork keeps: its highest totals, at most `count` of them (the book leaves the choice to the
 * player; the highest are kept and can be changed afterward).
 * @param {{id: string, total: number}[]} skills
 */
export function forkKeptSkills(skills, count) {
  if ( count === null ) return skills.map(s => s.id);
  return [...skills].sort((a, b) => b.total - a.total).slice(0, count).map(s => s.id);
}

/** Neural pruning (p. 274): a failed Psychosurgery Test gives one penalty per 10 full points of MoF. */
export const pruningPenalties = result => (result.success ? 0 : Math.floor(result.margin / 10));
/** Long-term neural pruning: +30 (p. 274). */
export const LONG_TERM_PRUNING = 30;

/* -------------------------------------------- */
/*  Merging (p. 275)                            */
/* -------------------------------------------- */

/**
 * Merging table (p. 275), by time apart. Success and failure: stress (a number or a formula) and memories.
 * upTo: the row's upper bound in hours.
 */
export const MERGING = [
  { upTo: 1, modifier: 30, success: { sv: "0", memory: "seamless" }, failure: { sv: "max(0, floor(1d10 / 2) - 1)", memory: "intact" } },
  { upTo: 4, modifier: 20, success: { sv: "0", memory: "solid" }, failure: { sv: "floor(1d10 / 2)", memory: "intact" } },
  { upTo: 12, modifier: 10, success: { sv: "1", memory: "intact" }, failure: { sv: "ceil(1d10 / 2)", memory: "minor" } },
  { upTo: 24, modifier: 0, success: { sv: "2", memory: "intact" }, failure: { sv: "ceil(1d10 / 2) + 2", memory: "moderate" } },
  { upTo: 72, modifier: -10, success: { sv: "3", memory: "intact" }, failure: { sv: "1d10 + 2", memory: "major" } },
  { upTo: 168, modifier: -20, success: { sv: "4", memory: "intact" }, failure: { sv: "1d10 + 4", memory: "major" } },
  { upTo: Infinity, modifier: -30, success: { sv: "5", memory: "minor" }, failure: { sv: "1d10 + 6", memory: "severe" } }
];

/** The Merging table row for a time apart in seconds (each row up to, but not including, its bound). */
export const mergingRow = seconds => MERGING.find(r => (seconds / SECONDS_PER_HOUR) < r.upTo);

/* -------------------------------------------- */
/*  Reputation and favors (pp. 285-289)         */
/* -------------------------------------------- */

/** Reputation level: every 20 points of Rep is one level (0-19: Level 1 ... 80-99: Level 5). */
export const repLevel = rep => Math.min(5, Math.floor(Math.max(0, rep) / 20) + 1);

/** Favors table (p. 289): timeframe, Rep burned to seek the favor before it refreshes, refresh rate in seconds. */
export const FAVORS = {
  1: { timeframe: "1 minute", burn: 0, refresh: SECONDS_PER_HOUR },
  2: { timeframe: "30 minutes", burn: 1, refresh: SECONDS_PER_DAY },
  3: { timeframe: "1 hour", burn: 5, refresh: 7 * SECONDS_PER_DAY },
  4: { timeframe: "1 day", burn: 10, refresh: 30 * SECONDS_PER_DAY },
  5: { timeframe: "3 days", burn: 20, refresh: 90 * SECONDS_PER_DAY }
};
/** Burning Rep for a bonus: +1 per point burned, up to +30. */
export const MAX_BURN_BONUS = 30;

/**
 * Modifier of a Networking Test for a favor (Networking Modifiers table, p. 287): ±10 per level between the Rep
 * level and the favor level, the Rep burned (up to +30), keeping quiet (a negative number) and paying extra
 * (+10 per level).
 */
export function favorModifier({ rep, level, burn = 0, quiet = 0, extra = 0 }) {
  return ((repLevel(rep) - level) * 10) + Math.min(MAX_BURN_BONUS, Math.max(0, burn)) - Math.abs(quiet) + (extra * 10);
}

/** Whether a favor level used at `lastUsed` (world time, null if never) has refreshed at `now`. */
export const favorRefreshed = (level, lastUsed, now) => (lastUsed === null) || (lastUsed === undefined) ||
  ((now - lastUsed) >= FAVORS[level].refresh);
