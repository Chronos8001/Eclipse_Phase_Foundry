/** Rules sanity checks against the Core Rulebook examples. Usage: node tools/test-rules.mjs */
import assert from "node:assert/strict";
import { evaluateTest, flipFlop } from "../module/dice/tests.mjs";
import * as combat from "../module/rules/combat.mjs";

const t = (value, target, moxie = null) => evaluateTest({ value, target, moxie });

// Stoya: Unarmed 65, rolls 33 -> MoS 32, excellent success (p. 118)
assert.equal(t(33, 65).margin, 32);
assert.equal(t(33, 65).outcome, "criticalSuccess"); // 33 is doubles
assert.equal(t(32, 65).outcome, "excellentSuccess");
// Dav: Free Fall 35, rolls 76 -> failure; 77 -> critical failure (p. 118)
assert.equal(t(76, 35).outcome, "severeFailure");
assert.equal(t(77, 35).outcome, "criticalFailure");
// 00 always critical success, 99 always critical failure
assert.equal(t(0, -10).outcome, "criticalSuccess");
assert.equal(t(99, 120).outcome, "criticalFailure");
assert.equal(t(99, 120).margin, 0);
// Moxie: flip-flop 83 -> 38 (p. 122), upgrade, ignore crit failure
assert.equal(flipFlop(83), 38);
assert.equal(flipFlop(5), 50);
assert.equal(t(28, 31).success, true);
assert.equal(t(40, 50, "crit").outcome, "criticalSuccess");
assert.equal(t(66, 20, "ignoreCritFail").outcome, "severeFailure");
assert.equal(t(44, 20, "ignoreCritFail").outcome, "failure");
assert.equal(t(55, 50).outcome, "criticalFailure");

// --- Opposed tests (p. 119)
// Zhou: Impersonation 57 rolls 45; Wen: Kinesics 34 + 20 = 54 rolls 39 -> both succeed, Zhou rolled higher
assert.equal(combat.opposedWinner({ ...t(45, 57), value: 45 }, { ...t(39, 54), value: 39 }), "attacker");
// Critical successes trump high rolls: 54 vs 44 (both succeed) -> 44 wins
assert.equal(combat.opposedWinner({ ...t(54, 60), value: 54 }, { ...t(44, 60), value: 44 }), "defender");
// Both fail, or same roll: deadlock (a miss in combat)
assert.equal(combat.opposedWinner({ ...t(80, 50), value: 80 }, { ...t(90, 50), value: 90 }), "deadlock");
assert.equal(combat.attackHits({ ...t(40, 50), value: 40 }, { ...t(40, 50), value: 40 }), false);

// --- Combat example: Stoya vs. the assassin (p. 192)
// Shredder in burst fire, Spray Weapons 65 + smartlink 10 = 75; Stoya's Fray 60 / 2 = 30
assert.equal(65 + combat.situationalModifier(["smartlink"]), 75);
// First shot: 08 vs Stoya's 28 -> both succeed, Stoya rolled higher: she dodges
assert.equal(combat.attackHits({ ...t(8, 75), value: 8 }, { ...t(28, 30), value: 28 }), false);
// Second shot: 20 hits, Stoya rolls 83 (fails); MoS 55 -> +5 DV
assert.equal(combat.attackHits({ ...t(20, 75), value: 20 }, { ...t(83, 30), value: 83 }), true);
assert.equal(combat.excellentBonus(t(20, 75).margin), 5);
// 2d10 + 5, +1d10 concentrated burst, +1d10 cone at short range (+5 excellent success)
assert.equal(combat.damageFormula({ dv: "2d10 + 5", mode: "BF", concentrated: true, cone: "short", excellent: 5 }),
  "2d10 + 5 + 1d10 + 1d10 + 5");
// AP -10 negates light body armor 10/10; 21 DV vs Wound Threshold 10 -> 2 wounds
assert.equal(combat.modifiedArmor(10, -10), 0);
assert.equal(combat.woundsFrom(21, 10), 2);
// Stunner: Beam Weapons 47 - 20 wounds + 10 smartlink = 37, rolls 22 (critical); assassin's Fray 48 / 2 = 24 rolls 68
assert.equal(t(22, 37).outcome, "criticalSuccess");
assert.equal(combat.attackHits({ ...t(22, 37), value: 22 }, { ...t(68, 24), value: 68 }), true);
// 1d10 / 2 rolls 8 -> 4 DV, below WT 7
assert.equal(Math.ceil(8 / 2), 4);
assert.equal(combat.woundsFrom(4, 7), 0);
// Shock: DUR 35 + armor vest energy 6 = 41, rolls 71 -> MoF 30 -> incapacitated for 3 turns
assert.equal(combat.shockTarget(35, 0, 6), 41);
assert.deepEqual(combat.shockOutcome(t(71, 41)), { incapacitated: 3, halfDamage: false, modifier: -30, recovery: "minute" });
assert.equal(combat.shockOutcome(t(30, 41)).halfDamage, true);
// Current DUR is reduced by damage taken
assert.equal(combat.shockTarget(35, 10, 6), 31);

