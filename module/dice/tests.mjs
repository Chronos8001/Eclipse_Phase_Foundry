import { DIFFICULTIES, SYSTEM_ID } from "../config.mjs";
import { createMessage, defaultMessageMode, messageModeChoices } from "../helpers/chat.mjs";
import { excellentBonus, shockedDamage } from "../rules/combat.mjs";
import { psiExcellentBonus } from "../rules/psi.mjs";
import { conditionEffect, setCondition } from "../helpers/effects.mjs";
import { blastRecipients, renderTargets, resolveTargets, rollDefense, rollScatter, waiveDefense } from "./opposed.mjs";
import { applyShockConditions, isBiological, rollShock, updateHealthConditions } from "./conditions.mjs";
import { rollSeizureTest } from "./psi.mjs";
import { scorchEffect } from "./mesh.mjs";
import { rollAddictionTest } from "./substances.mjs";
import { applyEgoResult, egoSummary } from "./ego.mjs";
import { promptDerangement } from "./mental.mjs";

const TEMPLATES = {
  dialog: `systems/${SYSTEM_ID}/templates/dialog/test.hbs`,
  test: `systems/${SYSTEM_ID}/templates/chat/test.hbs`,
  damage: `systems/${SYSTEM_ID}/templates/chat/damage.hbs`,
  applied: `systems/${SYSTEM_ID}/templates/chat/applied.hbs`
};

const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

/* -------------------------------------------- */
/*  Test resolution                             */
/* -------------------------------------------- */

/** Convert a 1d100 result (1-100) to the Eclipse Phase 00-99 scale. */
const toPercentile = n => n % 100;

/** Reverse the two digits of a percentile roll (Moxie flip-flop, Core p. 122). */
export const flipFlop = value => Number(String(value).padStart(2, "0").split("").reverse().join(""));

/**
 * Evaluate a d100 roll against a target number (Core pp. 115-118).
 * @param {object} test  Stored test data (value, target, moxie)
 */
export function evaluateTest(test) {
  const value = test.value;
  const target = test.target;
  const doubles = (value % 11) === 0;
  let success;
  if ( value === 0 ) success = true;        // 00 is always a critical success
  else if ( value === 99 ) success = false; // 99 is always a critical failure
  else success = value <= target;
  let critical = doubles;
  if ( (test.moxie === "crit") && success ) critical = true;
  if ( (test.moxie === "ignoreCritFail") && !success ) critical = false;
  const margin = Math.max(0, success ? target - value : value - target);
  const excellent = success && (margin >= 30);
  const severe = !success && (margin >= 30);
  let outcome;
  if ( success ) outcome = critical ? "criticalSuccess" : (excellent ? "excellentSuccess" : "success");
  else outcome = critical ? "criticalFailure" : (severe ? "severeFailure" : "failure");
  return { success, critical, margin, excellent, severe, outcome, doubles };
}

/* -------------------------------------------- */
/*  Test dialog                                 */
/* -------------------------------------------- */

/** Context of the fields shared by every test dialog (templates/dialog/test-fields.hbs). */
export function testDialogContext(actor, { label, target, specialization, aptitude, multiplier }) {
  return {
    label, target, specialization, aptitude, multiplier,
    penalty: actor.system.penalty?.total ?? 0,
    moxie: actor.system.moxie.value,
    difficulties: DIFFICULTIES,
    multipliers: [1, 2, 3, 4, 5],
    messageModes: messageModeChoices(),
    messageMode: defaultMessageMode()
  };
}

/**
 * Prompt for test modifiers.
 * @returns {Promise<object|null>} The submitted options, or null if cancelled.
 */
async function promptTest(actor, options) {
  const content = await render(TEMPLATES.dialog, testDialogContext(actor, options));
  return foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("EP1E.Test.title", { label }), icon: "fa-solid fa-dice-d10" },
    classes: ["ep1e", "ep1e-dialog"],
    content,
    buttons: [{
      action: "roll",
      label: "EP1E.Test.roll",
      icon: "fa-solid fa-dice",
      default: true,
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    }],
    rejectClose: false
  });
}

