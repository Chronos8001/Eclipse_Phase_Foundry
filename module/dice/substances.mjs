import { SYSTEM_ID } from "../config.mjs";
import { addictionTarget, durationTurns, turnsToSeconds } from "../rules/gear.mjs";
import { DRUG_FIEND_MODIFIER, traitLevel } from "../rules/traits.mjs";
import { evaluateTest, gmWhisper, rollSkillTest } from "./tests.mjs";

/**
 * Taking drugs and other substances (Core pp. 317-325): one dose is spent, the substance's effects apply to
 * the actor for its duration (counted down each Action Turn in combat, and in world time), and addictive
 * substances call for a WIL x 3 Test modified by their Addiction Modifier.
 */

/**
 * Take one dose of a substance.
 * @param {Item} item  A substance owned by the actor taking it
 */
export async function takeSubstance(item) {
  const actor = item.actor;
  const s = item.system;
  if ( !actor ) return null;
  if ( s.quantity < 1 ) return ui.notifications.warn(game.i18n.format("EP1E.Substance.noneLeft", { name: item.name }));
  await item.update({ "system.quantity": s.quantity - 1 });

  // The substance's effects, copied onto the actor for the duration
  const turns = durationTurns(s.duration);
  const effects = item.effects.map(e => {
    const data = e.toObject();
    delete data._id;
    data.disabled = false;
    data.transfer = false;
    data.origin = item.uuid;
    data.name = item.name;
    data.img = item.img;
    if ( turns ) {
      data.duration = { ...(data.duration ?? {}), seconds: turnsToSeconds(turns) };
      foundry.utils.setProperty(data, `flags.${SYSTEM_ID}.timer`, { left: turns });
    }
    return data;
  });
  if ( effects.length ) await actor.createEmbeddedDocuments("ActiveEffect", effects);

  const addictive = !!s.addictionType;
  const content = `<div class="ep1e chat-card substance-card">
    <header class="card-header"><h3>${game.i18n.format("EP1E.Substance.taken", { name: actor.name, substance: item.name })}</h3></header>
    <p>${[s.onset && game.i18n.format("EP1E.Substance.onsetIn", { onset: s.onset }), s.duration && game.i18n.format("EP1E.Substance.lasts", { duration: s.duration })]
      .filter(x => x).join(" · ")}</p>
    ${addictive ? `<button type="button" data-ep-action="addictionTest" data-actor-uuid="${actor.uuid}" data-item-id="${item.id}">
      <i class="fa-solid fa-link"></i> ${game.i18n.format("EP1E.Substance.addictionTest", { modifier: s.addictionMod || "0" })}</button>` : ""}
  </div>`;
  return ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }), content, whisper: gmWhisper(actor) });
}

/** WIL x 3 Test to avoid addiction (p. 318): failure gives the Addiction trait (or raises its level). */
export async function rollAddictionTest(actor, item) {
  const message = await rollSkillTest(actor, {
    label: game.i18n.format("EP1E.Substance.addictionLabel", { name: item.name }),
    target: addictionTarget(actor.system.aptitudes.wil.value, item.system.addictionMod),
    // Drug Fiend (Transhuman p. 89): -20 on Addiction Tests
    input: { modifier: (traitLevel(actor.items, "drugFiend") > 0) ? DRUG_FIEND_MODIFIER : 0 },
    fastForward: true
  });
  const flag = message?.getFlag(SYSTEM_ID, "test");
  if ( flag && !evaluateTest(flag).success ) {
    ui.notifications.warn(game.i18n.format("EP1E.Substance.addicted", { name: actor.name, substance: item.name }));
  }
  return message;
}
