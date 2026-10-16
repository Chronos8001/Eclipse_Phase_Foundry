import { SYSTEM_ID } from "../config.mjs";
import * as combat from "../rules/combat.mjs";
import { rollSkillTest, testDialogContext } from "./tests.mjs";

const TEMPLATES = {
  attack: `systems/${SYSTEM_ID}/templates/dialog/attack.hbs`,
  reload: `systems/${SYSTEM_ID}/templates/dialog/reload.hbs`
};

const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);
const DialogV2 = () => foundry.applications.api.DialogV2;

/* -------------------------------------------- */
/*  Attack profile                              */
/* -------------------------------------------- */

/**
 * Damage statistics of an attack. A launcher fires its loaded munition, at the loaded size.
 * @returns {object|null} null when a launcher is empty
 */
export function attackProfile(weapon) {
  const w = weapon.system;
  if ( !w.launcher ) {
    // Kinetic weapons fire the ammunition type they are loaded with (p. 337)
    const ammoItem = (w.skill === "kineticWeapons") ? weapon.actor?.items.get(w.ammo.loaded) : null;
    const ammo = (ammoItem?.type === "gear") && (ammoItem.system.category === "ammo") ? ammoItem.system.ammo : null;
    return {
      name: ammo ? `${weapon.name} — ${ammoItem.name}` : weapon.name,
      dv: w.dv, ap: w.ap + (ammo?.ap ?? 0), damageType: w.damageType, shock: w.shock || !!ammo?.shock,
      armorDoubled: !!ammo?.armorDoubled, ammo,
      area: { ...w.area }, munition: { ...w.munition }, munitionItem: null
    };
  }
  const item = weapon.actor?.items.get(w.ammo.loaded);
  if ( !item || (w.ammo.value < 1) ) return null;
  const m = item.system;
  const size = w.ammo.size || m.munition.size;
  return {
    name: `${weapon.name} — ${item.name}`, dv: m.dv, ap: m.ap, damageType: m.damageType, shock: m.shock,
    area: { ...m.area }, munition: { kind: m.munition.kind, size }, munitionItem: item
  };
}

/** The token representing an actor on the current scene: controlled first, then any active one. */
export function actorToken(actor) {
  if ( !canvas?.ready ) return null;
  return canvas.tokens.controlled.find(t => t.actor === actor) ?? actor.getActiveTokens()[0] ?? null;
}

/** Distance in grid units between two tokens, or null off the canvas. */
export function tokenDistance(a, b) {
  if ( !a || !b ) return null;
  try {
    return canvas.grid.measurePath([a.center, b.center]).distance;
  } catch {
    return null;
  }
}

/* -------------------------------------------- */
/*  Attack                                      */
/* -------------------------------------------- */

/**
 * Attack with a weapon: choose firing mode, range and combat modifiers, spend ammunition,
 * then roll the attack test. The test card carries the damage formula and the targets.
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {object} [options]
 * @param {boolean} [options.fastForward]  Skip the dialog (single shot, automatic range)
 */
