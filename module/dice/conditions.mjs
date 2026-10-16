import { SYSTEM_ID } from "../config.mjs";
import * as combat from "../rules/combat.mjs";
import { clearCondition, conditionEffect, setCondition, tickConditions } from "../helpers/effects.mjs";
import { applyToActor, evaluateTest, gmWhisper } from "./tests.mjs";
import { tickSleights } from "./psi.mjs";

/**
 * Conditions that follow harm: shock (p. 204), knockdown and unconsciousness (p. 207),
 * bleeding (p. 207), burning (p. 198), and their countdown each Action Turn.
 */

/** Biomorphs and pods: they bleed and are affected by shock weapons; synthmorphs are immune (p. 204). */
export function isBiological(actor) {
  const stats = actor.system.stats;
  return !stats.isSynth && !stats.isInfomorph;
}

/** Shock test: current DUR + Energy armor, rolled automatically when a shock weapon hits (p. 204). */
export async function rollShock(actor) {
  const sys = actor.system;
  const target = combat.shockTarget(sys.stats.dur, sys.damage.value, sys.armor.energy);
  const roll = await new Roll("1d100").evaluate();
  const value = roll.total % 100;
  const result = evaluateTest({ value, target });
  return { roll, value, target, success: result.success, margin: result.margin, ...combat.shockOutcome(result) };
}

/**
 * Conditions of a shock (p. 204). A failed test incapacitates the victim for the rolled turns, then leaves
 * it stunned at -30 fading by 10 per minute; a success stuns at -30 until the end of the next turn,
 * fading by 10 per turn. Further shocks are not cumulative but restore the full modifier.
 */
export async function applyShockConditions(actor, shock) {
  const stunned = { modifier: combat.SHOCK_MODIFIER };
  if ( shock.success ) return setCondition(actor, "stunned", { ...stunned, timer: { left: 2, every: 1, step: 10 } });
  await setCondition(actor, "prone");
  const minute = combat.TURNS_PER_MINUTE;
  return setCondition(actor, "incapacitated", {
    timer: { left: shock.incapacitated, then: { id: "stunned", ...stunned, timer: { left: minute, every: minute, step: 10 } } }
  });
}

/** Conditions that follow from an actor's health after damage: death, unconsciousness, bleeding. */
export async function updateHealthConditions(actor) {
  const sys = actor.system;
  const biological = isBiological(actor);
  if ( sys.status.dead ) return setCondition(actor, "dead", { overlay: true });
  // A biomorph collapses unconscious at DUR; a synthmorph is merely incapacitated (p. 207)
  if ( sys.status.incapacitated ) await setCondition(actor, biological ? "unconscious" : "incapacitated");
  if ( combat.isBleeding({ biological, wounds: sys.wounds.value, damage: sys.damage.value, durability: sys.stats.dur }) ) {
    await setCondition(actor, "bleeding");
  }
}

/* -------------------------------------------- */
/*  Action Turns                                */
/* -------------------------------------------- */

/** A new round (Action Turn) began: the active GM counts down conditions and applies bleeding and fire. */
export async function onCombatRound(combatDoc, changed, options) {
  if ( !game.users.activeGM?.isSelf ) return;
  if ( !("round" in changed) || (options?.direction === -1) || (changed.round <= 1) ) return;
  const actors = new Set(combatDoc.combatants.contents.map(c => c.actor).filter(a => a));
  for ( const actor of actors ) {
    await tickConditions(actor);
    await tickSleights(actor);
    await bleed(actor);
    await burn(actor);
  }
}

/** Bleeding: 1 damage point per Action Turn until treated; stops once damage is back to DUR or less. */
async function bleed(actor) {
  if ( !conditionEffect(actor, "bleeding") ) return;
  const sys = actor.system;
  if ( !combat.isBleeding({ biological: isBiological(actor), wounds: sys.wounds.value, damage: sys.damage.value, durability: sys.stats.dur }) ) {
    return clearCondition(actor, "bleeding");
  }
  // Bleeding damage causes no wounds
  await actor.update({ "system.damage.value": sys.damage.value + 1 });
  await updateHealthConditions(actor);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="ep1e chat-card"><p class="danger">${game.i18n.format("EP1E.Harm.bleeds", {
      name: actor.name, total: actor.system.damage.value, max: actor.system.stats.dur
    })}</p></div>`,
    whisper: gmWhisper(actor)
  });
}

/** Burning: fire damage against energy armor, growing every 5 turns (p. 198). */
async function burn(actor) {
  const effect = conditionEffect(actor, "burning");
  if ( !effect ) return;
  const turns = effect.getFlag(SYSTEM_ID, "turns") ?? 0;
  const roll = await new Roll(combat.fireDamage(turns)).evaluate();
  await effect.setFlag(SYSTEM_ID, "turns", turns + 1);
  return applyToActor(actor, {
    label: game.i18n.localize("EP1E.Condition.burning"), total: roll.total, ap: 0, damageType: "energy"
  }, { rolls: [roll] });
}
