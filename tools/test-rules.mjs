/** Rules sanity checks against the Core Rulebook examples. Usage: node tools/test-rules.mjs */
import assert from "node:assert/strict";
import { evaluateTest, flipFlop } from "../module/dice/tests.mjs";
import * as combat from "../module/rules/combat.mjs";
import * as psi from "../module/rules/psi.mjs";
import * as mesh from "../module/rules/mesh.mjs";

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
// Successful shock test: half DV (round up); the -30 modifier fades by 10 per step
assert.equal(combat.shockedDamage(7, combat.shockOutcome(t(30, 41))), 4);
assert.equal(combat.shockedDamage(7, combat.shockOutcome(t(71, 41))), 7);
assert.equal(combat.fadeModifier(-30), -20);
assert.equal(combat.fadeModifier(-10), 0);
assert.equal(combat.shockOutcome(t(95, 41)).incapacitated, 5);

// --- Bleeding (p. 207) and fire (p. 198)
assert.equal(combat.isBleeding({ biological: true, wounds: 1, damage: 36, durability: 35 }), true);
assert.equal(combat.isBleeding({ biological: true, wounds: 0, damage: 36, durability: 35 }), false);
assert.equal(combat.isBleeding({ biological: true, wounds: 2, damage: 35, durability: 35 }), false);
assert.equal(combat.isBleeding({ biological: false, wounds: 2, damage: 50, durability: 35 }), false);
assert.equal(combat.fireDamage(0), "ceil(1d10 / 2)");
assert.equal(combat.fireDamage(5), "1d10");
assert.equal(combat.fireDamage(14), "2d10");
assert.equal(combat.fireDamage(15), "3d10");
assert.equal(combat.fireDamage(25), "3d10 + 10");

// --- Firing modes (p. 198)
assert.deepEqual(combat.parseModes("SA, BF, FA"), ["SA", "BF", "FA"]);
assert.deepEqual(combat.availableModes("BF, FA"), ["BF", "FA", "SUP"]);
assert.equal(combat.FIRING_MODES.BF.ammo, 3);
assert.equal(combat.FIRING_MODES.FA.ammo, 10);
assert.equal(combat.FIRING_MODES.SUP.ammo, 20);
assert.equal(combat.ammoPerAttack("BF"), 3);
assert.equal(combat.ammoPerAttack(""), 1);
assert.deepEqual(combat.launcherSizes("micro, mini"), ["micro", "mini"]);
assert.deepEqual(combat.launcherSizes(""), []);
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
// Scatter direction: 1 lands beyond the target along the line of fire, 5 back toward the attacker
assert.deepEqual(combat.scatterOffset(8, 1, 0), { dx: 8, dy: 0 });
assert.deepEqual(combat.scatterOffset(8, 5, 0), { dx: -8, dy: 0 });
assert.deepEqual(combat.scatterOffset(4, 3, 0), { dx: 0, dy: 4 });
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

// --- Psi (pp. 220-228)
// Matric: WIL 25 -> Qualia lasts 5 Action Turns; strain mod -1 -> (1d10 ÷ 2) - 1 (p. 223)
assert.equal(psi.temporaryDuration(25), 5);
assert.equal(psi.temporaryDuration(25, "minutes"), 100);
assert.deepEqual(psi.strainFormulas({ mod: -1 }), ["ceil(1d10 / 2) - 1"]);
// Psychic Stab against a worker pod: WIL x 2 = 32, +30 pod = 62; damage 1d10 + 3 with WIL 25
assert.equal(psi.psiDefenseTarget(16, { pod: true }), 62);
assert.equal(Math.ceil(25 / 10), 3);
// Strain for each target; Mindlink rolls once, +1 per target after the first
assert.deepEqual(psi.strainFormulas({ mod: 0, targets: 3 }), ["ceil(1d10 / 2)", "ceil(1d10 / 2)", "ceil(1d10 / 2)"]);
assert.deepEqual(psi.strainFormulas({ perTarget: 1, targets: 3 }), ["ceil(1d10 / 2) + 2"]);
// Animals: +3 strain; Penetration: +1 strain per AP
assert.deepEqual(psi.strainFormulas({ mod: -1, creature: "animal", ap: -2 }), ["ceil(1d10 / 2) + 4"]);
assert.equal(psi.maxPenetration(57), 5);
// Close range: 5 m, 10 m against an async, -10 per meter beyond
assert.equal(psi.closeRangeModifier(5), 0);
assert.equal(psi.closeRangeModifier(7), -20);
assert.equal(psi.closeRangeModifier(7, { vsAsync: true }), 0);
assert.equal(psi.canBeTargeted("pod"), true);
assert.equal(psi.canBeTargeted("synthmorph"), false);
assert.equal(psi.psiShieldArmor(25), 5);
assert.equal(psi.psiExcellentBonus(45), 5);
assert.equal(psi.psiExcellentBonus(65), 5);