/* -------------------------------------------- */
/*  Skill & aptitude tests                      */
/* -------------------------------------------- */

/**
 * Roll a d100 test for an actor and post it to chat.
 * @param {Actor} actor
 * @param {object} options
 * @param {string} options.label           What is being tested
 * @param {number} options.target          Base target number (skill rating)
 * @param {string} [options.specialization] Specialization name, offers +10
 * @param {string} [options.aptitude]      Aptitude key, offers a multiplier (e.g. SOM x 3)
 * @param {number} [options.multiplier]    Preset aptitude multiplier
 * @param {object} [options.attack]        Weapon attack data, enables the damage button
 * @param {object} [options.defense]       Defense against an attack card: { attackId, tokenUuid }
 * @param {object} [options.ego]           Ego test with an "apply" button (dice/ego.mjs): { kind, ... }
 * @param {boolean} [options.ownPenalty=true] Apply the actor's wound, trauma and other penalties (false for a test
 *                                          made with someone else's skill, such as a therapist's)
 * @param {object} [options.input]         Preset dialog values (difficulty, modifier, specialized, ignoreMods, messageMode)
 * @param {boolean} [options.fastForward]  Skip the dialog
 */
export async function rollSkillTest(actor, options = {}) {
  const { label, attack = null, defense = null, ego = null } = options;
  let base = options.target ?? 0;
  let input = {
    difficulty: 0, modifier: 0, multiplier: options.multiplier ?? 1, specialized: false, ignoreMods: false, ...options.input
  };
  if ( !options.fastForward ) {
    const result = await promptTest(actor, { ...options, multiplier: input.multiplier });
    if ( !result ) return null;
    input = foundry.utils.mergeObject(input, result);
  }
  const multiplier = options.aptitude ? Math.max(1, Number(input.multiplier) || 1) : 1;
  base *= multiplier;

  const penalty = (options.ownPenalty === false) ? 0 : (actor.system.penalty?.total ?? 0);
  const ignoreMods = !!input.ignoreMods && (actor.system.moxie.value > 0);
  const situational = (Number(input.difficulty) || 0) + (Number(input.modifier) || 0) + (input.specialized ? 10 : 0);
  const modifier = ignoreMods ? 0 : situational - penalty;
  const target = Math.max(0, base + modifier);

  const roll = await new Roll("1d100").evaluate();
  const test = {
    actorUuid: actor.uuid,
    label: (multiplier > 1) ? `${label} × ${multiplier}` : label,
    base, modifier, penalty: ignoreMods ? 0 : penalty, target,
    value: toPercentile(roll.total),
    moxie: ignoreMods ? "ignoreMods" : null,
    attack,
    defense,
    ego
  };
  if ( ignoreMods ) await actor.update({ "system.moxie.value": actor.system.moxie.value - 1 });

  const messageData = {
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    rolls: [roll],
    content: await renderTestCard(test),
    flags: { [SYSTEM_ID]: { test } }
  };
  return createMessage(messageData, input.messageMode);
}

/** Roll a test against a raw aptitude (defaulting, or APT x N tests). */
export function rollAptitudeTest(actor, key, options = {}) {
  const label = game.i18n.localize(`EP1E.Aptitude.${key}`);
  return rollSkillTest(actor, { label, target: actor.system.aptitudes[key].value, aptitude: key, ...options });
}

/* -------------------------------------------- */
/*  Chat cards                                  */
/* -------------------------------------------- */

/** Extra damage of an Excellent Success: +5/+10 for weapons, +5 for psi attacks (p. 228). */
const attackBonus = (attack, margin) => (attack.psi ? psiExcellentBonus(margin) : excellentBonus(margin));