// --- Firing modes (p. 198)
assert.deepEqual(combat.parseModes("SA, BF, FA"), ["SA", "BF", "FA"]);
assert.deepEqual(combat.availableModes("BF, FA"), ["BF", "FA", "SUP"]);
assert.equal(combat.FIRING_MODES.BF.ammo, 3);
assert.equal(combat.FIRING_MODES.FA.ammo, 10);
assert.equal(combat.FIRING_MODES.SUP.ammo, 20);
assert.equal(combat.damageFormula({ dv: "2d10 + 6", mode: "FA", concentrated: true }), "2d10 + 6 + 1d10 + 10");
assert.equal(combat.damageFormula({ dv: "2d10 + 6", mode: "FA", concentrated: false }), "2d10 + 6");
// Cone at long range: -1d10
assert.equal(combat.damageFormula({ dv: "2d10 + 5", cone: "long" }), "2d10 + 5 - 1d10");
// Concentrated beam fire: x 1.5 round up
assert.equal(combat.damageFormula({ dv: "2d10", beamConcentrated: true }), "ceil((2d10) * 1.5)");
// Melee: damage bonus, charge (+1d10) and extra weapons (+1d10 each, max +3d10)
assert.equal(combat.damageFormula({ dv: "1d10 + 2", db: 3, charging: true, extraWeapons: 5 }), "1d10 + 2 + 1d10 + 3d10 + 3");

// --- Ranges (p. 203)
const pistol = combat.parseRange("10 / 25 / 40 / 60");
assert.deepEqual(pistol, [10, 25, 40, 60]);
assert.equal(combat.rangeBand(2, pistol), "pointBlank");
assert.equal(combat.rangeBand(10, pistol), "short");
assert.equal(combat.rangeBand(26, pistol), "long");
assert.equal(combat.rangeBand(61, pistol), "beyond");
// Thrown grenades with SOM 30: SOM / 5, SOM / 2, SOM, SOM x 3
assert.deepEqual(combat.parseRange("SOM ÷ 5 / SOM ÷ 2 / SOM / SOM × 3", 30), [6, 15, 30, 90]);
assert.equal(combat.parseRange(""), null);

// --- Grenades and seekers (pp. 193, 204, 341)
assert.equal(combat.blastDamage(26, 3, { shape: "blast" }), 20);
assert.equal(combat.blastDamage(28, 3, { shape: "blast" }, 4), 16);  // HEAP: -4 per meter
assert.equal(combat.blastDamage(21, 5, { shape: "uniform", radius: 10 }), 21);
assert.equal(combat.blastDamage(21, 12, { shape: "uniform", radius: 10 }), 17);
assert.equal(combat.scatterDistance(0, 10), 10);
assert.equal(combat.scatterDistance(4, 45), 8);
assert.equal(combat.scatterDistance(4, 70), 12);
assert.equal(combat.damageFormula({ dv: "3d10 + 6", munition: { kind: "grenade", size: "mini" } }), "3d10 + 6 - 1d10");
assert.equal(combat.damageFormula({ dv: "3d10 + 6", munition: { kind: "seeker", size: "standard" } }), "(3d10 + 6) * 2");
assert.equal(combat.damageFormula({ dv: "3d10 + 6", munition: { kind: "seeker", size: "mini" } }), "3d10 + 6");

// --- Combat modifiers (p. 193)
assert.equal(combat.situationalModifier(["coverMinor", "coverMajor", "smartlink"]), -20);
assert.equal(combat.situationalModifier(["calledShot"], { extraTargets: 2 }), -50);

// --- Falling (p. 197), layered armor (p. 194)
assert.equal(combat.fallingDamage(0.5), "");
assert.equal(combat.fallingDamage(2), "1d10");
assert.equal(combat.fallingDamage(4), "2d10");
assert.equal(combat.fallingDamage(8), "3d10");
assert.equal(combat.fallingDamage(11), "3d10 + 3");
assert.equal(combat.fallingArmor(5), 2);
assert.equal(combat.layeredArmorModifier(1), 0);
assert.equal(combat.layeredArmorModifier(3), -40);

console.log("Rules checks passed.");
