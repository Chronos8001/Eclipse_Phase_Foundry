/**
 * Psi rules of the Core Rulebook (pp. 220-228), as pure functions checked by tools/test-rules.mjs.
 */

/** Psi trait level needed for each kind of sleight (p. 221, p. 371). */
export const REQUIRED_LEVEL = { chi: 1, gamma: 2, epsilon: 3 };

/** Close range (p. 221): 5 meters, 10 against another async; -10 per meter beyond. */
export const CLOSE_RANGE = 5;
export const CLOSE_RANGE_VS_ASYNC = 10;
export const CLOSE_RANGE_PENALTY = -10;

/** Pods are half computer: +30 to defend against psi (p. 221). */
export const POD_DEFENSE_BONUS = 30;
/** Psi full defense (p. 222). */
export const PSI_FULL_DEFENSE_BONUS = 30;
/** Each sustained sleight: -10 to all other tests (p. 222). */
export const SUSTAINED_PENALTY = 10;

/** Targets other than sentient minds (p. 222): test modifier and extra strain. */
export const CREATURES = {
  sentient: { modifier: 0, strain: 0 },
  partial: { modifier: -20, strain: 1 },
  animal: { modifier: -30, strain: 3 },
  alien: { modifier: -20, strain: 1 }
};

/** Action Turns in each temporary duration unit (an Action Turn lasts 3 seconds). */
export const TURNS_PER_UNIT = { turns: 1, minutes: 20, hours: 1200 };

/** Only biological brains can be targeted: synthmorphs, bots and infomorphs cannot (p. 221). */
export function canBeTargeted(morphType) {
  return !["synthmorph", "infomorph"].includes(morphType);
}

/** Modifier for the distance to a Close range target. */
export function closeRangeModifier(distance, { vsAsync = false } = {}) {
  const limit = vsAsync ? CLOSE_RANGE_VS_ASYNC : CLOSE_RANGE;
  return distance > limit ? Math.ceil(distance - limit) * CLOSE_RANGE_PENALTY : 0;
}

/** Target number to resist psi: WIL x 2, +30 for pods, plus Psi Shield, traits and full defense (p. 222). */
export function psiDefenseTarget(wil, { pod = false, bonus = 0 } = {}) {
  return (wil * 2) + (pod ? POD_DEFENSE_BONUS : 0) + bonus;
}

/** Temporary sleights last WIL ÷ 5 (round up) Action Turns, minutes or hours (p. 222), in Action Turns. */
export function temporaryDuration(wil, unit = "turns") {
  return Math.ceil(wil / 5) * (TURNS_PER_UNIT[unit] ?? 1);
}

/** Maximum Armor Penetration of the Penetration sleight: Psi Assault ÷ 10 (p. 228). */
export function maxPenetration(psiAssault) {
  return Math.floor(psiAssault / 10);
}

/** Psi attacks gain +5 on an Excellent Success (Psychic Stab, Onslaught). */
export function psiExcellentBonus(margin) {
  return margin >= 30 ? 5 : 0;
}

/** Mental armor from Psi Shield: WIL ÷ 5, round up (p. 228). */
export function psiShieldArmor(wil) {
  return Math.ceil(wil / 5);
}

/**
 * Strain rolls of a sleight use (p. 223): 1d10 ÷ 2 (round up) + the sleight's modifier, once per target.
 * Sleights with a per-target modifier (Mindlink) instead roll once, +N per target after the first.
 * @param {object} o
 * @param {number} [o.mod=0]        Strain Mod of the sleight
 * @param {number} [o.targets=1]    Number of targets (1 for self sleights)
 * @param {number} [o.perTarget=0]  Extra strain per target after the first
 * @param {number} [o.ap=0]         Armor Penetration bought with the Penetration sleight (1 strain per point)
 * @param {string} [o.creature]     Key of CREATURES
 * @returns {string[]} One formula per strain roll
 */
export function strainFormulas({ mod = 0, targets = 1, perTarget = 0, ap = 0, creature = "sentient" } = {}) {
  const extra = (CREATURES[creature]?.strain ?? 0) + Math.abs(ap);
  const formula = n => (n ? `ceil(1d10 / 2) ${n > 0 ? "+" : "-"} ${Math.abs(n)}` : "ceil(1d10 / 2)");
  const count = Math.max(1, targets);
  if ( perTarget ) return [formula(mod + extra + (perTarget * (count - 1)))];
  return Array.from({ length: count }, () => formula(mod + extra));
}
