import { APTITUDES, SKILLS, SYSTEM_ID } from "../config.mjs";
import { SkillData } from "../data/item.mjs";
import { gmWhisper } from "./tests.mjs";

/**
 * Backgrounds, factions and packages dropped on a character (Core pp. 131-134, Transhuman pp. 13-41): their skill
 * ranks are added (as free ranks, which cost no CP), with their aptitude, Moxie and credit bonuses and their traits
 * (free, cost 0). What the player chooses is listed in chat, to do by hand.
 */

const L = (key, data) => (data ? game.i18n.format(`EP1E.Background.${key}`, data) : game.i18n.localize(`EP1E.Background.${key}`));
const norm = text => String(text ?? "").trim().toLowerCase();

/** The trait of the system's compendium with this name, as item data. */
async function traitData(name) {
  const pack = game.packs.get(`${SYSTEM_ID}.traits`);
  const entry = pack?.index.find(e => norm(e.name) === norm(name));
  return entry ? (await pack.getDocument(entry._id)).toObject() : null;
}

/**
 * Apply a background, faction or package item just added to an actor.
 * @param {Item} item
 */
export async function applyBackground(item) {
  const actor = item.actor;
  const b = item.system;
  if ( !actor || !["character", "npc"].includes(actor.type) || item.getFlag(SYSTEM_ID, "applied") ) return;
  const report = [];

  // Skills: ranks added to the skill (created when missing); a skill already raised by another package is noted
  const updates = [];
  const creations = [];
  for ( const s of b.skills ) {
    const existing = actor.items.find(i => (i.type === "skill") && (s.key ? (i.system.key === s.key) : (norm(i.name) === norm(s.name))) &&
      (norm(i.system.field) === norm(s.field)));
    const label = s.field ? `${s.name}: ${s.field}` : s.name;
    if ( existing ) {
      const pending = updates.find(u => u._id === existing.id);
      const base = pending ?? { _id: existing.id, "system.ranks": existing.system.ranks, "system.free": existing.system.free };
      if ( (existing.system.free > 0) || pending ) report.push(L("duplicate", { skill: label }));
      base["system.ranks"] += s.value;
      base["system.free"] += s.value;
      if ( !pending ) updates.push(base);
    }
    else if ( s.key && SKILLS[s.key] ) {
      creations.push(SkillData.fromKey(s.key, { system: { field: s.field, ranks: s.value, free: s.value } }));
    }
    else {
      creations.push({ name: s.name, type: "skill", img: "icons/svg/book.svg",
        system: { key: "", aptitude: "cog", category: "knowledge", field: s.field, ranks: s.value, free: s.value } });
      report.push(L("unknownSkill", { skill: label }));
    }
  }
  // Traits from the compendium, free since they come with the background (p. 136)
  for ( const t of b.traits ) {
    const data = await traitData(t.name);
    if ( !data ) {
      report.push(L("unknownTrait", { trait: t.name }));
      continue;
    }
    delete data._id;
    data.system.level = t.level;
    data.system.cost = 0;
    creations.push(data);
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  if ( creations.length ) await actor.createEmbeddedDocuments("Item", creations);

  const sys = actor.system;
  const actorUpdate = {};
  for ( const k of APTITUDES ) {
    if ( b.aptitudes[k] ) actorUpdate[`system.aptitudes.${k}.base`] = sys.aptitudes[k].base + b.aptitudes[k];
  }
  if ( b.moxie ) {
    actorUpdate["system.moxie.max"] = sys.moxie.max + b.moxie;
    actorUpdate["system.moxie.value"] = sys.moxie.value + b.moxie;
  }
  if ( b.credit ) actorUpdate["system.details.credits"] = Math.max(0, sys.details.credits + b.credit);
  // Rep of a given network is added; Rep "of your choice" is left to share out
  const repGiven = !!(b.rep && b.repNetwork && (b.repNetwork in sys.rep));
  if ( repGiven ) actorUpdate[`system.rep.${b.repNetwork}`] = Math.max(0, sys.rep[b.repNetwork] + b.rep);
  if ( (b.kind === "background") && !sys.details.background ) actorUpdate["system.details.background"] = item.name;
  if ( (b.kind === "faction") && !sys.details.faction ) actorUpdate["system.details.faction"] = item.name;
  if ( !foundry.utils.isEmpty(actorUpdate) ) await actor.update(actorUpdate);
  await item.setFlag(SYSTEM_ID, "applied", true);

  const todo = [(b.rep && !repGiven) && L("repTodo", { rep: b.rep }), b.choices, b.restrictions].filter(x => x);
  ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="ep1e chat-card"><p>${L("applied", { name: actor.name, item: item.name })}</p>
      ${todo.length ? `<p><strong>${L("todo")}</strong> ${todo.join(" · ")}</p>` : ""}
      ${report.map(r => `<p class="hint">${r}</p>`).join("")}
      <p class="hint">${L("notReverted")}</p></div>`,
    whisper: gmWhisper(actor)
  });
}
