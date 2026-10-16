import { SYSTEM_ID } from "../config.mjs";
import { FULL_DEFENSE_BONUS, opposedWinner } from "../rules/combat.mjs";
import { evaluateTest, rollSkillTest, testDialogContext } from "./tests.mjs";

/**
 * Opposed attack resolution (Core p. 191). The attack card lists its targets; each defender rolls a
 * regular test card that points back to the attack. The attack card works out who is hit when rendered,
 * so Moxie spent on either roll is taken into account.
 */

const TEMPLATES = {
  defense: `systems/${SYSTEM_ID}/templates/dialog/defense.hbs`,
  targets: `systems/${SYSTEM_ID}/templates/chat/targets.hbs`
};
const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

/** Melee skills that may parry instead of dodging (p. 191). */
const PARRY_SKILLS = ["blades", "clubs", "exoticMelee", "unarmedCombat"];
const OPPOSED_STATES = { attacker: "hit", defender: "miss", deadlock: "deadlock" };

/* -------------------------------------------- */
/*  Resolution                                  */
/* -------------------------------------------- */

/** The latest defense test rolled against an attack message by a target token. */
function findDefense(attackMessage, tokenUuid) {
  return game.messages.contents.findLast(m => {
    const d = m.getFlag(SYSTEM_ID, "test")?.defense;
    return d && (d.attackId === attackMessage.id) && (d.tokenUuid === tokenUuid);
  }) ?? null;
}

/**
 * State of each target of an attack message.
 * @returns {object[]} { tokenUuid, actorUuid, name, state: pending|undefended|hit|miss|deadlock, defense }
 */
export function resolveTargets(message) {
  const test = message.getFlag(SYSTEM_ID, "test");
  const attack = test?.attack;
  if ( !attack?.targets?.length ) return [];
  const a = { ...evaluateTest(test), value: test.value };
  const undefended = message.getFlag(SYSTEM_ID, "undefended") ?? [];
  return attack.targets.map(target => {
    const entry = { ...target, state: "pending", defense: null };
    if ( !a.success ) entry.state = "miss";
    else if ( undefended.includes(target.tokenUuid) ) entry.state = "undefended";
    else {
      const defenseMessage = findDefense(message, target.tokenUuid);
      if ( defenseMessage ) {
        const dTest = defenseMessage.getFlag(SYSTEM_ID, "test");
        const d = { ...evaluateTest(dTest), value: dTest.value };
        entry.defense = { value: dTest.value, target: dTest.target, success: d.success };
        entry.state = OPPOSED_STATES[opposedWinner(a, d)];
      }
    }
    return entry;
  });
}

/** Targets that take damage from an attack: hit or unable to defend. */
export function hitTargets(message) {
  return resolveTargets(message).filter(t => ["hit", "undefended"].includes(t.state));
}

/** Show the live state of the targets on a rendered attack card. */
export async function renderTargets(message, html) {
  const container = html.querySelector(".attack-targets");
  if ( !container ) return;
  const targets = resolveTargets(message);
  if ( !targets.length ) return;
  const rows = await Promise.all(targets.map(async t => {
    const actor = t.actorUuid ? await fromUuid(t.actorUuid) : null;
    const canAct = !!actor?.isOwner;
    return {
      ...t,
      stateLabel: `EP1E.Opposed.${t.state}`,
      canDefend: (t.state === "pending") && canAct,
      canWaive: (t.state === "pending") && (canAct || game.user.isGM || message.isOwner)
    };
  }));
  container.outerHTML = await render(TEMPLATES.targets, { targets: rows });
}

/** Re-render the attack card a defense test belongs to. */
export function refreshAttackCard(defenseMessage) {
  const attackId = defenseMessage.getFlag(SYSTEM_ID, "test")?.defense?.attackId;
  const attackMessage = attackId ? game.messages.get(attackId) : null;
  if ( attackMessage ) ui.chat?.updateMessage?.(attackMessage);
}

/* -------------------------------------------- */
/*  Defense                                     */
/* -------------------------------------------- */

/**
 * Roll the defense of a target against an attack card: Fray (halved against ranged attacks),
 * a melee skill to parry, or Freerunning while on full defense; +30 on full defense (p. 198).
 */
export async function rollDefense(attackMessage, tokenUuid, { fastForward = false } = {}) {
  const attack = attackMessage.getFlag(SYSTEM_ID, "test")?.attack;
  const target = attack?.targets?.find(t => t.tokenUuid === tokenUuid);
  const actor = target?.actorUuid ? await fromUuid(target.actorUuid) : null;
  if ( !actor?.isOwner ) return;
  const sys = actor.system;

  const fullDefense = actor.statuses?.has("fullDefense");
  const keys = ["fray"];
  if ( !attack.ranged ) keys.push(...PARRY_SKILLS.filter(k => sys.getSkill(k)));
  if ( fullDefense ) keys.push("freerunning");
  // Only Fray is halved against ranged attacks; mods.defense carries full defense and other effects
  const options = keys.map(key => {
    const { target: value, label } = sys.getSkillTarget(key);
    const halved = attack.ranged && (key === "fray");
    return { key, label, value: (halved ? Math.floor(value / 2) : value) + sys.mods.defense, halved };
  });

  let input = { skill: "fray" };
  if ( !fastForward ) {
    const content = await render(TEMPLATES.defense, {
      ...testDialogContext(actor, { label: attack.name, target: options[0].value }),
      attackName: attack.name,
      options,
      fullDefense: fullDefense ? FULL_DEFENSE_BONUS : 0
    });
    input = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("EP1E.Opposed.defendTitle", { name: actor.name }), icon: "fa-solid fa-shield-halved" },
      classes: ["ep1e", "ep1e-dialog"],
      content,
      buttons: [{
        action: "roll", label: "EP1E.Opposed.defend", icon: "fa-solid fa-shield-halved", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      }],
      rejectClose: false
    });
    if ( !input ) return null;
  }
  const choice = options.find(o => o.key === input.skill) ?? options[0];
  const skill = sys.getSkill(choice.key);
  return rollSkillTest(actor, {
    label: game.i18n.format(choice.halved ? "EP1E.Opposed.defenseRanged" : "EP1E.Opposed.defenseLabel", {
      skill: choice.label, name: attack.name
    }),
    target: choice.value,
    specialization: skill?.system.specialization,
    fastForward: true,
    input: { ...input, difficulty: Number(input.difficulty) || 0, modifier: Number(input.modifier) || 0 },
    defense: { attackId: attackMessage.id, tokenUuid }
  });
}

/**
 * Declare that a target does not defend (surprised, incapacitated...): the attack hits on a success.
 * Players who do not own the attack card ask the GM to record it.
 */
export async function waiveDefense(attackMessage, tokenUuid) {
  if ( !attackMessage.isOwner ) {
    if ( !game.users.activeGM ) return ui.notifications.warn("EP1E.Damage.noGM", { localize: true });
    return game.socket.emit(`system.${SYSTEM_ID}`, { action: "waiveDefense", messageId: attackMessage.id, tokenUuid });
  }
  const undefended = new Set(attackMessage.getFlag(SYSTEM_ID, "undefended") ?? []);
  undefended.add(tokenUuid);
  return attackMessage.setFlag(SYSTEM_ID, "undefended", [...undefended]);
}
