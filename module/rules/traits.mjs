/**
 * Traits whose effect is a fixed number (Core pp. 145-152, Transhuman pp. 82-94, Panopticon pp. 145-148), applied by
 * the actor's data preparation from the trait's key and level. Situational bonuses (social tests against a faction,
 * resisting fear...) stay in the trait's description; the ones the dialogs can tell (resleeving, merging,
 * psychosurgery, addiction) are read by those dialogs with traitLevel(). Pure functions, checked in
 * tools/test-rules.mjs.
 */
import { SKILLS } from "../config.mjs";

const PHYSICAL_APTITUDES = ["coo", "ref", "som"];
/** Skills of the physical aptitudes: "physical actions" (as for the Integration Test penalty). */
export const PHYSICAL_SKILLS = Object.entries(SKILLS).filter(([, c]) => PHYSICAL_APTITUDES.includes(c.aptitude)).map(([k]) => k);

/**
 * Effect of each trait by key, as a function of its level. The fields:
 * dur, luc, init: added to the stat; woundsIgnored, traumasIgnored: modifiers ignored; woundPenalty: extra penalty
 * per wound; aptitudeMax: added to (or, with cap, a ceiling of) aptitude maximums; skillMods: added to skills;
 * noDamageBonus: no damage bonus in melee.
 */
export const TRAIT_EFFECTS = {
  // Core Rulebook
  tough: level => ({ dur: 5 * level }),                                     // p. 148: +5 DUR per level
  frail: level => ({ dur: -5 * level }),                                    // p. 149: -5 DUR per level
  painTolerance: level => ({ woundsIgnored: level }),                       // p. 146: 1 or 2 wounds ignored
  lowPainTolerance: () => ({ woundPenalty: 10 }),                           // p. 150: -20 per wound
  aged: () => ({ aptitudeMax: { all: -5 }, skillMods: physical(-10) }),     // p. 148
  unfit: level => ({ aptitudeMax: { coo: -5 * level, ref: -5 * level, som: -5 * level } }), // p. 152
  animalEmpathy: () => ({ skillMods: { animalHandling: 10 } }),            // p. 145
  // Transhuman
  frailSanity: level => ({ luc: -5 * level }),                              // p. 90: -5 LUC per level
  traumaTolerance: level => ({ traumasIgnored: level }),                    // p. 86: 1 or 2 traumas ignored
  curbedIntelligence: () => ({ aptitudeCap: { cog: 15 } }),                 // p. 88
  botchedUplift: () => ({ aptitudeCap: { cog: 10, sav: 10 } }),             // p. 87
  // +1 on the 1d10 Initiative of Transhuman = +10 on the Core's d100 scale (INIT = (INT + REF) x 2)
  heightenedInstinct: () => ({ init: 10 }),                                 // p. 84
  impairedProprioception: () => ({ skillMods: { fray: -10 } }),             // p. 89
  // Panopticon
  socialButterfly: () => ({ skillMods: { networking: 10 } }),               // p. 145
  shutIn: () => ({ skillMods: { networking: -10 } }),                       // p. 147
  impairedBalance: level => ({ skillMods: { climbing: -10 * level, freerunning: -10 * level } }), // p. 145
  weakGrip: () => ({ noDamageBonus: true })                                 // p. 148
};

function physical(value) {
  return Object.fromEntries(PHYSICAL_SKILLS.map(k => [k, value]));
}

/**
 * Sum of the effects of some traits.
 * @param {{key: string, level: number}[]} traits
 */
export function traitBonuses(traits) {
  const out = { dur: 0, luc: 0, init: 0, woundsIgnored: 0, traumasIgnored: 0, woundPenalty: 0, aptitudeMax: {}, aptitudeCap: {},
    skillMods: {}, noDamageBonus: false };
  for ( const t of traits ) {
    const fx = TRAIT_EFFECTS[t.key]?.(Math.max(1, t.level ?? 1));
    if ( !fx ) continue;
    for ( const k of ["dur", "luc", "init", "woundsIgnored", "traumasIgnored", "woundPenalty"] ) out[k] += fx[k] ?? 0;
    for ( const [k, v] of Object.entries(fx.aptitudeMax ?? {}) ) out.aptitudeMax[k] = (out.aptitudeMax[k] ?? 0) + v;
    for ( const [k, v] of Object.entries(fx.aptitudeCap ?? {}) ) out.aptitudeCap[k] = Math.min(out.aptitudeCap[k] ?? Infinity, v);
    for ( const [k, v] of Object.entries(fx.skillMods ?? {}) ) out.skillMods[k] = (out.skillMods[k] ?? 0) + v;
    out.noDamageBonus ||= !!fx.noDamageBonus;
  }
  return out;
}

/** An aptitude maximum changed by the traits (see traitBonuses). */
export function traitAptitudeMax(max, key, bonuses) {
  const changed = max + (bonuses.aptitudeMax.all ?? 0) + (bonuses.aptitudeMax[key] ?? 0);
  return Math.max(0, Math.min(changed, bonuses.aptitudeCap[key] ?? Infinity));
}

/* -------------------------------------------- */
/*  Traits read by the dialogs                  */
/* -------------------------------------------- */

/** Traits whose effect the dialogs apply (the others of TRAIT_EFFECTS apply to the sheet's statistics). */
export const DIALOG_TRAITS = ["phoenix", "egoPlasticity", "malleableMind", "anomalousMind", "drugFiend",
  "adaptability", "morphingDisorder", "psi", "psiDefense", "psiVulnerability"];

/** Whether the system applies a trait's effect by itself. */
export const isAutomated = key => (key in TRAIT_EFFECTS) || DIALOG_TRAITS.includes(key);

/**
 * CP cost of each level of a trait, from its cost text ("Cost: 10 (Level 1) or 20 (Level 2) CP", "Bonus: 5 CP (Minor),
 * 10 CP (Moderate), or 20 CP (Major)"); empty for a trait without levels.
 */
export function levelCosts(costText) {
  const text = String(costText ?? "");
  if ( !/Level|Minor|Moderate|Major/.test(text) ) return [];
  return [...text.replace(/Level \d+/g, "").matchAll(/\d+/g)].map(m => Number(m[0]));
}

/** Highest level of a trait among some items (0 without it). */
export const traitLevel = (items, key) => Math.max(0, ...[...items].filter(i => (i.type === "trait") && (i.system.key === key))
  .map(i => i.system.level || 1));

/** Phoenix (Transhuman p. 85): +20 (Level 1) or +30 (Level 2) on Continuity Tests. */
export const phoenixBonus = level => [0, 20, 30][Math.min(2, level)] ?? 0;
/** Ego Plasticity (Transhuman p. 83): +10 per level on Merging Tests, and -1 SV per level when merging. */
export const egoPlasticity = level => ({ modifier: 10 * level, sv: -level });
/**
 * Psychosurgery on the subject (Transhuman pp. 85, 87): Malleable Mind lowers the subject's WIL x 3 by 10 per level
 * (voluntary psychosurgery only); Anomalous Mind gives -10 to the psychosurgeon and 1 more SV.
 */
export const malleableMind = (level, voluntary) => (voluntary ? -10 * level : 0);
export const ANOMALOUS_MIND = { modifier: -10, sv: 1 };
/** Drug Fiend (Transhuman p. 89): -20 on Addiction Tests. */
export const DRUG_FIEND_MODIFIER = -20;
