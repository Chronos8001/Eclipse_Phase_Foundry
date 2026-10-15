/**
 * Eclipse Phase (1st Edition) for Foundry Virtual Tabletop — v13 / v14.
 */
import { EP1E, SYSTEM_ID } from "./config.mjs";
import { CharacterData, NpcData } from "./data/actor.mjs";
import * as itemModels from "./data/item.mjs";
import { EPActor } from "./documents/actor.mjs";
import { EPItem } from "./documents/item.mjs";
import { EPActorSheet } from "./sheets/actor-sheet.mjs";
import { EPItemSheet } from "./sheets/item-sheet.mjs";
import * as tests from "./dice/tests.mjs";

const ITEM_TYPES = ["skill", "morph", "trait", "weapon", "armor", "gear", "augmentation", "sleight"];

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Initializing Eclipse Phase (1st Edition)`);

  CONFIG.EP1E = EP1E;
  game[SYSTEM_ID] = { tests, rollItemMacro };

  CONFIG.Actor.documentClass = EPActor;
  CONFIG.Item.documentClass = EPItem;
  CONFIG.Actor.dataModels = { character: CharacterData, npc: NpcData };
  CONFIG.Item.dataModels = {
    skill: itemModels.SkillData,
    morph: itemModels.MorphData,
    trait: itemModels.TraitData,
    weapon: itemModels.WeaponData,
    armor: itemModels.ArmorData,
    gear: itemModels.GearData,
    augmentation: itemModels.AugmentationData,
    sleight: itemModels.SleightData
  };

  // Token bars: damage (vs. Durability) and stress (vs. Lucidity)
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["damage", "stress", "moxie"], value: ["wounds.value", "trauma.value"] },
    npc: { bar: ["damage", "stress", "moxie"], value: ["wounds.value", "trauma.value"] }
  };

  // Initiative: d100 (00-99) + INIT, reduced by wound/trauma modifiers (Core p. 188)
  CONFIG.Combat.initiative = { formula: "1d100 - 1 + @initiative", decimals: 0 };

  // Items transfer their effects to the owning actor directly (V14 behaviour)
  if ( "legacyTransferral" in CONFIG.ActiveEffect ) CONFIG.ActiveEffect.legacyTransferral = false;

  const { Actors, Items } = foundry.documents.collections;
  Actors.registerSheet(SYSTEM_ID, EPActorSheet, {
    types: ["character", "npc"], makeDefault: true, label: "EP1E.Sheet.actor"
  });
  Items.registerSheet(SYSTEM_ID, EPItemSheet, {
    types: ITEM_TYPES, makeDefault: true, label: "EP1E.Sheet.item"
  });

  registerHandlebarsHelpers();
  return preloadTemplates();
});

Hooks.once("ready", () => {
  game.socket.on(`system.${SYSTEM_ID}`, tests.onSocketMessage);
});

Hooks.on("renderChatMessageHTML", (message, html) => tests.onRenderChatMessage(message, html));

/** Dropping an owned item on the hotbar creates a macro that rolls it. */
Hooks.on("hotbarDrop", (bar, data, slot) => {
  if ( data.type !== "Item" ) return;
  createItemMacro(data, slot);
  return false;
});

/* -------------------------------------------- */

async function createItemMacro(data, slot) {
  const item = await fromUuid(data.uuid);
  if ( !item?.actor ) return ui.notifications.warn("EP1E.Macro.ownedOnly", { localize: true });
  const command = `game.${SYSTEM_ID}.rollItemMacro("${item.uuid}");`;
  let macro = game.macros.find(m => (m.name === item.name) && (m.command === command));
  macro ??= await Macro.implementation.create({ name: item.name, type: "script", img: item.img, command });
  return game.user.assignHotbarMacro(macro, slot);
}

async function rollItemMacro(uuid) {
  const item = await fromUuid(uuid);
  if ( !item ) return ui.notifications.warn("EP1E.Macro.missing", { localize: true });
  return item.roll();
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("ep1eSigned", value => {
    const n = Number(value) || 0;
    return n > 0 ? `+${n}` : String(n);
  });
  Handlebars.registerHelper("ep1ePad", value => String(value ?? 0).padStart(2, "0"));
  Handlebars.registerHelper("ep1eFlip", value => tests.flipFlop(Number(value) || 0));
  Handlebars.registerHelper("ep1eHalf", value => Math.floor((Number(value) || 0) / 2));
}

function preloadTemplates() {
  const base = `systems/${SYSTEM_ID}/templates`;
  return foundry.applications.handlebars.loadTemplates([
    ...ITEM_TYPES.map(t => `${base}/item/parts/${t}.hbs`),
    `${base}/actor/parts/item-controls.hbs`,
    `${base}/parts/effects-list.hbs`
  ]);
}