export async function renderTestCard(test) {
  const result = evaluateTest(test);
  const damageBonus = (test.attack && result.success) ? attackBonus(test.attack, result.margin) : 0;
  return render(TEMPLATES.test, {
    test, result, damageBonus,
    outcomeLabel: `EP1E.Outcome.${result.outcome}`,
    canMoxie: !test.moxie,
    canUpgrade: !test.moxie && result.success && !result.critical,
    canIgnoreCrit: !test.moxie && !result.success && result.critical,
    showDamage: !!test.attack && result.success && !!(test.attack.formula ?? test.attack.dv),
    armorDefeating: !!test.attack && result.success && result.critical,
    // A called shot needs an Excellent Success; otherwise it is a normal hit (p. 196)
    calledShotMissed: !!test.attack?.calledShot && result.success && !result.excellent,
    ego: test.ego ? egoSummary(test, result) : null
  });
}

/** Spend a point of Moxie on an existing test message (Core p. 122). */
async function spendMoxie(message, mode) {
  const test = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  if ( !test || test.moxie ) return ui.notifications.warn("EP1E.Moxie.alreadySpent", { localize: true });
  const actor = await fromUuid(test.actorUuid);
  if ( !actor?.isOwner ) return;
  if ( actor.system.moxie.value < 1 ) return ui.notifications.warn("EP1E.Moxie.none", { localize: true });
  test.moxie = mode;
  if ( mode === "flip" ) test.value = flipFlop(test.value);
  await actor.update({ "system.moxie.value": actor.system.moxie.value - 1 });
  await message.update({ content: await renderTestCard(test), [`flags.${SYSTEM_ID}.test`]: test });
}

/** Roll damage from a successful attack test. */
async function rollDamageFromTest(message) {
  const test = message.getFlag(SYSTEM_ID, "test");
  const attack = test?.attack;
  if ( !attack ) return;
  const result = evaluateTest(test);
  const bonus = attackBonus(attack, result.margin);
  // Cards from before the attack dialog carry dv and db instead of a full formula
  const parts = [attack.formula ?? attack.dv ?? "0"];
  if ( !attack.formula && attack.db ) parts.push(String(attack.db));
  if ( bonus ) parts.push(String(bonus));
  const roll = await new Roll(parts.join(" + ")).evaluate();
  const actor = await fromUuid(test.actorUuid);
  return postDamageRoll(actor, roll, {
    attackId: message.id,
    shock: !!attack.shock,
    armorDoubled: !!attack.armorDoubled,
    stress: !!attack.stress,
    label: attack.name,
    ap: attack.ap,
    damageType: attack.damageType,
    armorDefeating: result.critical,
    excellentBonus: bonus
  });
}

/** Post a damage roll card with an "apply" button. */
export async function postDamageRoll(actor, roll, {
  label, ap = 0, damageType = "kinetic", armorDefeating = false, armorHalved = false, armorDoubled = false,
  excellentBonus = 0, stress = false, shock = false, attackId = null
}) {
  const damage = {
    label, total: roll.total, formula: roll.formula, ap, damageType, armorDefeating, armorHalved, armorDoubled,
    excellentBonus, stress, shock, attackId
  };
  const content = await render(TEMPLATES.damage, {
    damage,
    // Psi attacks use "psi" (mental armor), which weapons do not offer
    damageTypeLabel: `EP1E.DamageType.${damageType}`,
    tooltip: await roll.getTooltip()
  });
  return createMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    rolls: [roll],
    content,
    flags: { [SYSTEM_ID]: { damage } }
  });
}

/* -------------------------------------------- */
/*  Applying damage                             */
/* -------------------------------------------- */

/** Actors targeted by the current user, or the controlled tokens' actors. */
function getTargetActors() {
  const tokens = game.user.targets.size ? Array.from(game.user.targets) : (canvas.tokens?.controlled ?? []);
  return tokens.map(t => t.actor).filter(a => a);
}

/** Whisper recipients for reports about an NPC: the GMs only. */
export function gmWhisper(actor) {
  return actor.hasPlayerOwner ? [] : ChatMessage.implementation.getWhisperRecipients("GM").map(u => u.id);
}

/**
 * Apply a damage or stress payload to an actor and report the result in chat.
 * Shock weapons roll the victim's shock test first (p. 204); the conditions that follow are set on the actor.
 * @param {Actor} actor
 * @param {object} damage               Damage card payload
 * @param {object} [options]
 * @param {number} [options.total]      DV for this actor (blasts lose damage with distance)
 * @param {number} [options.distance]   Distance from a blast epicenter, for the report
 * @param {Roll[]} [options.rolls]      Rolls to show with the report
 */
