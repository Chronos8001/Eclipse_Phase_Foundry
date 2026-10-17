/**
 * Character creation and advancement costs (Core pp. 134-136, 152-153): Customization Points at creation and Rez
 * Points afterward use the same rates. Pure functions, checked in tools/test-rules.mjs.
 */

/** Free points of a new character (p. 134). */
export const FREE = { aptitudes: 105, moxie: 1, credit: 5000, rep: 50 };
/** Customization Points of a new character (p. 135); the gamemaster may set 700 to 1,200. */
export const DEFAULT_CP = 1000;

export const COST = { moxie: 15, aptitude: 10, sleight: 5, specialization: 5, rep: 1, credit: 1 };
/** A Package Point is worth 100 CP (Transhuman p. 14). */
export const CP_PER_PP = 100;
/** Every 10 points of Rep, every 1,000 credit cost 1 point. */
export const REP_PER_POINT = 10;
export const CREDIT_PER_POINT = 1000;

export const LIMITS = {
  aptitudeMin: 5, aptitudeMax: 30, moxieMax: 10,
  // Creation: skills up to 80, Rep scores up to 80, at most 35 CP on Rep, 100 CP on credit, 50 CP of positive
  // traits, 50 of negative traits (25 of negative morph traits), 5 psi-chi and 5 psi-gamma sleights
  creationSkillMax: 80, skillMax: 99, creationRepMax: 80, repCp: 35, creditCp: 100,
  positiveTraits: 50, negativeTraits: 50, negativeMorphTraits: 25, sleightsPerType: 5,
  activeMinimum: 400, knowledgeMinimum: 300, specializationMinimum: 30, expert: 60
};

/** Cost of raising a skill from one rating to another: 1 point per point up to 60, 2 per point above (p. 135). */
export function skillCost(from, to) {
  let cost = 0;
  for ( let rating = from + 1; rating <= to; rating++ ) cost += (rating > LIMITS.expert) ? 2 : 1;
  return cost;
}

/**
 * Rez Point cost of raising an aptitude (p. 152): 10 RP per point, plus 1 RP for each linked skill each point
 * raises over 60.
 * @param {number} points          Points of aptitude bought
 * @param {number[]} linkedTotals  Current totals of the skills linked to the aptitude
 */
export function aptitudeRezCost(points, linkedTotals = []) {
  let cost = 0;
  for ( let step = 1; step <= points; step++ ) {
    cost += COST.aptitude + linkedTotals.filter(total => total + step > LIMITS.expert).length;
  }
  return cost;
}

/**
 * Customization Points a character's sheet stands for (Spend Customization Points, pp. 135-136).
 * @param {object} c
 * @param {number[]} c.aptitudes   Ego aptitude bases
 * @param {number} c.moxie         Moxie maximum
 * @param {{category: string, aptitude: number, ranks: number, free: number, specialized: boolean}[]} c.skills
 *   aptitude: the linked aptitude's ego value; ranks above it; free: points given by the background, faction or
 *   native tongue
 * @param {number[]} c.rep         Rep scores
 * @param {{cost: number, negative: boolean, morph: boolean}[]} c.traits  CP cost (or bonus) of each trait bought
 * @param {number} c.morph         CP cost of the starting morph
 * @param {number} c.sleights      Sleights bought
 * @param {number} [c.packages=0]  Package Points of the packages taken (their skills are free ranks)
 * @param {number} [c.other=0]     Other CP (credit...) noted by the player
 * @returns {{lines: object, spent: number, gained: number, warnings: string[]}}  warnings: i18n keys with data
 */
