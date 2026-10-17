import { REP_NETWORKING, REP_NETWORKS, SKILLS, SYSTEM_ID } from "../config.mjs";
import * as ego from "../rules/ego.mjs";
import * as traits from "../rules/traits.mjs";
import { applyToActor, evaluateTest, gmWhisper, renderTestCard, rollSkillTest } from "./tests.mjs";
import { MENTAL_KINDS, applyMentalResult, mentalSummary } from "./mental.mjs";

/**
 * The ego (Core pp. 268-289): resleeving tests, backups, forks and merging, and favors from reputation networks.
 * Each test is a standard test card carrying test.ego = { kind, ... }; its "apply" button reads the result when
 * clicked, so Moxie spent on the test beforehand counts.
 */

const T = name => `systems/${SYSTEM_ID}/templates/dialog/${name}.hbs`;
const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);
const L = (key, data) => (data ? game.i18n.format(`EP1E.Ego.${key}`, data) : game.i18n.localize(`EP1E.Ego.${key}`));

/** Skills of the physical aptitudes: an integration penalty to "physical actions" applies to them. */
const PHYSICAL_APTITUDES = ["coo", "ref", "som"];
const PHYSICAL_SKILLS = Object.entries(SKILLS).filter(([, c]) => PHYSICAL_APTITUDES.includes(c.aptitude)).map(([k]) => k);

const traitLevel = (actor, key) => traits.traitLevel(actor.items, key);

async function prompt(title, template, data, icon = "fa-solid fa-id-card") {
  const content = await render(T(template), data);
  return foundry.applications.api.DialogV2.wait({
    window: { title, icon },
    classes: ["ep1e", "ep1e-dialog"],
    content,
    buttons: [{
      action: "ok", label: "EP1E.Test.roll", icon: "fa-solid fa-dice", default: true,
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    }],
    rejectClose: false
  });
}

/* -------------------------------------------- */
/*  Resleeving (pp. 271-272)                    */
/* -------------------------------------------- */

/**
 * Prompt for the resleeving tests into a morph, then roll Integration (SOM x 3, ego SOM), Alienation (INT x 3)
 * and Continuity (WIL x 3).
 * @param {Actor} actor
 * @param {Item} morph   The morph sleeved
 * @param {object} [options]
 * @param {string[]} [options.preset]   Modifiers checked from the start (a fork: ["fork"])
 * @param {string} [options.situation]  Continuity situation preset
 */
export async function promptResleeve(actor, morph, { preset = [], situation = "stackPeaceful" } = {}) {
  const type = morph?.system.morphType;
  const modifiers = ego.SLEEVING_MODIFIERS.map(m => ({
    ...m,
    label: `EP1E.Ego.modifier.${m.key}`,
    checked: preset.includes(m.key) || (m.trait && (traitLevel(actor, m.trait) === m.level)) ||
      (m.morphType && (m.morphType === type)) || (m.key === "agi" && actor.system.ai)
  }));
  const data = await prompt(L("resleeveTitle", { name: actor.name, morph: morph?.name ?? "—" }), "resleeve", {
    modifiers,
    situations: Object.keys(ego.CONTINUITY_SITUATIONS).map(k => ({ key: k, label: `EP1E.Ego.situation.${k}`, selected: k === situation })),
    infomorph: type === "infomorph"
  });
  if ( !data ) return null;
  const keys = ego.SLEEVING_MODIFIERS.map(m => m.key).filter(k => data[`mod.${k}`]);
  const morphName = morph?.name ?? "";
  const apt = actor.system.aptitudes;
  // An infomorph does not make an Integration Test: it has no body to acclimate to (p. 273)
  if ( type !== "infomorph" ) {
    await rollSkillTest(actor, {
      label: L("integration"), target: ego.integrationTarget(apt.som.base), fastForward: true,
      input: { modifier: ego.sleevingModifier(keys, "integration") },
      ego: { kind: "integration", morph: morphName, morphId: morph?.id ?? null }
    });
  }
  await rollSkillTest(actor, {
    label: L("alienation"), target: apt.int.value * 3, fastForward: true,
    input: { modifier: ego.sleevingModifier(keys, "alienation") },
    ego: { kind: "alienation", morph: morphName }
  });
  return rollSkillTest(actor, {
    label: L("continuity"), target: apt.wil.value * 3, fastForward: true,
    input: { modifier: traits.phoenixBonus(traitLevel(actor, "phoenix")) },
    ego: { kind: "continuity", situation: data.situation, notKnowing: !!data.notKnowing }
  });
}