export async function applyToActor(actor, damage, { total = damage.total, distance = null, rolls = [] } = {}) {
  let shock = null;
  let shockImmune = false;
  let dv = total;
  if ( !damage.stress && damage.shock ) {
    if ( isBiological(actor) ) {
      shock = await rollShock(actor);
      rolls = [...rolls, shock.roll];
      dv = shockedDamage(total, shock);
    }
    else shockImmune = true;
  }
  const result = damage.stress
    ? await actor.applyStress({ sv: total })
    : await actor.applyDamage({
      dv, ap: damage.ap, damageType: damage.damageType, armorDefeating: damage.armorDefeating,
      armorHalved: damage.armorHalved, armorDoubled: damage.armorDoubled
    });
  if ( !damage.stress ) {
    if ( shock ) await applyShockConditions(actor, shock);
    await updateHealthConditions(actor);
  }
  const sys = actor.system;
  const content = await render(TEMPLATES.applied, {
    actor, result, stress: !!damage.stress, distance, shock, shockImmune,
    max: damage.stress ? sys.stats.luc : sys.stats.dur,
    // Bots and vehicles: a Pilot Test to avoid crashing, and an automatic crash on 2+ wounds (p. 207)
    vehicle: actor.type === "vehicle",
    knockdown: !damage.stress && (result.wounds >= 1),
    unconscious: !damage.stress && (result.wounds >= 2),
    bleeding: !damage.stress && !!conditionEffect(actor, "bleeding"),
    status: sys.status,
    actorUuid: actor.uuid
  });
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls,
    whisper: gmWhisper(actor)
  });
}

/**
 * Who a damage card applies to, as [{ actor, total, distance }]: everyone a blast reaches,
 * the targets its attack hit, or, without targets on the attack (or on Shift+click),
 * the user's targeted or controlled tokens.
 */
async function damageRecipients(damage, { manual = false } = {}) {
  const asIs = actor => ({ actor, total: damage.total, distance: null });
  const attackMessage = (!manual && damage.attackId) ? game.messages.get(damage.attackId) : null;
  const targets = attackMessage ? resolveTargets(attackMessage) : [];
  if ( !targets.length ) return getTargetActors().map(asIs);
  const pending = targets.filter(t => t.state === "pending");
  if ( pending.length ) {
    ui.notifications.warn(game.i18n.format("EP1E.Opposed.pendingWarning", { names: pending.map(t => t.name).join(", ") }));
  }
  const blast = blastRecipients(attackMessage, damage.total);
  if ( blast ) return blast;
  const hits = targets.filter(t => ["hit", "undefended"].includes(t.state));
  return (await Promise.all(hits.map(t => fromUuid(t.actorUuid)))).filter(a => a).map(asIs);
}

async function applyDamageFromCard(message, { manual = false } = {}) {
  const damage = message.getFlag(SYSTEM_ID, "damage");
  if ( !damage ) return;
  let recipients = await damageRecipients(damage, { manual });
  if ( !recipients.length ) return ui.notifications.warn("EP1E.Damage.noTarget", { localize: true });
  // Each actor takes a card's damage once, unless the user insists with Shift+click
  const applied = new Set(message.getFlag(SYSTEM_ID, "applied") ?? []);
  if ( !manual ) {
    const already = recipients.filter(r => applied.has(r.actor.uuid));
    if ( already.length ) {
      ui.notifications.info(game.i18n.format("EP1E.Damage.alreadyApplied", { names: already.map(r => r.actor.name).join(", ") }));
    }
    recipients = recipients.filter(r => !applied.has(r.actor.uuid));
  }
  for ( const { actor, total, distance } of recipients ) {
    if ( actor.isOwner ) await applyToActor(actor, damage, { total, distance });
    else if ( game.users.activeGM ) {
      game.socket.emit(`system.${SYSTEM_ID}`, { action: "applyDamage", actorUuid: actor.uuid, damage, total, distance });
    }
    else {
      ui.notifications.warn("EP1E.Damage.noGM", { localize: true });
      continue;
    }
    applied.add(actor.uuid);
  }
  if ( message.isOwner ) await message.setFlag(SYSTEM_ID, "applied", [...applied]);
}