export async function rollAttack(actor, weapon, options = {}) {
  const w = weapon.system;
  const sys = actor.system;
  // Seeker missiles are fired from a launcher (p. 340)
  if ( (w.munition.kind === "seeker") && !w.launcher ) {
    return ui.notifications.warn(game.i18n.format("EP1E.Attack.loadInLauncher", { name: weapon.name }));
  }
  const profile = attackProfile(weapon);
  if ( !profile ) return ui.notifications.warn(game.i18n.format("EP1E.Attack.noMunition", { name: weapon.name }));

  const fromSkill = sys.getSkillTarget(w.skill);
  // Creature attacks carry their own rating (stat blocks)
  const { target, label, skill } = (w.rating > 0) ? { target: w.rating, label: "", skill: null } : fromSkill;
  const ranged = w.weaponType === "ranged";
  const modes = combat.availableModes(w.modes);
  const bands = ranged ? combat.parseRange(w.range, sys.aptitudes.som.value) : null;

  // Targets and automatic range band
  const targets = Array.from(game.user.targets).map(t => ({ tokenUuid: t.document.uuid, actorUuid: t.actor?.uuid ?? null, name: t.name }));
  const attackerToken = actorToken(actor);
  const distance = ranged ? tokenDistance(attackerToken, Array.from(game.user.targets)[0]) : null;
  const band = (ranged && (distance !== null)) ? combat.rangeBand(distance, bands) : "short";

  let input = { mode: modes[0] ?? "", band, mods: {}, extraTargets: 0, concentrated: false };
  if ( !options.fastForward ) {
    const result = await promptAttack(actor, weapon, { profile, target, label, skill, ranged, modes, bands, band, distance, targets });
    if ( !result ) return null;
    input = foundry.utils.mergeObject(input, result);
  }

  // Ammunition (p. 194): weapons with a magazine need enough shots for the firing mode
  const shots = combat.ammoPerAttack(input.mode);
  const thrown = (profile.munition.kind === "grenade") && !w.launcher && (w.ammo.max === 0);
  if ( (w.ammo.max > 0) && (w.ammo.value < shots) ) {
    return ui.notifications.warn(game.i18n.format("EP1E.Attack.noAmmo", { name: weapon.name, shots }));
  }
  if ( thrown && (w.quantity < 1) ) return ui.notifications.warn(game.i18n.format("EP1E.Attack.noneLeft", { name: weapon.name }));
  if ( ranged && (input.band === "beyond") ) return ui.notifications.warn("EP1E.Attack.outOfRange", { localize: true });

  // Modifiers
  const keys = Object.entries(input.mods ?? {}).filter(([, v]) => v).map(([k]) => k);
  const extraTargets = Math.max(0, Number(input.extraTargets) || 0);
  let combatModifier = combat.situationalModifier(keys, { extraTargets });
  if ( ranged ) combatModifier += combat.RANGE_MODIFIERS[input.band] ?? 0;

  // Damage
  const fm = combat.FIRING_MODES[input.mode];
  const concentrated = !!input.concentrated && !!fm?.concentrated;
  const beamConcentrated = !!input.beamConcentrated && (w.skill === "beamWeapons") && (input.mode === "SA");
  const extraWeapons = ranged ? 0 : Math.max(0, Number(input.extraWeapons) || 0);
  const formula = combat.damageFormula({
    dv: profile.dv,
    db: w.addDB ? sys.stats.db : 0,
    mode: input.mode,
    concentrated,
    cone: (profile.area.shape === "cone") ? input.band : null,
    munition: profile.munition,
    ammo: profile.ammo,
    charging: !ranged && keys.includes("charging"),
    extraWeapons,
    beamConcentrated
  });

  const notes = [];
  if ( input.mode ) notes.push(game.i18n.localize(`EP1E.FiringMode.${input.mode}`));
  if ( concentrated || beamConcentrated ) notes.push(game.i18n.localize("EP1E.Attack.concentrated"));
  if ( ranged ) {
    const range = game.i18n.localize(`EP1E.Range.${input.band}`);
    notes.push((distance !== null) ? `${range} (${Math.round(distance)} m)` : range);
  }
  for ( const k of keys ) notes.push(game.i18n.localize(`EP1E.CombatMod.${k}`));
  if ( extraTargets ) notes.push(game.i18n.format("EP1E.Attack.extraTargetsNote", { count: extraTargets }));
  if ( extraWeapons ) notes.push(game.i18n.format("EP1E.Attack.extraWeaponsNote", { count: Math.min(3, extraWeapons) }));

  // Spend ammunition before rolling: the shots are fired whatever the outcome
  if ( w.ammo.max > 0 ) await weapon.update({ "system.ammo.value": w.ammo.value - shots });
  else if ( thrown ) await weapon.update({ "system.quantity": w.quantity - 1 });

  return rollSkillTest(actor, {
    label: `${profile.name}${label ? ` (${label})` : ""}`,
    target,
    specialization: skill?.system.specialization,
    fastForward: true,
    input: {
      difficulty: Number(input.difficulty) || 0,
      modifier: (Number(input.modifier) || 0) + combatModifier,
      specialized: !!input.specialized,
      ignoreMods: !!input.ignoreMods,
      messageMode: input.messageMode
    },
    attack: {
      weaponUuid: weapon.uuid,
      name: profile.name,
      formula,
      ap: profile.ap,
      damageType: profile.damageType,
      shock: profile.shock,
      armorDoubled: !!profile.armorDoubled,
      area: profile.area,
      munition: profile.munition,
      ranged,
      mode: input.mode,
      band: ranged ? input.band : null,
      calledShot: keys.includes("calledShot"),
      notes,
      targets,
      attackerTokenUuid: attackerToken?.document.uuid ?? null
    }
  });
}

