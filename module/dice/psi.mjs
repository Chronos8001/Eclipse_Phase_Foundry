import { SYSTEM_ID } from "../config.mjs";
import * as psi from "../rules/psi.mjs";
import { SHOCK_MODIFIER } from "../rules/combat.mjs";
import { setCondition } from "../helpers/effects.mjs";
import { actorToken, tokenDistance } from "./attack.mjs";
import { applyToActor, evaluateTest, gmWhisper, rollSkillTest, testDialogContext } from "./tests.mjs";

/**
 * Psi sleights (Core pp. 220-228): activation, opposed tests against WIL x 2, strain, seizures,
 * and the countdown of temporary sleights.
 */

const TEMPLATE = `systems/${SYSTEM_ID}/templates/dialog/sleight.hbs`;
const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

/** The sleight an actor knows with a given key. */
const knownSleight = (actor, key) => actor.items.find(i => (i.type === "sleight") && (i.system.key === key)) ?? null;

/* -------------------------------------------- */
/*  Using a sleight                             */
/* -------------------------------------------- */

/**
 * Use a sleight. Passive sleights are only described; a sleight in use is ended instead.
 * @param {Actor} actor
 * @param {Item} item              The sleight
 * @param {object} [options]
 * @param {boolean} [options.fastForward]  Skip the dialog
 */
export async function useSleight(actor, item, options = {}) {
  const s = item.system;
  const sys = actor.system;
  if ( s.activation === "passive" ) return item.toChat();
  if ( s.active ) return endSleight(item, { announce: true });

  const level = psi.REQUIRED_LEVEL[s.psiType] ?? 1;
  if ( sys.psi.level < level ) {
    ui.notifications.warn(game.i18n.format("EP1E.Psi.levelTooLow", { name: item.name, level }));
  }

  // Targets: only biological brains (p. 221)
  const tokens = (s.range === "self") ? [] : Array.from(game.user.targets).filter(t => t.actor);
  const excluded = tokens.filter(t => !psi.canBeTargeted(t.actor.system.morph?.type));
  if ( excluded.length ) {
    ui.notifications.warn(game.i18n.format("EP1E.Psi.cannotTarget", { names: excluded.map(t => t.name).join(", ") }));
  }
  const valid = tokens.filter(t => !excluded.includes(t));
  const targets = valid.map(t => ({ tokenUuid: t.document.uuid, actorUuid: t.actor.uuid, name: t.name }));

  // Close range: the farthest target sets the modifier; the range doubles when every target is an async
  let distance = null;
  let rangeModifier = 0;
  if ( (s.range === "close") && valid.length ) {
    const me = actorToken(actor);
    const distances = valid.map(t => tokenDistance(me, t)).filter(d => d !== null);
    if ( distances.length ) {
      distance = Math.max(...distances);
      const vsAsync = valid.every(t => (t.actor.system.psi?.level ?? 0) > 0);
      rangeModifier = psi.closeRangeModifier(distance, { vsAsync });
    }
  }

  const { target, label, skill } = s.skill ? sys.getSkillTarget(s.skill) : { target: 0, label: "", skill: null };
  // Penetration (p. 228) buys AP for Psi Assault attacks, 1 strain per point
  const maxAP = (s.skill === "psiAssault") && s.damage && knownSleight(actor, "penetration") ? psi.maxPenetration(target) : 0;

  let input = { creature: "sentient", ap: 0 };
  const needsDialog = !!s.skill || targets.length;
  if ( needsDialog && !options.fastForward ) {
    const content = await render(TEMPLATE, {
      ...testDialogContext(actor, { label: item.name, target, specialization: skill?.system.specialization }),
      sleight: item, skillLabel: label, targets, excluded: excluded.map(t => t.name),
      distance: (distance !== null) ? Math.round(distance) : null, rangeModifier,
      creatures: Object.entries(psi.CREATURES).map(([key, c]) => ({ key, label: `EP1E.PsiCreature.${key}`, ...c })),
      maxAP, strainFree: strainFree(actor, item)
    });
    input = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("EP1E.Psi.useTitle", { name: item.name }), icon: "fa-solid fa-brain" },
      classes: ["ep1e", "ep1e-dialog"],
      content,
      buttons: [{
        action: "use", label: "EP1E.Psi.use", icon: "fa-solid fa-brain", default: true,
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      }],
      rejectClose: false
    });
    if ( !input ) return null;
  }
  const creature = psi.CREATURES[input.creature] ? input.creature : "sentient";
  const ap = Math.clamp(Number(input.ap) || 0, 0, maxAP);

  // The test: opposed by each target's WIL x 2 through the attack card, or a plain Success Test
  let success = true;
  if ( s.skill ) {
    const notes = [game.i18n.localize(`EP1E.PsiRange.${s.range}`)];
    if ( rangeModifier ) notes.push(`${game.i18n.localize("EP1E.Attack.range")} ${rangeModifier}`);
    if ( creature !== "sentient" ) notes.push(game.i18n.localize(`EP1E.PsiCreature.${creature}`));
    if ( ap ) notes.push(`${game.i18n.localize("EP1E.Weapon.ap")} −${ap}`);
    const message = await rollSkillTest(actor, {
      label: `${item.name} (${label})`,
      target,
      specialization: skill?.system.specialization,
      fastForward: true,
      input: {
        difficulty: Number(input.difficulty) || 0,
        modifier: (Number(input.modifier) || 0) + rangeModifier + psi.CREATURES[creature].modifier,
        specialized: !!input.specialized,
        ignoreMods: !!input.ignoreMods,
        messageMode: input.messageMode
      },
      attack: targets.length ? {
        psi: true,
        sleightUuid: item.uuid,
        name: item.name,
        formula: s.damage ? Roll.replaceFormulaData(s.damage, actor.getRollData()) : "",
        ap: -ap,
        damageType: "psi",
        stress: s.harm === "stress",
        ranged: false,
        notes,
        targets
      } : null
    });
    const flag = message?.getFlag(SYSTEM_ID, "test");
    if ( !flag ) return null;
    const result = evaluateTest(flag);
    success = result.success;
    if ( !result.success && result.critical ) await seizure(actor);
  }
  else await item.toChat();

  // Strain (p. 223) applies on use, for each target
  if ( !strainFree(actor, item) ) {
    const formulas = psi.strainFormulas({
      mod: s.strainMod, targets: targets.length, perTarget: s.strainPerTarget, ap, creature
    });
    for ( const formula of formulas ) {
      const roll = await new Roll(formula).evaluate();
      await applyToActor(actor, {
        label: game.i18n.format("EP1E.Psi.strainOf", { name: item.name }), total: Math.max(0, roll.total), ap: 0, damageType: "none"
      }, { rolls: [roll] });
    }
  }

  if ( success && ["temporary", "sustained"].includes(s.duration) ) await startSleight(item);
  return true;
}

