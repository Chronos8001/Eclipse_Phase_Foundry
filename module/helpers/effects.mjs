/**
 * Active effect helpers working on both v13 (numeric change modes) and v14 (string change types).
 */

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
    // Subdued (p. 204): only physical action allowed is breaking free, at -30
    status("subdued", "icons/svg/net.svg"),
    status("blinded", "icons/svg/blind.svg"),
    status("invisible", "icons/svg/invisible.svg")
  ];
}