/** Attack dialog: firing mode, range band and the Combat Modifiers table (p. 193). */
async function promptAttack(actor, weapon, ctx) {
  const w = weapon.system;
  const groups = ["general", ctx.ranged ? "ranged" : "melee"].map(id => ({
    id,
    title: `EP1E.CombatModGroup.${id}`,
    mods: Object.entries(combat.COMBAT_MODIFIERS[id])
      // Beam sweeping fire only makes sense with beam weapons
      .filter(([key]) => (key !== "sweepingFire") || (w.skill === "beamWeapons"))
      .map(([key, value]) => ({ key, value, label: `EP1E.CombatMod.${key}` }))
  }));
  const bandNames = ["pointBlank", "short", "medium", "long", "extreme", "beyond"];
  const content = await render(TEMPLATES.attack, {
    ...testDialogContext(actor, { label: ctx.profile.name, target: ctx.target, specialization: ctx.skill?.system.specialization }),
    skillLabel: ctx.label,
    ranged: ctx.ranged,
    modes: ctx.modes.map(mode => ({
      mode, label: `EP1E.FiringMode.${mode}`, ammo: combat.ammoPerAttack(mode), selected: mode === ctx.modes[0]
    })),
    canConcentrate: ctx.modes.some(m => combat.FIRING_MODES[m]?.concentrated),
    canBeamConcentrate: (w.skill === "beamWeapons") && ctx.modes.includes("SA"),
    ammo: (w.ammo.max > 0) ? w.ammo : null,
    loaded: ctx.profile.munitionItem?.name ?? null,
    thrownLeft: (ctx.profile.munition.kind === "grenade") && !w.launcher && (w.ammo.max === 0) ? w.quantity : null,
    bands: ctx.ranged ? bandNames.map(key => ({
      key,
      label: `EP1E.Range.${key}`,
      modifier: combat.RANGE_MODIFIERS[key] ?? null,
      max: (key === "pointBlank") ? combat.POINT_BLANK : (ctx.bands?.[bandNames.indexOf(key) - 1] ?? null),
      selected: key === ctx.band
    })) : [],
    distance: (ctx.distance !== null) ? Math.round(ctx.distance) : null,
    cone: ctx.profile.area.shape === "cone",
    area: ["blast", "uniform"].includes(ctx.profile.area.shape) ? ctx.profile.area : null,
    groups,
    targets: ctx.targets
  });
  return DialogV2().wait({
    window: { title: game.i18n.format("EP1E.Attack.title", { name: ctx.profile.name }), icon: "fa-solid fa-crosshairs" },
    classes: ["ep1e", "ep1e-dialog", "attack-dialog"],
    position: { width: 520 },
    content,
    buttons: [{
      action: "roll",
      label: "EP1E.Attack.roll",
      icon: "fa-solid fa-crosshairs",
      default: true,
      callback: (event, button) => foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(button.form).object)
    }],
    rejectClose: false
  });
}

/* -------------------------------------------- */
/*  Reloading                                   */
/* -------------------------------------------- */

/**
 * Reload a weapon (p. 194). Magazines are refilled; launchers take munitions from the actor's
 * grenade or seeker items, and give back the unfired ones when switching munition.
 */