/** Exsurgents (Psi level 3) draw on their surroundings instead of suffering strain (p. 371). */
function strainFree(actor, item) {
  return (actor.system.psi.level >= 3) || (item.system.psiType === "epsilon");
}

/* -------------------------------------------- */
/*  Sleights in use                             */
/* -------------------------------------------- */

/** Start a temporary or sustained sleight and switch on its effects. */
export async function startSleight(item) {
  const s = item.system;
  const wil = item.actor?.system.aptitudes.wil.value ?? 0;
  await item.update({
    "system.active": true,
    "system.remaining": (s.duration === "temporary") ? psi.temporaryDuration(wil, s.durationUnit) : 0
  });
  await setSleightEffects(item, true);
}

/** End a sleight in use and switch off its effects. */
export async function endSleight(item, { announce = false } = {}) {
  await item.update({ "system.active": false, "system.remaining": 0 });
  await setSleightEffects(item, false);
  if ( announce ) ui.notifications.info(game.i18n.format("EP1E.Psi.ended", { name: item.name }));
}

/** Effects of active sleights only apply while the sleight is in use. */
function setSleightEffects(item, enabled) {
  if ( item.system.activation !== "active" ) return;
  const updates = item.effects.filter(e => e.disabled === enabled).map(e => ({ _id: e.id, disabled: !enabled }));
  if ( updates.length ) return item.updateEmbeddedDocuments("ActiveEffect", updates);
}

/** Count down an actor's temporary sleights by one Action Turn. */
export async function tickSleights(actor) {
  for ( const item of actor.items ) {
    const s = item.system;
    if ( (item.type !== "sleight") || !s.active || (s.duration !== "temporary") ) continue;
    if ( s.remaining > 1 ) await item.update({ "system.remaining": s.remaining - 1 });
    else await endSleight(item);
  }
}

/* -------------------------------------------- */
/*  Seizures                                    */
/* -------------------------------------------- */

/**
 * Critical failure on a sleight test (p. 221): -30 and unable to act until the end of the next Action Turn,
 * and a WIL + COG Test to stay standing.
 */
export async function seizure(actor) {
  await setCondition(actor, "incapacitated", { timer: { left: 2 } });
  await setCondition(actor, "stunned", { modifier: SHOCK_MODIFIER, timer: { left: 2 } });
  const content = `<div class="ep1e chat-card"><p class="danger">${game.i18n.format("EP1E.Psi.seizure", { name: actor.name })}</p>
    <button type="button" data-ep-action="seizureTest" data-actor-uuid="${actor.uuid}">
    <i class="fa-solid fa-person-falling"></i> ${game.i18n.localize("EP1E.Psi.seizureTest")}</button></div>`;
  return ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }), content, whisper: gmWhisper(actor) });
}

/** WIL + COG Test after a seizure: failure leaves the async prone. */
export async function rollSeizureTest(actor) {
  const a = actor.system.aptitudes;
  const message = await rollSkillTest(actor, {
    label: game.i18n.localize("EP1E.Psi.seizureTest"), target: a.wil.value + a.cog.value, fastForward: true
  });
  const flag = message?.getFlag(SYSTEM_ID, "test");
  if ( flag && !evaluateTest(flag).success ) await setCondition(actor, "prone");
  return message;
}