// --- Mesh (pp. 246-262)
// Defeating a firewall: admin -30, security -20; exploit quality helps, firewall quality hinders
assert.equal(mesh.intrusionModifier({ privileges: "admin" }), -30);
assert.equal(mesh.intrusionModifier({ privileges: "security", exploit: 10, firewall: 20 }), -30);
assert.equal(mesh.intrusionModifier({ bruteForce: true }), 30);
// Cyberbrains: -30, but not the admin modifier on top (p. 261)
assert.equal(mesh.intrusionModifier({ privileges: "admin", cyberbrain: true }), -30);
assert.equal(mesh.intrusionModifier({ privileges: "security", cyberbrain: true }), -50);
// The hacking sequence (p. 255): unmonitored success -> Covert, excellent -> Hidden
const ok = { success: true, excellent: false };
const great = { success: true, excellent: true };
const ko = { success: false, excellent: false };
assert.deepEqual(mesh.intrusionOutcome(ok), { status: "covert", retry: false });
assert.deepEqual(mesh.intrusionOutcome(great), { status: "hidden", retry: false });
assert.deepEqual(mesh.intrusionOutcome(ko), { status: null, retry: false });
// Monitored: both succeed -> Spotted; only the monitor -> Locked; both fail -> roll again
assert.equal(mesh.intrusionOutcome(great, ko).status, "hidden");
assert.equal(mesh.intrusionOutcome(ok, ok).status, "spotted");
assert.equal(mesh.intrusionOutcome(ko, ok).status, "locked");
assert.equal(mesh.intrusionOutcome(ko, ko).retry, true);
// Brute force: Locked, or locked out by a winning monitor
assert.equal(mesh.intrusionOutcome(great, null, { bruteForce: true }).status, "locked");
assert.equal(mesh.intrusionOutcome(ok, ok, { bruteForce: true }).status, null);
// Status modifiers: passive alert -10, active -20, Hidden +30 to subvert
assert.equal(mesh.statusModifier("spotted"), -10);
assert.equal(mesh.statusModifier("locked"), -20);
assert.equal(mesh.statusModifier("hidden"), 30);
assert.equal(mesh.statusModifier("covert"), 0);
// Changing status (p. 256)
assert.equal(mesh.upgradeStatus("covert"), "hidden");
assert.equal(mesh.upgradeStatus("locked"), "locked");
assert.equal(mesh.statusAfterTest("covert", t(80, 40)), "spotted");    // severe failure
assert.equal(mesh.statusAfterTest("hidden", t(77, 40)), "locked");     // critical failure
assert.equal(mesh.statusAfterTest("covert", t(50, 40)), "covert");     // simple failure
// Sarlo's script: Programming 70 -> 7 steps (p. 260)
assert.equal(mesh.scriptSteps(70), 7);
assert.equal(mesh.crashTests("ai"), 2);
assert.equal(mesh.crashTests("agi"), 3);

console.log("Rules checks passed.");
