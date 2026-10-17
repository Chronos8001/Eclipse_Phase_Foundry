/** Rules sanity checks against the Core Rulebook examples. Usage: node tools/test-rules.mjs */
import assert from "node:assert/strict";
import { evaluateTest, flipFlop } from "../module/dice/tests.mjs";
import * as combat from "../module/rules/combat.mjs";
import * as psi from "../module/rules/psi.mjs";
import * as mesh from "../module/rules/mesh.mjs";
import * as gear from "../module/rules/gear.mjs";
import * as ego from "../module/rules/ego.mjs";
import * as adv from "../module/rules/advancement.mjs";
import * as mental from "../module/rules/mental.mjs";

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

// Kinetic ammunition (p. 337): hollow-point +1d10, armor-piercing -2, plastic halves, jammer does no damage
assert.equal(combat.damageFormula({ dv: "2d10 + 4", ammo: { dv: "+1d10" } }), "2d10 + 4 + 1d10");
assert.equal(combat.damageFormula({ dv: "2d10 + 4", ammo: { dv: "-2" } }), "2d10 + 4 - 2");
assert.equal(combat.damageFormula({ dv: "2d10 + 4", ammo: { half: true } }), "ceil((2d10 + 4) / 2)");
assert.equal(combat.damageFormula({ dv: "2d10 + 4", ammo: { noDamage: true } }), "");

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

// --- Gear: substance durations and addiction (pp. 317-325)
assert.equal(gear.durationTurns("20 minutes"), 400);
assert.equal(gear.durationTurns("3 Action Turns"), 3);
assert.equal(gear.durationTurns("8 hours"), 9600);
assert.equal(gear.durationTurns("1 day"), 28800);
assert.equal(gear.durationTurns("2 hours–1 day"), 2400);
// Halftone (Zone Stalkers p. 16): a range of hours lasts its upper bound
assert.equal(gear.durationTurns("36–48 hours"), 48 * 1200);
assert.equal(gear.durationTurns("3 Action Turns/1 hour"), 3);
assert.equal(gear.durationTurns("special"), null);
assert.equal(gear.durationTurns("death"), null);
assert.equal(gear.addictionTarget(15, "–10"), 35);
assert.equal(gear.addictionTarget(15, "+10"), 55);
assert.equal(gear.addictionTarget(15, ""), 45);