export function creationCost({ aptitudes, moxie, skills, rep, traits, morph, sleights, packages = 0, other = 0 }) {
  const warnings = [];
  const aptitudePoints = aptitudes.reduce((a, b) => a + b, 0) - FREE.aptitudes;
  if ( aptitudes.some(a => a < LIMITS.aptitudeMin) ) warnings.push({ key: "aptitudeMin" });
  if ( aptitudes.some(a => a > LIMITS.aptitudeMax) ) warnings.push({ key: "aptitudeMax" });
  if ( aptitudePoints < 0 ) warnings.push({ key: "aptitudesUnspent", data: { points: -aptitudePoints } });

  const skillLine = category => skills.filter(s => s.category === category).reduce((sum, s) => {
    const start = s.aptitude + Math.min(s.free, s.ranks);
    return sum + skillCost(start, s.aptitude + s.ranks);
  }, 0);
  const active = skillLine("active");
  const knowledge = skillLine("knowledge");
  if ( active < LIMITS.activeMinimum ) warnings.push({ key: "activeMinimum", data: { cp: active } });
  if ( knowledge < LIMITS.knowledgeMinimum ) warnings.push({ key: "knowledgeMinimum", data: { cp: knowledge } });
  if ( skills.some(s => s.aptitude + s.ranks > LIMITS.creationSkillMax) ) warnings.push({ key: "skillMax" });

  const repPoints = Math.max(0, rep.reduce((a, b) => a + b, 0) - FREE.rep);
  const repCp = Math.ceil(repPoints / REP_PER_POINT) * COST.rep;
  if ( repCp > LIMITS.repCp ) warnings.push({ key: "repCp" });
  if ( rep.some(r => r > LIMITS.creationRepMax) ) warnings.push({ key: "repMax" });

  const positive = traits.filter(t => !t.negative).reduce((sum, t) => sum + t.cost, 0);
  const negative = traits.filter(t => t.negative).reduce((sum, t) => sum + t.cost, 0);
  const negativeMorph = traits.filter(t => t.negative && t.morph).reduce((sum, t) => sum + t.cost, 0);
  if ( positive > LIMITS.positiveTraits ) warnings.push({ key: "positiveTraits" });
  if ( negative > LIMITS.negativeTraits ) warnings.push({ key: "negativeTraits" });
  if ( negativeMorph > LIMITS.negativeMorphTraits ) warnings.push({ key: "negativeMorphTraits" });

  const lines = {
    aptitudes: Math.max(0, aptitudePoints) * COST.aptitude,
    moxie: Math.max(0, moxie - FREE.moxie) * COST.moxie,
    active, knowledge,
    specializations: skills.filter(s => s.specialized).length * COST.specialization,
    rep: repCp,
    positiveTraits: positive,
    morph,
    sleights: sleights * COST.sleight,
    packages: packages * CP_PER_PP,
    other
  };
  const spent = Object.values(lines).reduce((a, b) => a + b, 0);
  return { lines, spent, gained: negative, warnings };
}

/**
 * Rez Point cost of an advancement (Spending Rez Points, p. 152), or an error key when the rules forbid it.
 * @param {string} kind  aptitude | skill | specialization | moxie | rep | credit | sleight
 * @param {object} o     { from, points, linkedTotals, total, specialized, psi }
 * @returns {{cost: number}|{error: string}}
 */
export function rezCost(kind, { from = 0, points = 1, linkedTotals = [], total = 0, specialized = false, psi = false } = {}) {
  points = Math.max(0, Math.floor(points));
  if ( !points ) return { error: "nothing" };
  switch ( kind ) {
    case "aptitude":
      if ( from + points > LIMITS.aptitudeMax ) return { error: "aptitudeMax" };
      return { cost: aptitudeRezCost(points, linkedTotals) };
    case "skill":
      if ( total + points > LIMITS.skillMax ) return { error: "skillMax" };
      return { cost: skillCost(total, total + points) };
    case "specialization":
      if ( specialized ) return { error: "oneSpecialization" };
      if ( total < LIMITS.specializationMinimum ) return { error: "specializationMinimum" };
      return { cost: COST.specialization };
    case "moxie":
      if ( from + points > LIMITS.moxieMax ) return { error: "moxieMax" };
      return { cost: points * COST.moxie };
    case "rep":
      // Each RP is +10 Rep in one network, once per month (p. 153)
      return { cost: points * COST.rep };
    case "credit":
      return { cost: points * COST.credit };
    case "sleight":
      if ( !psi ) return { error: "noPsi" };
      return { cost: points * COST.sleight };
  }
  return { error: "nothing" };
}
