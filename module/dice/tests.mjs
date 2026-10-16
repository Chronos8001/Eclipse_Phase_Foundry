import { DIFFICULTIES, SYSTEM_ID } from "../config.mjs";
import { createMessage, defaultMessageMode, messageModeChoices } from "../helpers/chat.mjs";
import { excellentBonus } from "../rules/combat.mjs";

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
 * @param {object} [options.input]         Preset dialog values (difficulty, modifier, specialized, ignoreMods, messageMode)
 * @param {boolean} [options.fastForward]  Skip the dialog
 */
export async function rollSkillTest(actor, options = {}) {
  const { label, attack = null } = options;
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

  const penalty = actor.system.penalty?.total ?? 0;
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
    attack
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

export async function renderTestCard(test) {
  const result = evaluateTest(test);
  const damageBonus = (test.attack && result.success) ? excellentBonus(result.margin) : 0;
  return render(TEMPLATES.test, {
    test, result, damageBonus,
    outcomeLabel: `EP1E.Outcome.${result.outcome}`,
    canMoxie: !test.moxie,
    canUpgrade: !test.moxie && result.success && !result.critical,
    canIgnoreCrit: !test.moxie && !result.success && result.critical,
    showDamage: !!test.attack && result.success && !!(test.attack.formula ?? test.attack.dv),
    armorDefeating: !!test.attack && result.success && result.critical,
    // A called shot needs an Excellent Success; otherwise it is a normal hit (p. 196)
    calledShotMissed: !!test.attack?.calledShot && result.success && !result.excellent
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
  const bonus = excellentBonus(result.margin);
  // Cards from before the attack dialog carry dv and db instead of a full formula
  const parts = [attack.formula ?? attack.dv ?? "0"];
  if ( !attack.formula && attack.db ) parts.push(String(attack.db));
  if ( bonus ) parts.push(String(bonus));
  const roll = await new Roll(parts.join(" + ")).evaluate();
  const actor = await fromUuid(test.actorUuid);
  return postDamageRoll(actor, roll, {
    label: attack.name,
    ap: attack.ap,
    damageType: attack.damageType,
    armorDefeating: result.critical,
    excellentBonus: bonus
  });
}

/** Post a damage roll card with an "apply" button. */
export async function postDamageRoll(actor, roll, { label, ap = 0, damageType = "kinetic", armorDefeating = false, excellentBonus = 0, stress = false }) {
  const damage = { label, total: roll.total, formula: roll.formula, ap, damageType, armorDefeating, excellentBonus, stress };
  const content = await render(TEMPLATES.damage, {
    damage,
    damageTypeLabel: CONFIG.EP1E.damageTypes[damageType],
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

/** Apply a damage or stress payload to an actor and report the result in chat. */
export async function applyToActor(actor, damage) {
  const result = damage.stress
    ? await actor.applyStress({ sv: damage.total })
    : await actor.applyDamage({
      dv: damage.total, ap: damage.ap, damageType: damage.damageType, armorDefeating: damage.armorDefeating
    });
  const sys = actor.system;
  const content = await render(TEMPLATES.applied, {
    actor, result, stress: !!damage.stress,
    max: damage.stress ? sys.stats.luc : sys.stats.dur,
    knockdown: !damage.stress && (result.wounds >= 1),
    unconscious: !damage.stress && (result.wounds >= 2),
    status: sys.status,
    actorUuid: actor.uuid
  });
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    whisper: actor.hasPlayerOwner ? [] : ChatMessage.implementation.getWhisperRecipients("GM").map(u => u.id)
  });
}

async function applyDamageFromCard(message) {
  const damage = message.getFlag(SYSTEM_ID, "damage");
  if ( !damage ) return;
  const actors = getTargetActors();
  if ( !actors.length ) return ui.notifications.warn("EP1E.Damage.noTarget", { localize: true });
  for ( const actor of actors ) {
    if ( actor.isOwner ) await applyToActor(actor, damage);
    else if ( game.users.activeGM ) {
      game.socket.emit(`system.${SYSTEM_ID}`, { action: "applyDamage", actorUuid: actor.uuid, damage });
    }
    else ui.notifications.warn("EP1E.Damage.noGM", { localize: true });
  }
}

/** Socket handler: the active GM applies damage on behalf of players. */
export async function onSocketMessage(data) {
  if ( !game.users.activeGM?.isSelf ) return;
  if ( data?.action !== "applyDamage" ) return;
  const actor = await fromUuid(data.actorUuid);
  if ( actor ) await applyToActor(actor, data.damage);
}

/* -------------------------------------------- */
/*  Chat listeners                              */
/* -------------------------------------------- */

/** Wire up the buttons of a rendered chat message. */
export function onRenderChatMessage(message, html) {
  const test = message.getFlag(SYSTEM_ID, "test");
  // Moxie buttons are only usable by the roller
  if ( test && !message.isOwner ) html.querySelectorAll(".moxie-actions").forEach(el => el.remove());
  html.querySelectorAll("[data-ep-action]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      button.disabled = true;
      try {
        await handleChatAction(message, button.dataset);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function handleChatAction(message, dataset) {
  switch ( dataset.epAction ) {
    case "moxie": return spendMoxie(message, dataset.mode);
    case "damage": return rollDamageFromTest(message);
    case "apply": return applyDamageFromCard(message);
    case "aptitudeTest": {
      const actor = await fromUuid(dataset.actorUuid);
      if ( !actor?.isOwner ) return;
      return rollAptitudeTest(actor, dataset.aptitude, { multiplier: Number(dataset.multiplier) || 1 });
    }
  }
}
