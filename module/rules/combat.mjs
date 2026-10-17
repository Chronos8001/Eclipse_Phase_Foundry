/**
 * Combat rules of the Core Rulebook (pp. 191-207), as pure functions with no Foundry dependency
 * so that tools/test-rules.mjs can check them against the book's examples.
 */

/** Firing modes (p. 198): shots used per attack and attacks allowed per Complex Action. */
export const FIRING_MODES = {
  SS: { ammo: 1, attacks: 1 },
  SA: { ammo: 1, attacks: 2 },
  BF: { ammo: 3, attacks: 2, concentrated: "1d10" },
  FA: { ammo: 10, attacks: 1, concentrated: "1d10 + 10" },
  // Suppressive fire (p. 204) is a full-auto option that covers an area
  SUP: { ammo: 20, attacks: 1, requires: "FA" }
};

/** Range band modifiers (Combat Modifiers table, p. 193). */
export const RANGE_MODIFIERS = { pointBlank: 10, short: 0, medium: -10, long: -20, extreme: -30 };
export const POINT_BLANK = 2;

/** Situational modifiers of the Combat Modifiers table (p. 193). Values the dialog offers as checkboxes. */
export const COMBAT_MODIFIERS = {
  general: {
    offHand: -20, superiorPosition: 20, touchOnly: 20, calledShot: -10, twoHandedOneHand: -20,
    smallTarget: -10, verySmallTarget: -30, largeTarget: 10, veryLargeTarget: 30,
    visibilityMinor: -10, visibilityMajor: -20, blindAttack: -30
  },
  melee: { reachAdvantage: 10, charging: -10, receivingCharge: 20 },
  ranged: {
    smartlink: 10, attackerInCover: -10, attackerRunning: -20, attackerInMelee: -30,
    coverMinor: -10, coverModerate: -20, coverMajor: -30, proneAndFar: -10, defenderHidden: -60,
    aimedQuick: 10, aimedComplex: 30, sweepingFire: 10, indirectFire: -30
  }
};

/** Mutually exclusive groups: only the strongest checked modifier of each group applies. */
export const EXCLUSIVE_MODIFIERS = [
  ["smallTarget", "verySmallTarget", "largeTarget", "veryLargeTarget"],
  ["visibilityMinor", "visibilityMajor", "blindAttack"],
  ["coverMinor", "coverModerate", "coverMajor"],
  ["aimedQuick", "aimedComplex"]
];

/** Extra targets with the same action: -20 per extra target (p. 202). */
export const MULTIPLE_TARGET_PENALTY = -20;
/** Full defense (p. 198). */
export const FULL_DEFENSE_BONUS = 30;
/** Each armor layer worn after the first (p. 194). */
export const LAYERED_ARMOR_PENALTY = -20;

/** Firing modes listed on a weapon ("SA, BF, FA"). */
export function parseModes(text) {
  const modes = String(text ?? "").toUpperCase().match(/\b(SS|SA|BF|FA)\b/g) ?? [];
  return [...new Set(modes)];
}

/** Modes a weapon can actually fire, suppressive fire included when full auto is available. */
export function availableModes(text) {
  const modes = parseModes(text);
  if ( modes.includes("FA") ) modes.push("SUP");
  return modes;
}

/** Shots a firing mode uses; single shots for weapons without modes (p. 198). */
export function ammoPerAttack(mode) {
  return FIRING_MODES[mode]?.ammo ?? 1;
}

/** Munition sizes a launcher fires ("micro, mini" -> ["micro", "mini"]). */
export function launcherSizes(text) {
  const sizes = String(text ?? "").toLowerCase().match(/\b(micro|mini|standard)\b/g) ?? [];
  return [...new Set(sizes)];
}

/**
 * Maximum distance of each range band, in meters.
 * Accepts "10 / 25 / 40 / 60" or thrown-weapon bands relative to SOM ("SOM ÷ 5 / SOM ÷ 2 / SOM / SOM × 3").
 * @returns {number[]|null} [short, medium, long, extreme] or null when the weapon has no range
 */