export async function reloadWeapon(weapon) {
  const w = weapon.system;
  const actor = weapon.actor;
  if ( !actor || (w.ammo.max <= 0) ) return;
  if ( !w.launcher ) {
    // Kinetic weapons may switch ammunition type (p. 337); the type is not counted against a stock
    const types = (w.skill === "kineticWeapons")
      ? actor.items.filter(i => (i.type === "gear") && (i.system.category === "ammo")) : [];
    let loaded = w.ammo.loaded;
    if ( types.length ) {
      const options = [`<option value="">${game.i18n.localize("EP1E.Reload.standardAmmo")}</option>`]
        .concat(types.map(i => `<option value="${i.id}" ${i.id === loaded ? "selected" : ""}>${i.name}</option>`)).join("");
      const result = await DialogV2().prompt({
        window: { title: game.i18n.format("EP1E.Reload.title", { name: weapon.name }), icon: "fa-solid fa-rotate" },
        classes: ["ep1e", "ep1e-dialog"],
        content: `<div class="form-group"><label>${game.i18n.localize("EP1E.Reload.ammoType")}</label><select name="ammo">${options}</select></div>`,
        ok: { label: "EP1E.Reload.reload", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        rejectClose: false
      });
      if ( !result ) return;
      loaded = result.ammo ?? "";
    }
    await weapon.update({ "system.ammo.value": w.ammo.max, "system.ammo.loaded": loaded });
    const ammoName = actor.items.get(loaded)?.name;
    return ui.notifications.info(game.i18n.format("EP1E.Reload.done", {
      name: ammoName ? `${weapon.name} (${ammoName})` : weapon.name, count: w.ammo.max
    }));
  }

  const sizes = combat.launcherSizes(w.launcher);
  const munitions = actor.items.filter(i => (i.type === "weapon") && (i.system.munition.kind !== "none")
    && ((i.system.quantity > 0) || (i.id === w.ammo.loaded)));
  if ( !munitions.length ) return ui.notifications.warn("EP1E.Reload.noMunitions", { localize: true });
  const content = await render(TEMPLATES.reload, {
    munitions: munitions.map(i => ({ id: i.id, name: i.name, quantity: i.system.quantity, selected: i.id === w.ammo.loaded })),
    sizes: (sizes.length ? sizes : ["standard"]).map(s => ({ key: s, label: `EP1E.MunitionSize.${s}`, selected: s === w.ammo.size })),
    ammo: w.ammo
  });
  const result = await DialogV2().prompt({
    window: { title: game.i18n.format("EP1E.Reload.title", { name: weapon.name }), icon: "fa-solid fa-rotate" },
    classes: ["ep1e", "ep1e-dialog"],
    content,
    ok: { label: "EP1E.Reload.reload", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false
  });
  if ( !result ) return;

  const updates = [];
  const stock = new Map(munitions.map(i => [i.id, i.system.quantity]));
  // Unload: unfired munitions go back to their stock when switching type or size
  let loaded = w.ammo.value;
  const same = (result.munition === w.ammo.loaded) && (result.size === w.ammo.size);
  if ( !same && loaded && stock.has(w.ammo.loaded) ) {
    stock.set(w.ammo.loaded, stock.get(w.ammo.loaded) + loaded);
    loaded = 0;
  }
  else if ( !same ) loaded = 0;
  const take = Math.min(w.ammo.max - loaded, stock.get(result.munition) ?? 0);
  stock.set(result.munition, (stock.get(result.munition) ?? 0) - take);
  for ( const [id, quantity] of stock ) {
    if ( quantity !== actor.items.get(id).system.quantity ) updates.push({ _id: id, "system.quantity": quantity });
  }
  updates.push({
    _id: weapon.id,
    "system.ammo.value": loaded + take,
    "system.ammo.loaded": result.munition,
    "system.ammo.size": result.size
  });
  await actor.updateEmbeddedDocuments("Item", updates);
  const name = actor.items.get(result.munition)?.name ?? "";
  ui.notifications.info(game.i18n.format("EP1E.Reload.done", { name: `${weapon.name} (${name})`, count: loaded + take }));
}