/** Integration effects that last "until resleeved" end when the actor sleeves another morph. */
export async function endIntegration(actor) {
  const ids = actor.effects.filter(e => e.getFlag(SYSTEM_ID, "untilResleeved")).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** The active effect of an integration penalty, lasting the given days in world time (or until resleeved). */
function integrationEffectData(effect, morph) {
  const changes = effect.physical
    ? PHYSICAL_SKILLS.map(k => ({ key: `system.skillMods.${k}`, mode: 2, type: "add", value: String(effect.modifier), priority: null }))
    : [{ key: "system.mods.actions", mode: 2, type: "add", value: String(effect.modifier), priority: null }];
  const flags = { [SYSTEM_ID]: {} };
  const data = {
    name: L(effect.physical ? "integrationEffectPhysical" : "integrationEffectAll", { morph, modifier: effect.modifier }),
    img: "icons/svg/daze.svg", changes, disabled: false, transfer: false, flags
  };
  if ( effect.days === null ) flags[SYSTEM_ID].untilResleeved = true;
  else {
    data.duration = { seconds: effect.days * 86400, startTime: game.time.worldTime };
    flags[SYSTEM_ID].expiresAt = game.time.worldTime + (effect.days * 86400);
  }
  return data;
}

/* -------------------------------------------- */
/*  Backups (p. 270)                            */
/* -------------------------------------------- */

/** LUC Test for a backup made from a damaged brain, a farcast or a dead morph. */
export function rollBackupTest(actor) {
  return rollSkillTest(actor, { label: L("backupTest"), target: actor.system.stats.luc, ego: { kind: "backup" } });
}

/* -------------------------------------------- */
/*  Forks (pp. 273-274)                         */
/* -------------------------------------------- */

/** The Infomorph morph of the system's morph compendium, for a fork's mind state. */
async function infomorphData() {
  const pack = game.packs.get(`${SYSTEM_ID}.morphs`);
  const entry = pack?.index.find(e => e.name === "Infomorph");
  const doc = entry ? await pack.getDocument(entry._id) : null;
  const data = doc ? doc.toObject() : { name: "Infomorph", type: "morph", img: "icons/svg/daze.svg", system: { morphType: "infomorph" } };
  delete data._id;
  foundry.utils.setProperty(data, "system.active", true);
  return data;
}

/**
 * Item data of a fork: an infomorph mind with the ego's skills, ego traits, programs and (alpha only) sleights.
 * Beta and delta forks lose the Psi trait, and their skills are capped; a delta keeps its 5 best skills of each kind.
 */
export async function forkItems(actor, kind, aptitudes) {
  const limits = ego.FORKS[kind];
  const keep = i => ["skill", "software"].includes(i.type) ||
    ((i.type === "trait") && (i.system.scope !== "morph") && (limits.psi || i.system.key !== "psi")) ||
    ((i.type === "sleight") && limits.psi);
  const items = actor.items.filter(keep).map(i => i.toObject());
  // Skill totals on the fork: its aptitude (no morph bonus) + ranks + the skill's own modifier
  const skills = items.filter(i => i.type === "skill");
  const total = s => (aptitudes[s.system.aptitude] ?? 0) + s.system.ranks + s.system.mod;
  for ( const s of skills ) {
    const max = (s.system.category === "knowledge") ? limits.knowledgeMax : limits.activeMax;
    s.system.ranks = ego.forkRanks(s.system.ranks, total(s) - s.system.ranks, max);
  }
  const kept = new Set();
  for ( const category of ["active", "knowledge"] ) {
    const count = (category === "knowledge") ? limits.knowledgeCount : limits.activeCount;
    const list = skills.filter(s => s.system.category === category).map(s => ({ id: s._id, total: total(s) }));
    ego.forkKeptSkills(list, count).forEach(id => kept.add(id));
  }
  return items.filter(i => (i.type !== "skill") || kept.has(i._id)).concat(await infomorphData());
}

/** Prompt for a fork of the actor and create it as a new actor, with its tests. */
export async function promptFork(actor) {
  const data = await prompt(L("forkTitle", { name: actor.name }), "fork", {
    kinds: ["alpha", "beta", "delta"].map(k => ({ key: k, label: `EP1E.Ego.forkKind.${k}` }))
  }, "fa-solid fa-code-fork");
  if ( !data ) return null;
  return createFork(actor, data.kind, { longTerm: !!data.longTerm, fromBackup: !!data.fromBackup });
}

export async function createFork(actor, kind, { longTerm = false, fromBackup = false } = {}) {
  const limits = ego.FORKS[kind];
  const source = actor.toObject();
  const sys = source.system;
  const aptitudes = {};
  for ( const [key, apt] of Object.entries(sys.aptitudes) ) {
    apt.base = ego.forkAptitude(apt.base, kind);
    aptitudes[key] = apt.base + apt.mod;
  }
  sys.mods.luc += limits.luc;
  sys.mods.init += limits.init;
  if ( limits.moxie !== null ) sys.moxie = { value: limits.moxie, max: limits.moxie };
  sys.damage.value = 0;
  sys.wounds.value = 0;
  sys.intrusions = [];
  sys.fork = { kind, origin: actor.uuid, created: game.time.worldTime };
  const data = {
    name: L("forkName", { name: actor.name, kind: L(`forkKind.${kind}`) }), type: source.type, img: source.img,
    system: sys, folder: source.folder, ownership: source.ownership,
    items: await forkItems(actor, kind, aptitudes),
    prototypeToken: { ...source.prototypeToken, name: L("forkName", { name: actor.name, kind: L(`forkKind.${kind}`) }) }
  };
  const fork = await Actor.implementation.create(data);
  if ( !fork ) return null;
  ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="ep1e chat-card"><p>${L("forkCreated", { name: actor.name, fork: fork.link ?? fork.name, kind: L(`forkKind.${kind}`) })}</p>
      ${(kind === "delta") ? `<p class="hint">${L("deltaSkills")}</p>` : ""}</div>`,
    whisper: gmWhisper(actor)
  });
  if ( kind === "alpha" ) {
    // A new alpha fork makes an Alienation Test, and a Continuity Test if copied from a backup (p. 273)
    await rollSkillTest(fork, {
      label: L("alienation"), target: fork.system.aptitudes.int.value * 3, fastForward: true,
      input: { modifier: ego.sleevingModifier(["fork", "infomorph"], "alienation") }, ego: { kind: "alienation", morph: "Infomorph" }
    });
    if ( fromBackup ) {
      await rollSkillTest(fork, {
        label: L("continuity"), target: fork.system.aptitudes.wil.value * 3, fastForward: true,
        input: { modifier: traits.phoenixBonus(traitLevel(fork, "phoenix")) },
        ego: { kind: "continuity", situation: "fork", notKnowing: false }
      });
    }
  }
  else {
    // Neural pruning: a Psychosurgery Test of the original ego (p. 274)
    const { target } = actor.system.getSkillTarget("psychosurgery");
    await rollSkillTest(actor, {
      label: L("pruning", { kind: L(`forkKind.${kind}`) }), target,
      input: { modifier: longTerm ? ego.LONG_TERM_PRUNING : 0 },
      ego: { kind: "pruning", fork: fork.uuid, forkName: fork.name }
    });
  }
  return fork;
}

/** Merge a fork back with its original ego: a Psychosurgery Test modified by the time apart (p. 275). */
export async function mergeFork(fork) {
  const { origin, created } = fork.system.fork;
  const original = origin ? await fromUuid(origin) : null;
  if ( !original ) return ui.notifications.warn(L("noOriginal"));
  const apart = Math.max(0, game.time.worldTime - (created ?? game.time.worldTime));
  const row = ego.MERGING.indexOf(ego.mergingRow(apart));
  const { target } = original.system.getSkillTarget("psychosurgery");
  // Ego Plasticity (Transhuman p. 83): +10 per level, and 1 SV less per level
  const plasticity = traits.egoPlasticity(traitLevel(original, "egoPlasticity"));
  return rollSkillTest(original, {
    label: L("merge", { fork: fork.name }), target,
    input: { modifier: ego.MERGING[row].modifier + plasticity.modifier },
    ego: { kind: "merge", row, fork: fork.uuid, forkName: fork.name, hours: Math.floor(apart / 3600), svMod: plasticity.sv }
  });
}

/* -------------------------------------------- */
/*  Favors (pp. 286-289)                        */
/* -------------------------------------------- */

/** The actor's best Networking skill item for a reputation network ("Networking: Autonomists"). */
function networkingSkill(actor, network) {
  // "Autonomist" and "Autonomists" are the same field
  const norm = text => text.trim().toLowerCase().replace(/s$/, "");
  return actor.items.filter(i => (i.type === "skill") && (i.system.key === "networking") &&
    (norm(i.system.field) === norm(REP_NETWORKING[network])))
    .sort((a, b) => b.system.total - a.system.total)[0] ?? null;
}

/** Status of each favor level of each network, for the sheet: [{ key, rep, level, favors: [{ level, ready, until }] }]. */
export function favorStatus(actor) {
  const now = game.time.worldTime;
  return REP_NETWORKS.map(key => {
    const rep = actor.system.rep[key];
    return {
      key, rep, level: ego.repLevel(rep),
      favors: [1, 2, 3, 4, 5].map(level => {
        const last = actor.system.favors[key][`l${level}`];
        const ready = ego.favorRefreshed(level, last, now);
        return { level, ready, wait: ready ? 0 : Math.ceil((last + ego.FAVORS[level].refresh - now) / 3600) };
      })
    };
  });
}

/** Prompt for a favor and roll the Networking Test (Rep burned for a bonus is spent at once). */
export async function promptFavor(actor, network = null) {
  const best = network ?? REP_NETWORKS.reduce((a, b) => (actor.system.rep[b] > actor.system.rep[a] ? b : a));
  const data = await prompt(L("favorTitle", { name: actor.name }), "favor", {
    networks: REP_NETWORKS.map(k => ({ key: k, label: `EP1E.Rep.${k}`, rep: actor.system.rep[k], selected: k === best })),
    levels: [1, 2, 3, 4, 5].map(l => ({ level: l, label: `EP1E.Ego.favorLevel.${l}`, timeframe: ego.FAVORS[l].timeframe })),
    maxBurn: ego.MAX_BURN_BONUS
  }, "fa-solid fa-handshake");
  if ( !data ) return null;
  const net = data.network;
  const level = Number(data.level) || 1;
  const rep = actor.system.rep[net];
  const burn = Math.min(ego.MAX_BURN_BONUS, rep, Math.max(0, Number(data.burn) || 0));
  const quiet = -Math.abs(Number(data.quiet) || 0);
  const extra = Math.max(0, Number(data.extra) || 0);
  if ( burn ) await actor.update({ [`system.rep.${net}`]: rep - burn });
  const skill = networkingSkill(actor, net);
  const target = skill ? skill.system.total : actor.system.getSkillTarget("networking").target;
  const label = skill ? skill.system.label : `${game.i18n.localize("EP1E.Skill.networking")}: ${REP_NETWORKING[net]}`;
  return rollSkillTest(actor, {
    label: L("favorLabel", { skill: label, level }), target, fastForward: true,
    input: { modifier: ego.favorModifier({ rep, level, burn, quiet, extra }), messageMode: data.messageMode },
    ego: { kind: "favor", network: net, level, burn, quiet }
  });
}

/* -------------------------------------------- */
/*  Chat cards                                  */
/* -------------------------------------------- */

/** What the "apply" button of an ego test will do, for its card: { text, button, buttons? }. */
export function egoSummary(test, result) {
  const e = test.ego;
  if ( e.applied ) return { text: e.applied, button: null };
  // Healing and mental health tests (dice/mental.mjs)
  if ( MENTAL_KINDS.includes(e.kind) ) return mentalSummary(test, result);
  switch ( e.kind ) {
    case "integration": {
      const fx = ego.integrationEffect(result);
      if ( fx.moxie ) return { text: L("integrationMoxie"), button: L("apply") };
      if ( !fx.modifier ) return { text: L("integrationNone"), button: null };
      const duration = (fx.days === null) ? L("untilResleeved") : L("days", { days: fx.days });
      return { text: L(fx.physical ? "integrationPhysical" : "integrationAll", { modifier: fx.modifier, duration }), button: L("apply") };
    }
    case "alienation": {
      const { stress, heal } = ego.alienationStress(result);
      if ( heal ) return { text: L("alienationHeal", { formula: heal }), button: L("apply") };
      return stress ? { text: L("stress", { sv: stress }), button: L("apply") } : { text: L("alienationNone"), button: null };
    }
    case "continuity": {
      const shift = Math.floor(result.margin / 10) * (result.success ? -1 : 1);
      const formula = ego.CONTINUITY_SITUATIONS[e.situation];
      return { text: L("continuityText", { formula, shift: (shift >= 0) ? `+${shift}` : shift,
        extra: e.notKnowing ? ` +${ego.NOT_KNOWING_STRESS}` : "" }), button: L("rollStress") };
    }
    case "backup": {
      const sv = ego.backupStress(result);
      return { text: sv ? L("backupStress", { sv }) : L("backupFine"), button: null };
    }
    case "pruning": {
      const n = ego.pruningPenalties(result);
      return { text: result.success ? L("pruningFine", { fork: e.forkName }) : L("pruningPenalties", { n, fork: e.forkName }), button: null };
    }
    case "merge": {
      const row = ego.MERGING[e.row];
      const out = result.success ? row.success : row.failure;
      return { text: L("mergeText", { hours: e.hours, memory: L(`memory.${out.memory}`), sv: out.sv }), button: L("rollStress") };
    }
    case "favor": {
      const f = ego.FAVORS[e.level];
      if ( !result.success ) return { text: L("favorFailed"), button: null };
      return {
        text: L("favorFound", { value: test.value, timeframe: f.timeframe }),
        button: L("useFavor", { level: e.level }),
        burn: f.burn ? L("burnFavor", { burn: f.burn }) : null
      };
    }
  }
  return { text: "", button: null };
}

/** Mark an ego test as applied, with a note shown instead of its button. */
async function markApplied(message, test, note) {
  test.ego.applied = note;
  await message.update({ content: await renderTestCard(test), [`flags.${SYSTEM_ID}.test`]: test });
}

/** Stress from an ego test, applied as a stress payload (reported in chat). */
const applyStress = (actor, sv) => applyToActor(actor, { stress: true, total: sv, label: "" }, { total: sv });

/** Apply the result of an ego test card ("apply" button), or burn Rep for a favor (mode "burn"). */
export async function applyEgoResult(message, mode = "apply") {
  const test = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "test"));
  const e = test?.ego;
  if ( !e || e.applied ) return;
  const actor = await fromUuid(test.actorUuid);
  if ( !actor?.isOwner ) return;
  if ( MENTAL_KINDS.includes(e.kind) ) return applyMentalResult(message, test, actor);
  const result = evaluateTest(test);
  switch ( e.kind ) {
    case "integration": {
      const fx = ego.integrationEffect(result);
      if ( fx.moxie ) {
        await actor.update({ "system.moxie.value": actor.system.moxie.value + fx.moxie });
        return markApplied(message, test, L("integrationMoxieDone"));
      }
      if ( !fx.modifier ) return;
      await actor.createEmbeddedDocuments("ActiveEffect", [integrationEffectData(fx, e.morph)]);
      return markApplied(message, test, L("effectAdded"));
    }
    case "alienation": {
      const { stress, heal } = ego.alienationStress(result);
      if ( heal ) {
        const roll = await new Roll(heal).evaluate();
        await actor.update({ "system.stress.value": Math.max(0, actor.system.stress.value - roll.total) });
        return markApplied(message, test, L("healed", { sv: roll.total }));
      }
      if ( !stress ) return;
      await applyStress(actor, stress);
      return markApplied(message, test, L("stressApplied", { sv: stress }));
    }
    case "continuity": {
      const roll = await new Roll(ego.CONTINUITY_SITUATIONS[e.situation]).evaluate();
      const sv = ego.continuityStress(roll.total, result, { notKnowing: e.notKnowing });
      if ( sv ) await applyStress(actor, sv);
      return markApplied(message, test, L("continuityDone", { rolled: roll.total, sv }));
    }
    case "merge": {
      const row = ego.MERGING[e.row];
      const out = result.success ? row.success : row.failure;
      const roll = await new Roll(out.sv).evaluate();
      const sv = Math.max(0, roll.total + (e.svMod ?? 0));
      if ( sv ) await applyStress(actor, sv);
      return markApplied(message, test, L("mergeDone", { sv, memory: L(`memory.${out.memory}`), fork: e.forkName }));
    }
    case "favor": {
      if ( !result.success ) return;
      const path = `system.favors.${e.network}.l${e.level}`;
      if ( mode === "burn" ) {
        const cost = ego.FAVORS[e.level].burn;
        const rep = actor.system.rep[e.network];
        if ( rep < cost ) return ui.notifications.warn(L("notEnoughRep"));
        await actor.update({ [`system.rep.${e.network}`]: rep - cost });
        return markApplied(message, test, L("favorBurned", { burn: cost }));
      }
      const last = foundry.utils.getProperty(actor, path);
      if ( !ego.favorRefreshed(e.level, last, game.time.worldTime) ) {
        return ui.notifications.warn(L("favorNotRefreshed", { level: e.level, burn: ego.FAVORS[e.level].burn }));
      }
      await actor.update({ [path]: game.time.worldTime });
      return markApplied(message, test, L("favorUsed", { level: e.level }));
    }
  }
}

/* -------------------------------------------- */
/*  World time                                  */
/* -------------------------------------------- */

/**
 * End what lasts for some world time once it is over (integration penalties, temporary psychosurgery, derangements):
 * effects and items flagged with ep1e.expiresAt. Run by the active GM.
 */
export async function expireEffects(worldTime) {
  if ( !game.users.activeGM?.isSelf ) return;
  const expired = doc => {
    const at = doc.getFlag(SYSTEM_ID, "expiresAt");
    return (typeof at === "number") && (at <= worldTime);
  };
  for ( const actor of game.actors ) {
    const effects = actor.effects.filter(expired).map(e => e.id);
    if ( effects.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", effects);
    const items = actor.items.filter(expired).map(i => i.id);
    if ( items.length ) await actor.deleteEmbeddedDocuments("Item", items);
  }
}