export function parseRange(text, som = 0) {
  const parts = String(text ?? "").split("/").map(p => p.trim()).filter(p => p);
  if ( parts.length < 4 ) return null;
  const bands = parts.slice(0, 4).map(part => {
    const m = part.match(/^SOM(?:\s*([÷×x*/])\s*(\d+))?$/i);
    if ( m ) {
      const factor = Number(m[2] ?? 1);
      const op = m[1];
      return Math.ceil(!op ? som : ["÷", "/"].includes(op) ? som / factor : som * factor);
    }
    const n = Number(part.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && part.match(/\d/) ? n : null;
  });
  return bands.every(b => b !== null) ? bands : null;
}

/** Range band for a distance in meters: pointBlank, short, medium, long, extreme or beyond. */
export function rangeBand(distance, bands) {
  if ( !bands ) return "short";
  if ( distance <= POINT_BLANK ) return "pointBlank";
  const names = ["short", "medium", "long", "extreme"];
  const i = bands.findIndex(max => distance <= max);
  return i < 0 ? "beyond" : names[i];
}

/** Damage bonus of an Excellent Success (p. 191): +5 at MoS 30+, +10 at MoS 60+. */
export function excellentBonus(margin) {
  return margin >= 60 ? 10 : (margin >= 30 ? 5 : 0);
}

/**
 * Opposed Test (p. 119). Each side is an evaluated test: { success, critical, value }.
 * @returns {"attacker"|"defender"|"deadlock"}
 */
export function opposedWinner(a, b) {
  if ( a.success && !b.success ) return "attacker";
  if ( b.success && !a.success ) return "defender";
  if ( !a.success && !b.success ) return "deadlock";
  // Critical successes trump high rolls
  if ( a.critical !== b.critical ) return a.critical ? "attacker" : "defender";
  if ( a.value === b.value ) return "deadlock";
  return a.value > b.value ? "attacker" : "defender";
}

/** Does an attack hit? An undefended attack hits on a success; a deadlock is a miss (p. 191). */
export function attackHits(attack, defense = null) {
  if ( !attack.success ) return false;
  if ( !defense ) return true;
  return opposedWinner(attack, defense) === "attacker";
}

/**
 * Build the damage formula of an attack.
 * @param {object} o
 * @param {string} o.dv                  Weapon DV formula ("2d10 + 4")
 * @param {number} [o.db=0]              Melee/thrown damage bonus (SOM ÷ 10)
 * @param {string} [o.mode]              Firing mode used (SS, SA, BF, FA)
 * @param {boolean} [o.concentrated]     BF/FA fired at a single target
 * @param {string} [o.cone]              Range band of a cone weapon (+1d10 short, -1d10 long/extreme)
 * @param {object} [o.munition]          { kind: grenade|seeker, size: micro|mini|standard }
 * @param {boolean} [o.charging]         Charging melee attacker: +1d10 (p. 197)
 * @param {number} [o.extraWeapons=0]    Extra melee weapons: +1d10 each, max +3d10 (p. 206)
 * @param {boolean} [o.beamConcentrated] Concentrated beam fire: DV × 1.5, round up (p. 194)
 * @param {number} [o.excellent=0]       Excellent Success bonus (+5/+10)
 * @param {object} [o.ammo]            Kinetic ammunition: { dv, half, noDamage } (p. 337)
 */
export function damageFormula(o) {
  if ( !o.dv || o.ammo?.noDamage ) return "";
  let base = String(o.dv);
  // Ammunition DV modifiers add to the weapon's base DV; "half" ammunition halves it (round up)
  if ( o.ammo?.dv ) base = `${base} ${/^[+-]/.test(o.ammo.dv) ? o.ammo.dv.replace(/^([+-])/, "$1 ") : `+ ${o.ammo.dv}`}`;
  if ( o.ammo?.half ) base = `ceil((${base}) / 2)`;
  const size = munitionDamage(o.munition);
  if ( size.multiplier !== 1 ) base = `(${base}) * ${size.multiplier}`;
  if ( o.beamConcentrated ) base = `ceil((${base}) * 1.5)`;
  const dice = [];
  if ( o.concentrated && FIRING_MODES[o.mode]?.concentrated ) dice.push(FIRING_MODES[o.mode].concentrated);
  if ( o.cone === "short" || o.cone === "pointBlank" ) dice.push("1d10");
  if ( o.charging ) dice.push("1d10");
  const extra = Math.min(3, Math.max(0, o.extraWeapons ?? 0));
  if ( extra ) dice.push(`${extra}d10`);
  let formula = [base, ...dice].join(" + ");
  if ( (o.cone === "long") || (o.cone === "extreme") ) formula += " - 1d10";
  if ( size.minus ) formula += ` - ${size.minus}`;
  if ( o.db ) formula += ` + ${o.db}`;
  if ( o.excellent ) formula += ` + ${o.excellent}`;
  return formula;
}

/**
 * Grenade and missile sizes (p. 341). The listed effects are for standard grenades and minimissiles:
 * minigrenades and micromissiles do -1d10 and halve static radii; standard missiles double DV and radii.
 */
export function munitionDamage(munition) {
  const kind = munition?.kind;
  const size = munition?.size;
  if ( (kind === "grenade") && (size === "mini") ) return { multiplier: 1, minus: "1d10", radius: 0.5 };
  if ( kind === "seeker" ) {
    if ( size === "micro" ) return { multiplier: 1, minus: "1d10", radius: 0.5 };
    if ( size === "standard" ) return { multiplier: 2, minus: "", radius: 2 };
  }
  return { multiplier: 1, minus: "", radius: 1 };
}

/**
 * Damage of an area effect weapon at some distance from the epicenter (p. 193).
 * @param {number} total     Rolled damage at the epicenter
 * @param {number} distance  Meters from the epicenter
 * @param {object} area      { shape: blast|uniform, radius }
 * @param {number} [falloff=2] Damage lost per meter (HEAP: 4)
 */
export function blastDamage(total, distance, area, falloff = 2) {
  const d = Math.max(0, Math.floor(distance));
  if ( area?.shape === "uniform" ) return Math.max(0, total - (Math.max(0, d - (area.radius ?? 0)) * falloff));
  return Math.max(0, total - (d * falloff));
}

/** Scatter of a missed blast attack (p. 204): d10 meters (0 = 10), ×2 at MoF 30+, ×3 at MoF 60+. */
export function scatterDistance(d10, marginOfFailure) {
  const meters = (d10 % 10) || 10;
  const factor = marginOfFailure > 60 ? 3 : (marginOfFailure > 30 ? 2 : 1);
  return meters * factor;
}

/** Armor left after armor penetration (p. 192). */
export function modifiedArmor(armor, ap = 0, armorDefeating = false) {
  return armorDefeating ? 0 : Math.max(0, armor + ap);
}

/** Wounds from one hit: one per full Wound Threshold of damage (p. 207). */
export function woundsFrom(damage, threshold) {
  return threshold > 0 ? Math.floor(Math.max(0, damage) / threshold) : 0;
}

/**
 * Outcome of the DUR + Energy Armor test against a shock attack (p. 204).
 * @param {{success: boolean, margin: number}} test
 */
export function shockOutcome(test) {
  if ( test.success ) return { incapacitated: 0, halfDamage: true, modifier: -30, recovery: "turn" };
  return { incapacitated: Math.max(3, Math.floor(test.margin / 10)), halfDamage: false, modifier: -30, recovery: "minute" };
}

/** Target number of the shock test: current DUR (reduced by damage) + energy armor (p. 204). */
export function shockTarget(durability, damage, energyArmor) {
  return Math.max(0, durability - damage) + energyArmor;
}

/** DV inflicted by a shock weapon: half on a successful shock test (rounded up, like the stunner's 1d10 ÷ 2). */
export function shockedDamage(dv, outcome) {
  return outcome?.halfDamage ? Math.ceil(dv / 2) : dv;
}

/** The shock modifier fades by 10 per step (Action Turn or minute) until it is gone (p. 204). */
export const SHOCK_MODIFIER = -30;
export function fadeModifier(modifier, step = 10) {
  return Math.min(0, modifier + step);
}

/**
 * Initiative (Core p. 188): 1d100 + INIT, INIT = (INT + REF) x 2. The supplements (Transhuman p. 97, X-Risks) roll
 * 1d10 + INIT with INIT = (INT + REF) / 5: the same score on a tenth of the scale, so bonuses of +1 there are +10 here.
 */
export const INITIATIVE_RULES = {
  core: { formula: "1d100 - 1 + @initiative", scale: 1 },
  supplements: { formula: "1d10 + @initiative", scale: 10 }
};

/** Initiative score added to the roll: INIT less the wound and trauma modifiers, on the rule's scale (round down). */
export function initiativeScore(init, penalty, rule = "core") {
  return Math.floor((init - penalty) / (INITIATIVE_RULES[rule] ?? INITIATIVE_RULES.core).scale);
}

/** Action Turns per minute (an Action Turn lasts 3 seconds, p. 189). */
export const TURNS_PER_MINUTE = 20;

/**
 * Bleeding (p. 207): a wounded biomorph whose damage exceeds its Durability loses 1 damage point per Action Turn.
 * @param {object} o  { biological, wounds, damage, durability }
 */
export function isBleeding({ biological, wounds, damage, durability }) {
  return biological && (wounds > 0) && (damage > durability);
}

/** Fire damage after some Action Turns of burning (p. 198): 1d10 ÷ 2, then 1d10, 2d10, 3d10, then +5 every 5 turns. */
export function fireDamage(turns) {
  const stage = Math.floor(Math.max(0, turns) / 5);
  if ( stage === 0 ) return "ceil(1d10 / 2)";
  if ( stage <= 3 ) return `${stage}d10`;
  return `3d10 + ${(stage - 3) * 5}`;
}

/**
 * Scatter of a missed blast (p. 204): offset of the epicenter from the target, in grid units.
 * @param {number} distance   Scatter distance in meters
 * @param {number} d8         Direction: 1 = straight beyond the target (away from the attacker), clockwise by 45°
 * @param {number} [heading]  Angle of the line of fire in radians (0 = east, canvas y axis pointing down)
 * @returns {{dx: number, dy: number}}
 */
export function scatterOffset(distance, d8, heading = -Math.PI / 2) {
  const angle = heading + (((d8 - 1) % 8) * Math.PI / 4);
  return { dx: Math.round(distance * Math.cos(angle) * 100) / 100, dy: Math.round(distance * Math.sin(angle) * 100) / 100 };
}

/** Falling damage (p. 197): 1d10 at 1-2 m, 2d10 at 3-5 m, 3d10 at 6-8 m, +1 per meter beyond. */
export function fallingDamage(meters) {
  const m = Math.floor(meters);
  if ( m < 1 ) return "";
  if ( m <= 2 ) return "1d10";
  if ( m <= 5 ) return "2d10";
  if ( m <= 8 ) return "3d10";
  return `3d10 + ${m - 8}`;
}

/** Kinetic armor protects against falls at half its value, round down (p. 197). */
export function fallingArmor(kinetic) {
  return Math.floor(kinetic / 2);
}

/** Modifier from the wearer's armor layers (accessories and synthmorph frames excluded). */
export function layeredArmorModifier(layers) {
  return layers > 1 ? (layers - 1) * LAYERED_ARMOR_PENALTY : 0;
}

/**
 * Total of the situational modifiers checked in the attack dialog.
 * @param {string[]} keys       Checked modifier keys of COMBAT_MODIFIERS
 * @param {object} [extra]
 * @param {number} [extra.extraTargets=0] Additional targets with the same action
 */
export function situationalModifier(keys, { extraTargets = 0 } = {}) {
  const values = Object.assign({}, ...Object.values(COMBAT_MODIFIERS));
  const chosen = new Set(keys.filter(k => k in values));
  for ( const group of EXCLUSIVE_MODIFIERS ) {
    const inGroup = group.filter(k => chosen.has(k));
    if ( inGroup.length < 2 ) continue;
    // Keep the most extreme entry of the group
    inGroup.sort((a, b) => Math.abs(values[b]) - Math.abs(values[a]));
    inGroup.slice(1).forEach(k => chosen.delete(k));
  }
  let total = 0;
  for ( const k of chosen ) total += values[k];
  return total + (Math.max(0, extraTargets) * MULTIPLE_TARGET_PENALTY);
}
