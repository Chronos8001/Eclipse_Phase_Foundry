/**
 * Healing, mental health and psychosurgery (Core pp. 208-215, 229-233). Pure functions on plain numbers and test
 * results (dice/tests.mjs#evaluateTest), checked in tools/test-rules.mjs.
 */

const HOUR = 3600;

/* -------------------------------------------- */
/*  Physical healing (p. 208)                   */
/* -------------------------------------------- */

/**
 * Healing table: hours to heal 1d10 damage, and 1 wound once all damage is healed, by the best care available.
 * Poor conditions double the timeframes; harsh conditions triple them and stop wound healing.
 */
export const HEALING = {
  none: { damage: 24, wound: 7 * 24 },
  biomods: { damage: 12, wound: 3 * 24 },
  nanobandage: { damage: 2, wound: 24 },
  medichines: { damage: 1, wound: 12 }
};
export const CONDITIONS = { normal: 1, poor: 2, harsh: 3 };

/**
 * What natural healing does over some hours: the number of 1d10 damage rolls, then the wounds healed with the time
 * left once the damage is gone (the damage healed is only known once rolled, so the wounds are worked out after).
 * @returns {{rolls: number, hoursPerRoll: number, hoursPerWound: number|null}}
 */
export function healingRates(care, condition = "normal") {
  const rate = HEALING[care] ?? HEALING.none;
  const factor = CONDITIONS[condition] ?? 1;
  return { hoursPerRoll: rate.damage * factor, hoursPerWound: (condition === "harsh") ? null : rate.wound * factor };
}

/**
 * Natural healing over `hours`, given the damage rolls (1d10 each): damage healed first, then wounds.
 * @param {number[]} rolls  1d10 results, at least as many as there are healing periods
 */
export function naturalHealing({ damage, wounds, hours, care = "none", condition = "normal", rolls }) {
  const { hoursPerRoll, hoursPerWound } = healingRates(care, condition);
  let left = hours;
  let healed = 0;
  let i = 0;
  while ( (damage - healed > 0) && (left >= hoursPerRoll) ) {
    healed += rolls[i++] ?? 0;
    left -= hoursPerRoll;
  }
  healed = Math.min(damage, healed);
  const woundsHealed = ((damage - healed > 0) || !hoursPerWound) ? 0 : Math.min(wounds, Math.floor(left / hoursPerWound));
  return { damage: healed, wounds: woundsHealed, periods: i };
}

/* -------------------------------------------- */
/*  Mental health (pp. 209-215)                 */
/* -------------------------------------------- */

/** Stressful Experiences table (p. 215): stress value of each situation. */
export const STRESSFUL_EXPERIENCES = {
  motivationFailure: "floor(1d10 / 2)", helplessness: "floor(1d10 / 2)", betrayal: "floor(1d10 / 2)",
  isolation: "floor(1d10 / 2)", violenceViewing: "floor(1d10 / 2)", violenceCommitting: "1d10", deathImminent: "1d10",
  deathXP: "1d10", lovedOneLost: "floor(1d10 / 2)", lovedOneDying: "1d10 + 2", lovedOneKilled: "1d10 + 5",
  murderScene: "1d10", tortureViewing: "1d10 + 2", tortureModerate: "2d10 + 3", tortureSevere: "3d10 + 5",
  aliensNonSentient: "floor(1d10 / 2)", aliensSentient: "1d10", aliensHostile: "1d10 + 3",
  advancedTech: "floor(1d10 / 2)", exsurgentTech: "floor(1d10 / 2)", exsurgentInfected: "1d10",
  exsurgentLife: "1d10 + 3", psiEpsilon: "1d10 + 2"
};

/** Hardening (p. 214): 5 successful tests against one source make the character immune to it, at -1 Moxie. */
export const HARDENING_SUCCESSES = 5;

/**
 * Stress of a Willpower Stress Test: all of it on a failure, none on a success; with the optional rule of X-Risks
 * (p. 165), a success halves it (round down).
 */
export const stressTaken = (sv, success, { halfOnSuccess = false } = {}) => (success ? (halfOnSuccess ? Math.floor(sv / 2) : 0) : sv);

/**
 * The derangement a new trauma brings (p. 209): the 1st trauma a minor one, the 2nd and 3rd upgrade it (moderate,
 * major) or add a minor one, a 4th or more makes the major derangement a disorder.
 * @param {number} traumas  The character's traumas, the new one included
 */
export function derangementFor(traumas) {
  if ( traumas >= 4 ) return "disorder";
  return ["minor", "minor", "moderate", "major"][Math.max(0, traumas)];
}
/** Derangements last 1d10 ÷ 2 hours (round down), or until psychiatric help (p. 210). */
export const DERANGEMENT_HOURS = "floor(1d10 / 2)";

/**
 * Natural mental healing (p. 215): every month without new stress, a WIL x 3 Test heals 1d10 stress, or 1 trauma once
 * all stress is gone.
 * @returns {{stress: number, traumas: number}}
 */
export function naturalMentalHealing(result, { stress, traumas, rolled }) {
  if ( !result.success ) return { stress: 0, traumas: 0 };
  if ( stress > 0 ) return { stress: Math.min(stress, rolled), traumas: 0 };
  return { stress: 0, traumas: Math.min(traumas, 1) };
}

/** Psychotherapy (p. 215): a successful session heals 1 stress per hour, then 1 trauma per 8 hours, 1 disorder per 40. */
export const THERAPY_HOURS = { stress: 1, trauma: 8, disorder: 40 };
export const THERAPY_PSYCHOSURGERY_BONUS = 30;
/** Modifier of a psychotherapy session's test: +30 after successful psychosurgery, -10 per disorder. */
export const therapyModifier = ({ psychosurgery = false, disorders = 0 }) => (psychosurgery ? THERAPY_PSYCHOSURGERY_BONUS : 0) - (10 * disorders);