// --- Ego (Core pp. 270-289) ---
// Integration and alienation modifiers (p. 272): infomorph and fork apply to the Alienation Test only
assert.equal(ego.sleevingModifier(["synthetic", "adaptability1"], "integration"), 0);
assert.equal(ego.sleevingModifier(["infomorph", "firstTime"], "integration"), -10);
assert.equal(ego.sleevingModifier(["infomorph", "firstTime"], "alienation"), -30);
assert.equal(ego.integrationTarget(15), 45);
// Integration Test table: MoF 25 -> -10 to physical actions for 2 + 2 days; severe failure: all actions
assert.deepEqual(ego.integrationEffect(t(70, 45)), { modifier: -10, physical: true, days: 4, moxie: 0 });
assert.deepEqual(ego.integrationEffect(t(80, 45)), { modifier: -10, physical: false, days: 5, moxie: 0 });
assert.deepEqual(ego.integrationEffect(t(20, 45)), { modifier: -10, physical: true, days: 1, moxie: 0 });
assert.equal(ego.integrationEffect(t(10, 45)).modifier, 0); // excellent success: no ill effects
assert.equal(ego.integrationEffect(t(22, 45)).moxie, 1);    // critical success
assert.deepEqual(ego.integrationEffect(t(88, 45)), { modifier: -30, physical: true, days: null, moxie: 0 });
// Alienation Test table: 1 SV per 10 full MoF, 2 on a critical failure; a critical success heals 1d10 / 2
assert.equal(ego.alienationStress(t(75, 40)).stress, 3);
assert.equal(ego.alienationStress(t(77, 40)).stress, 6);
assert.equal(ego.alienationStress(t(30, 40)).stress, 0);
assert.equal(ego.alienationStress(t(11, 40)).heal, "ceil(1d10 / 2)");
// Continuity: -1 SV per 10 full MoS, +1 per 10 full MoF, +2 when not knowing how you died, never below 0
assert.equal(ego.continuityStress(6, t(20, 45)), 4);
assert.equal(ego.continuityStress(6, t(70, 45)), 8);
assert.equal(ego.continuityStress(1, t(5, 45), { notKnowing: true }), 0);
assert.equal(ego.continuityStress(3, t(40, 45), { notKnowing: true }), 5);
// Backup complications (p. 270): 1 SV per 10 full MoF of the LUC Test
assert.equal(ego.backupStress(t(75, 50)), 2);
assert.equal(ego.backupStress(t(45, 50)), 0);
// Forks (pp. 273-274): beta -5 aptitudes (min 1), active skills up to 60; delta keeps its 5 best skills
assert.equal(ego.forkAptitude(20, "beta"), 15);
assert.equal(ego.forkAptitude(5, "delta"), 1);
assert.equal(ego.forkAptitude(20, "alpha"), 20);
assert.equal(ego.forkRanks(50, 20, 60), 40);
assert.equal(ego.forkRanks(30, 20, 60), 30);
assert.equal(ego.forkRanks(30, 50, 40), 0);
assert.equal(ego.forkRanks(30, 50, null), 30);
assert.deepEqual(ego.forkKeptSkills([1, 7, 3, 9, 5, 6, 2].map((total, i) => ({ id: `s${i}`, total })), 5), ["s3", "s1", "s5", "s4", "s2"]);
assert.equal(ego.pruningPenalties(t(62, 40)), 2);
// Merging table (p. 275): under 1 hour +30, 4-12 hours +10, 1 week or more -30
assert.equal(ego.mergingRow(1800).modifier, 30);
assert.equal(ego.mergingRow(3600).modifier, 20);
assert.equal(ego.mergingRow(6 * 3600).modifier, 10);
assert.equal(ego.mergingRow(2 * 86400).modifier, -10);
assert.equal(ego.mergingRow(30 * 86400).modifier, -30);
assert.equal(ego.mergingRow(30 * 86400).failure.memory, "severe");
// Reputation levels (p. 287)
assert.equal(ego.repLevel(0), 1);
assert.equal(ego.repLevel(53), 3);
assert.equal(ego.repLevel(80), 5);
assert.equal(ego.repLevel(99), 5);
// Jaqui (pp. 287-288): @-rep 53 (Level 3) seeking a Level 4 favor with Networking 50 -> target 40
assert.equal(50 + ego.favorModifier({ rep: 53, level: 4 }), 40);
// Keeping quiet -20 -> 20 (p. 289); burning Rep: +1 per point, at most +30
assert.equal(50 + ego.favorModifier({ rep: 53, level: 4, quiet: -20 }), 20);
assert.equal(ego.favorModifier({ rep: 53, level: 3, burn: 45 }), 30);
assert.equal(ego.favorModifier({ rep: 90, level: 1, extra: 1 }), 50);
// Level 4 favors refresh after a month, and cost 10 Rep to burn (Jaqui: 53 -> 43)
assert.equal(ego.FAVORS[4].burn, 10);
assert.equal(ego.favorRefreshed(4, 0, 3 * 3600), false);
assert.equal(ego.favorRefreshed(4, 0, 30 * 86400), true);
assert.equal(ego.favorRefreshed(5, null, 0), true);

