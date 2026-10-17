/**
 * Active effect helpers working on both v13 (numeric change modes) and v14 (string change types).
 */

import { SYSTEM_ID } from "../config.mjs";

/** An additive change to a numeric field. */
export function addChange(key, value) {
  if ( game.release.generation >= 14 ) return { key, type: "add", value: String(value) };
  return { key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(value) };
}

/**
 * Token status conditions (Core pp. 198-207). Only stunned and full defense carry a flat modifier;
 * the others are markers that the combat automation reads (bleeding, burning...) or that the GM adjudicates.
 */
export function statusEffects() {
  const status = (id, img, changes = []) => ({ id, name: `EP1E.Condition.${id}`, img, changes });
  return [
    status("dead", "icons/svg/skull.svg"),
    status("unconscious", "icons/svg/unconscious.svg"),
    status("incapacitated", "icons/svg/paralysis.svg"),
    // Shock (p. 204): -30 to all actions, fading by 10 per Action Turn or minute
    status("stunned", "icons/svg/daze.svg", [addChange("system.mods.actions", -30)]),
    status("prone", "icons/svg/falling.svg"),
    // Wounded biomorph whose damage exceeds DUR: 1 damage per Action Turn (p. 207)
    status("bleeding", "icons/svg/blood.svg"),
    // 1d10 / 2 per Action Turn, against energy armor (p. 198)
    status("burning", "icons/svg/fire.svg"),
    // Full defense (p. 198): +30 to defend until the next Action Phase
    status("fullDefense", "icons/svg/shield.svg", [addChange("system.mods.defense", 30)]),
    // Psi full defense (p. 222): +30 to resist psi until the next Action Phase
    status("psiDefense", "icons/svg/aura.svg", [addChange("system.mods.psiDefense", 30)]),
    // Subdued (p. 204): only physical action allowed is breaking free, at -30
    status("subdued", "icons/svg/net.svg"),
    status("blinded", "icons/svg/blind.svg"),
    status("invisible", "icons/svg/invisible.svg")
  ];
}

/* -------------------------------------------- */
/*  Conditions on actors                        */
/* -------------------------------------------- */

/** The active effect carrying a status condition on an actor. */
export function conditionEffect(actor, id) {
  return actor.effects.find(e => e.statuses?.has(id)) ?? null;
}

/**
 * Give an actor a status condition, or refresh it.
 * @param {Actor} actor
 * @param {string} id               Status id (CONFIG.statusEffects)
 * @param {object} [options]
 * @param {number} [options.modifier] New value of the condition's change (e.g. -30 for stunned)
 * @param {object} [options.timer]    Countdown in Action Turns, see tickConditions
 * @param {boolean} [options.overlay] Show the icon over the whole token (death)
 */
export async function setCondition(actor, id, { modifier, timer, overlay = false } = {}) {
  let effect = conditionEffect(actor, id);
  if ( !effect ) {
    await actor.toggleStatusEffect(id, { active: true, overlay });
    effect = conditionEffect(actor, id);
  }
  if ( !effect ) return null;
  const update = {};
  if ( modifier !== undefined ) update.changes = effect.toObject().changes.map(c => ({ ...c, value: String(modifier) }));
  if ( timer ) update[`flags.${SYSTEM_ID}.timer`] = timer;
  if ( !foundry.utils.isEmpty(update) ) await effect.update(update);
  return effect;
}

/** Remove a status condition from an actor. */
export function clearCondition(actor, id) {
  return conditionEffect(actor, id)?.delete();
}

/**
 * Count down the timed conditions of an actor by one Action Turn.
 * flags.ep1e.timer = { left, every?, step?, then? }:
 * - when left reaches 0, a condition with a step raises its modifier by step and restarts the countdown (every),
 *   until the modifier is back to 0;
 * - other conditions end, and may give way to another one (then: { id, modifier, timer }).
 */
export async function tickConditions(actor) {
  for ( const effect of actor.effects.contents ) {
    const timer = effect.getFlag(SYSTEM_ID, "timer");
    if ( !timer ) continue;
    const left = timer.left - 1;
    if ( left > 0 ) {
      await effect.setFlag(SYSTEM_ID, "timer", { ...timer, left });
      continue;
    }
    if ( timer.step ) {
      const change = effect.toObject().changes[0];
      const value = Math.min(0, (Number(change?.value) || 0) + timer.step);
      if ( value < 0 ) {
        await effect.update({
          changes: effect.toObject().changes.map(c => ({ ...c, value: String(value) })),
          [`flags.${SYSTEM_ID}.timer`]: { ...timer, left: timer.every ?? 1 }
        });
        continue;
      }
    }
    await effect.delete();
    if ( timer.then ) await setCondition(actor, timer.then.id, timer.then);
  }
}
