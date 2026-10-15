/** Rules sanity checks against the Core Rulebook examples. Usage: node tools/test-rules.mjs */
import assert from "node:assert/strict";
import { evaluateTest, flipFlop } from "../module/dice/tests.mjs";

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
console.log("Rules checks passed.");