// --- Creation and advancement (Core pp. 134-136, 152-153) ---
// A skill whose aptitude is 20 raised to 70 costs 60 CP (p. 135); Tai: Pilot 50 -> 65 is 20 CP, Scrounging 60 -> 70 is 20
assert.equal(adv.skillCost(20, 70), 60);
assert.equal(adv.skillCost(50, 65), 20);
assert.equal(adv.skillCost(60, 70), 20);
assert.equal(adv.skillCost(40, 40), 0);
// Raising an aptitude: 10 RP a point, +1 RP per linked skill each point raises over 60 (p. 152)
assert.equal(adv.aptitudeRezCost(1, [60, 65, 40]), 12);
assert.equal(adv.aptitudeRezCost(2, [59]), 21);
// Tai (pp. 135-136): Moxie 1 -> 5 is 60 CP; Rep: 50 free (25/25), +30 on each and g-rep 40 is 10 CP; a bouncer is 40 CP
const tai = adv.creationCost({
  aptitudes: [15, 15, 20, 15, 10, 15, 15], moxie: 5,
  skills: [
    { category: "active", aptitude: 20, ranks: 30, free: 10, specialized: false },  // Pilot: Spacecraft 50 with +10 free
    { category: "knowledge", aptitude: 15, ranks: 45, free: 0, specialized: true }
  ],
  rep: [55, 55, 40], traits: [{ cost: 10, negative: true, morph: false }, { cost: 5, negative: false, morph: false }],
  morph: 40, sleights: 0
});
assert.equal(tai.lines.moxie, 60);
assert.equal(tai.lines.aptitudes, 0);   // 105 points in all: the INT raise was paid from the free points
assert.equal(tai.lines.active, 20);
assert.equal(tai.lines.knowledge, 45);
assert.equal(tai.lines.specializations, 5);
assert.equal(tai.lines.rep, 10);
assert.equal(tai.lines.positiveTraits, 5);
assert.equal(tai.gained, 10);
assert.equal(tai.spent, 60 + 20 + 45 + 5 + 10 + 5 + 40);
assert.ok(tai.warnings.some(w => w.key === "activeMinimum"));
assert.ok(tai.warnings.some(w => w.key === "aptitudeMax") === false);
assert.equal(adv.creationCost({ aptitudes: [25, 25, 15, 15, 15, 15, 15], moxie: 1, skills: [], rep: [50], traits: [], morph: 0, sleights: 0 }).lines.aptitudes, 200);
// Packages: 100 CP per Package Point (Transhuman p. 14)
assert.equal(adv.creationCost({ aptitudes: [15, 15, 15, 15, 15, 15, 15], moxie: 1, skills: [], rep: [50], traits: [], morph: 0, sleights: 0, packages: 10 }).spent, 1000);
// Rez Points: limits of the rules
assert.deepEqual(adv.rezCost("moxie", { from: 9, points: 1 }), { cost: 15 });
assert.deepEqual(adv.rezCost("moxie", { from: 10, points: 1 }), { error: "moxieMax" });
assert.deepEqual(adv.rezCost("aptitude", { from: 30, points: 1 }), { error: "aptitudeMax" });
assert.deepEqual(adv.rezCost("skill", { total: 58, points: 4 }), { cost: 6 });
assert.deepEqual(adv.rezCost("skill", { total: 98, points: 2 }), { error: "skillMax" });
assert.deepEqual(adv.rezCost("specialization", { total: 25 }), { error: "specializationMinimum" });
assert.deepEqual(adv.rezCost("specialization", { total: 40, specialized: true }), { error: "oneSpecialization" });
assert.deepEqual(adv.rezCost("specialization", { total: 40 }), { cost: 5 });
assert.deepEqual(adv.rezCost("sleight", { psi: false }), { error: "noPsi" });
assert.deepEqual(adv.rezCost("rep", { points: 2 }), { cost: 2 });