/** Socket handler: the active GM acts on behalf of players. */
export async function onSocketMessage(data) {
  if ( !game.users.activeGM?.isSelf ) return;
  switch ( data?.action ) {
    case "applyDamage": {
      const actor = await fromUuid(data.actorUuid);
      if ( actor ) await applyToActor(actor, data.damage, { total: data.total ?? data.damage.total, distance: data.distance ?? null });
      break;
    }
    case "waiveDefense": {
      const message = game.messages.get(data.messageId);
      if ( message ) await waiveDefense(message, data.tokenUuid);
      break;
    }
  }
}

/* -------------------------------------------- */
/*  Chat listeners                              */
/* -------------------------------------------- */

/** Wire up the buttons of a rendered chat message. */
export function onRenderChatMessage(message, html) {
  const test = message.getFlag(SYSTEM_ID, "test");
  // Moxie buttons are only usable by the roller
  if ( test && !message.isOwner ) html.querySelectorAll(".moxie-actions").forEach(el => el.remove());
  if ( test?.attack?.targets?.length ) renderTargets(message, html).then(() => activateButtons(message, html));
  else activateButtons(message, html);
}

function activateButtons(message, html) {
  html.querySelectorAll("[data-ep-action]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      button.disabled = true;
      try {
        await handleChatAction(message, button.dataset, event);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function handleChatAction(message, dataset, event) {
  switch ( dataset.epAction ) {
    case "moxie": return spendMoxie(message, dataset.mode);
    case "damage": return rollDamageFromTest(message);
    case "apply": return applyDamageFromCard(message, { manual: event.shiftKey });
    case "defend": return rollDefense(message, dataset.tokenUuid, { fastForward: event.shiftKey });
    case "waive": return waiveDefense(message, dataset.tokenUuid);
    case "scatter": return rollScatter(message);
    case "egoApply": return applyEgoResult(message);
    case "derangement": {
      const actor = await fromUuid(dataset.actorUuid);
      if ( actor?.isOwner ) return promptDerangement(actor);
      return;
    }
    case "egoBurn": return applyEgoResult(message, "burn");
    case "scorchEffect": {
      const test = message.getFlag(SYSTEM_ID, "test");
      const target = test?.attack?.targets?.find(t => t.tokenUuid === dataset.tokenUuid);
      const actor = target ? await fromUuid(target.actorUuid) : null;
      if ( actor?.isOwner ) return scorchEffect(actor, test.attack.effect, { excellent: evaluateTest(test).excellent });
      return;
    }
    case "addictionTest": {
      const actor = await fromUuid(dataset.actorUuid);
      const item = actor?.items.get(dataset.itemId);
      if ( actor?.isOwner && item ) return rollAddictionTest(actor, item);
      return;
    }
    case "crashTest": {
      const actor = await fromUuid(dataset.actorUuid);
      if ( !actor?.isOwner ) return;
      const sys = actor.system;
      return rollSkillTest(actor, {
        label: game.i18n.localize("EP1E.Vehicle.crashTest"), target: sys.pilot + sys.handling, fastForward: true
      });
    }
    case "seizureTest": {
      const actor = await fromUuid(dataset.actorUuid);
      if ( actor?.isOwner ) return rollSeizureTest(actor);
      return;
    }
    case "aptitudeTest": {
      const actor = await fromUuid(dataset.actorUuid);
      if ( !actor?.isOwner ) return;
      const test = await rollAptitudeTest(actor, dataset.aptitude, { multiplier: Number(dataset.multiplier) || 1 });
      // Knockdown and unconsciousness tests (p. 207): failure sets the condition
      const flag = test?.getFlag(SYSTEM_ID, "test");
      if ( dataset.condition && flag && !evaluateTest(flag).success ) await setCondition(actor, dataset.condition);
      return test;
    }
  }
}