/**
 * What a successful psychotherapy session of `hours` heals: stress first, then traumas (only once all stress is
 * gone), then disorders (only once all traumas are gone).
 */
export function therapyHealing(hours, { stress, traumas, disorders }) {
  const s = Math.min(stress, Math.floor(hours / THERAPY_HOURS.stress));
  let left = hours - (s * THERAPY_HOURS.stress);
  const t = (stress - s > 0) ? 0 : Math.min(traumas, Math.floor(left / THERAPY_HOURS.trauma));
  left -= t * THERAPY_HOURS.trauma;
  const d = ((stress - s > 0) || (traumas - t > 0)) ? 0 : Math.min(disorders, Math.floor(left / THERAPY_HOURS.disorder));
  return { stress: s, traumas: t, disorders: d };
}

/* -------------------------------------------- */
/*  Psychosurgery (pp. 229-233)                 */
/* -------------------------------------------- */

/**
 * Psychosurgery procedures (pp. 231-233): the procedure modifier for each degree, the stress value, the timeframe.
 * An SV of "" means none.
 */
export const PROCEDURES = {
  behavioralControl: { degrees: { limit: -10, block: -20, expunge: -30 }, sv: "ceil(1d10 / 2)", timeframe: "1 week" },
  behavioralMasking: { degrees: { standard: -20 }, sv: "ceil(1d10 / 2)", timeframe: "1 week" },
  deepLearning: { degrees: { standard: 20 }, sv: "", timeframe: "skill learning time ÷ 2" },
  emotionalControl: { degrees: { limit: -10, block: -20, expunge: -30 }, sv: "ceil(1d10 / 2) + 2", timeframe: "1 week" },
  interrogation: { degrees: { standard: 30 }, sv: "1d10", timeframe: "1 week" },
  memoryEditing: { degrees: { willing: -10, forced: -30 }, sv: "ceil(1d10 / 2)", timeframe: "1 week (2 adding)" },
  personalityEditing: { degrees: { minor: -10, moderate: -20, major: -30 }, sv: "ceil(1d10 / 2) + 3", timeframe: "1 week" },
  psychotorture: { degrees: { standard: 30 }, sv: "1d10", timeframe: "per day" },
  psychotherapy: { degrees: { standard: 0 }, sv: "", timeframe: "variable" },
  skillImprint: { degrees: { standard: 0 }, sv: "1", timeframe: "1 week per +10" },
  skillSuppression: { degrees: { standard: -10 }, sv: "1", timeframe: "1 day per -10" },
  tasping: { degrees: { standard: 10 }, sv: "", timeframe: "1 day" }
};

/** Psychosurgery Modifiers table (p. 232): test modifier and SV modifier (added, or doubled). */
export const SURGERY_MODIFIERS = {
  improperDiagnosis: { test: -30, sv: 1 },
  safetyIgnored: { test: 20, double: true },
  timeAcceleration: { test: -20, sv: 2 },
  nonHuman: { test: -20, sv: 1 }
};

/**
 * Outcome of the opposed test (p. 232): the psychosurgeon's Psychosurgery against the subject's WIL x 3.
 * @param {object} surgeon  The surgeon's result and roll ({ success, margin, value })
 * @param {object|null} subject  The subject's result, null when the subject does not resist
 * @returns {{effect: "permanent"|"temporary"|"none", weeks: number}}
 */
export function surgeryOutcome(surgeon, subject) {
  if ( !surgeon.success ) return { effect: "none", weeks: 0 };
  if ( !subject || !subject.success ) return { effect: "permanent", weeks: 0 };
  // Both succeed: the higher roll wins; the surgeon's win lasts 1 week per 10 points of MoS
  if ( surgeon.value > subject.value ) return { effect: "temporary", weeks: Math.max(1, Math.floor(surgeon.margin / 10)) };
  return { effect: "none", weeks: 0 };
}

/**
 * Stress on the subject (p. 232), whatever the outcome: halved on an Excellent Success, none on a critical success,
 * doubled on a Severe Failure, plus a trauma on a critical failure; then the modifiers of the conditions.
 * @param {number} rolled  The procedure's SV, rolled
 * @param {object} surgeon The surgeon's test result
 * @param {string[]} conditions  Keys of SURGERY_MODIFIERS
 * @returns {{sv: number, trauma: boolean}}
 */
export function surgeryStress(rolled, surgeon, conditions = []) {
  let sv = rolled + conditions.reduce((sum, k) => sum + (SURGERY_MODIFIERS[k]?.sv ?? 0), 0);
  if ( conditions.some(k => SURGERY_MODIFIERS[k]?.double) ) sv *= 2;
  switch ( surgeon.outcome ) {
    case "criticalSuccess": return { sv: 0, trauma: false };
    case "excellentSuccess": return { sv: Math.floor(sv / 2), trauma: false };
    case "severeFailure": return { sv: sv * 2, trauma: false };
    case "criticalFailure": return { sv, trauma: true };
  }
  return { sv, trauma: false };
}

/** Test modifier of a procedure and its conditions. */
export function surgeryModifier(procedure, degree, conditions = []) {
  const p = PROCEDURES[procedure];
  const base = p?.degrees[degree] ?? Object.values(p?.degrees ?? { x: 0 })[0];
  return base + conditions.reduce((sum, k) => sum + (SURGERY_MODIFIERS[k]?.test ?? 0), 0);
}

export const TEMPORARY_SECONDS_PER_WEEK = 7 * 24 * HOUR;