// --- Healing and mental health (Core pp. 208-215, 229-233) ---
// Healing table: basic biomods heal 1d10 per 12 hours; wounds only once the damage is gone
assert.deepEqual(mental.naturalHealing({ damage: 12, wounds: 2, hours: 24, care: "biomods", rolls: [6, 7] }), { damage: 12, wounds: 0, periods: 2 });
assert.deepEqual(mental.naturalHealing({ damage: 5, wounds: 2, hours: 12 + (2 * 72), care: "biomods", rolls: [8] }), { damage: 5, wounds: 2, periods: 1 });
assert.equal(mental.naturalHealing({ damage: 0, wounds: 3, hours: 24, care: "medichines", rolls: [] }).wounds, 2);
// Poor conditions double the timeframes; harsh conditions stop wound healing
assert.equal(mental.naturalHealing({ damage: 10, wounds: 0, hours: 24, care: "none", condition: "poor", rolls: [4, 4] }).periods, 0);
assert.equal(mental.naturalHealing({ damage: 0, wounds: 1, hours: 1000, care: "none", condition: "harsh", rolls: [] }).wounds, 0);
// Willpower Stress Tests: all or nothing; X-Risks option: half on a success (round down)
assert.equal(mental.stressTaken(7, false), 7);
assert.equal(mental.stressTaken(7, true), 0);
assert.equal(mental.stressTaken(7, true, { halfOnSuccess: true }), 3);
assert.equal(mental.STRESSFUL_EXPERIENCES.tortureSevere, "3d10 + 5");
// Derangements by trauma: minor, then upgraded to moderate and major; a disorder from the 4th trauma
assert.equal(mental.derangementFor(1), "minor");
assert.equal(mental.derangementFor(2), "moderate");
assert.equal(mental.derangementFor(3), "major");
assert.equal(mental.derangementFor(4), "disorder");
// Natural mental healing: 1d10 stress, or 1 trauma once the stress is gone
assert.deepEqual(mental.naturalMentalHealing(t(30, 45), { stress: 4, traumas: 1, rolled: 7 }), { stress: 4, traumas: 0 });
assert.deepEqual(mental.naturalMentalHealing(t(30, 45), { stress: 0, traumas: 2, rolled: 7 }), { stress: 0, traumas: 1 });
assert.deepEqual(mental.naturalMentalHealing(t(60, 45), { stress: 4, traumas: 1, rolled: 7 }), { stress: 0, traumas: 0 });
// Psychotherapy: 1 hour per stress point, 8 per trauma, 40 per disorder; +30 after psychosurgery, -10 per disorder
assert.deepEqual(mental.therapyHealing(10, { stress: 6, traumas: 1, disorders: 1 }), { stress: 6, traumas: 0, disorders: 0 });
assert.deepEqual(mental.therapyHealing(14, { stress: 6, traumas: 1, disorders: 1 }), { stress: 6, traumas: 1, disorders: 0 });
assert.deepEqual(mental.therapyHealing(40, { stress: 0, traumas: 0, disorders: 2 }), { stress: 0, traumas: 0, disorders: 1 });
assert.deepEqual(mental.therapyHealing(5, { stress: 9, traumas: 2, disorders: 0 }), { stress: 5, traumas: 0, disorders: 0 });
assert.equal(mental.therapyModifier({ psychosurgery: true, disorders: 2 }), 10);
// Psychosurgery (p. 232): surgeon succeeds and subject fails -> permanent; both succeed, surgeon higher -> 1 week/10 MoS
const surgeon = { ...t(45, 70), value: 45 };
assert.deepEqual(mental.surgeryOutcome(surgeon, { ...t(60, 45), value: 60 }), { effect: "permanent", weeks: 0 });
assert.deepEqual(mental.surgeryOutcome({ ...t(48, 70), value: 48 }, { ...t(30, 45), value: 30 }), { effect: "temporary", weeks: 2 });
assert.deepEqual(mental.surgeryOutcome({ ...t(20, 70), value: 20 }, { ...t(30, 45), value: 30 }), { effect: "none", weeks: 0 });
assert.deepEqual(mental.surgeryOutcome({ ...t(80, 70), value: 80 }, null), { effect: "none", weeks: 0 });
assert.deepEqual(mental.surgeryOutcome({ ...t(20, 70), value: 20 }, null), { effect: "permanent", weeks: 0 });
// Stress: halved on an Excellent Success, none on a critical, doubled on a Severe Failure, trauma on a critical failure
assert.deepEqual(mental.surgeryStress(5, t(30, 70)), { sv: 2, trauma: false });
assert.deepEqual(mental.surgeryStress(5, t(44, 70)), { sv: 0, trauma: false });
assert.deepEqual(mental.surgeryStress(5, t(90, 50)), { sv: 10, trauma: false });
assert.deepEqual(mental.surgeryStress(5, t(66, 50)), { sv: 5, trauma: true });
assert.deepEqual(mental.surgeryStress(3, t(60, 70), ["timeAcceleration", "safetyIgnored"]), { sv: 10, trauma: false });
assert.equal(mental.surgeryModifier("behavioralControl", "block", ["nonHuman"]), -40);
assert.equal(mental.surgeryModifier("interrogation", "standard"), 30);

console.log("Rules checks passed.");
