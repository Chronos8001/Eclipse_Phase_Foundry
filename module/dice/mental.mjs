import { SYSTEM_ID } from "../config.mjs";
import * as mental from "../rules/mental.mjs";
import { applyToActor, evaluateTest, gmWhisper, renderTestCard, rollSkillTest } from "./tests.mjs";

/**
 * Healing and mental health (Core pp. 208-215, 229-233): natural and medical healing, Willpower Stress Tests and
 * hardening, derangements and disorders after traumas, natural mental healing, psychotherapy and psychosurgery.
 * Tests carry test.ego = { kind, ... } like the ego tests (dice/ego.mjs), which hands these kinds over to this module.
 */

export const MENTAL_KINDS = ["stress", "mentalHealing", "disorderHealing", "therapy", "surgery", "medicalCare"];

const T = name => `systems/${SYSTEM_ID}/templates/dialog/${name}.hbs`;
const L = (key, data) => (data ? game.i18n.format(`EP1E.Mental.${key}`, data) : game.i18n.localize(`EP1E.Mental.${key}`));
const DAY = 86400;

async function prompt(title, template, data, icon) {
  const content = await foundry.applications.handlebars.renderTemplate(T(template), data);
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
/*  Helpers: who treats the character           */
/* -------------------------------------------- */

const norm = text => String(text ?? "").trim().toLowerCase();

/** Skills a helper may treat with: [{ key, field }] (field "" = any field). */
const HELPER_SKILLS = {
  therapy: [{ key: "medicine", field: "psychiatry" }, { key: "academics", field: "psychology" }, { key: "profession", field: "psychotherapy" }],
  surgery: [{ key: "psychosurgery", field: "" }],
  medical: [{ key: "medicine", field: "" }]
};

/** A helper's best rating for a kind of care: { target, label }. */
export function helperRating(actor, kind) {
  const skills = actor.items.filter(i => (i.type === "skill") &&
    HELPER_SKILLS[kind].some(s => (i.system.key === s.key) && (!s.field || norm(i.system.field) === s.field)));
  const best = skills.sort((a, b) => b.system.total - a.system.total)[0];
  if ( best ) return { target: best.system.total, label: best.system.label };
  const { target, label } = actor.system.getSkillTarget(HELPER_SKILLS[kind][0].key);
  return { target, label };
}

/** Characters and NPCs the user can see, to choose a helper from. */
function helperChoices(patient, kind) {
  return game.actors.filter(a => ["character", "npc"].includes(a.type) && a.testUserPermission(game.user, "OBSERVER"))
    .map(a => ({ id: a.id, name: a.name, rating: helperRating(a, kind).target, selected: a.id === patient.id }))
    .sort((a, b) => b.rating - a.rating);
}

/** The helper chosen in a dialog: the rating typed in, else the chosen actor's. */
function chosenHelper(data, kind) {
  const actor = game.actors.get(data.helper);
  const typed = Number(data.rating);
  if ( typed > 0 ) return { name: actor?.name ?? L("helperUnnamed"), target: typed, label: L("helperRating") };
  if ( !actor ) return null;
  return { name: actor.name, ...helperRating(actor, kind) };
}

/* -------------------------------------------- */
/*  Physical healing (p. 208)                   */
/* -------------------------------------------- */

/** The best healing care a biomorph has: medichines, then basic biomods (Healing table, p. 208). */
function healingCare(actor) {
  // An augmentation item, or the implants listed by the active morph
  const implants = actor.system.activeMorph?.system.implants ?? "";
  const has = (key, pattern) => actor.items.some(i => (i.type === "augmentation") && (i.system.key === key)) || pattern.test(implants);
  if ( has("medichines", /medichines/i) ) return "medichines";
  if ( has("basicBiomods", /basic biomods/i) ) return "biomods";
  return "none";
}

/** Natural healing over some time: damage first, then wounds (p. 208). Synthmorphs must be repaired. */
export async function promptHealing(actor) {
  if ( actor.system.stats.isSynth || actor.system.stats.isInfomorph ) return ui.notifications.warn(L("noHealing"));
  const care = healingCare(actor);
  const data = await prompt(L("healingTitle", { name: actor.name }), "healing", {
    cares: Object.keys(mental.HEALING).map(k => ({ key: k, label: `EP1E.Mental.care.${k}`, selected: k === care })),
    conditions: Object.keys(mental.CONDITIONS).map(k => ({ key: k, label: `EP1E.Mental.condition.${k}` }))
  }, "fa-solid fa-bed-pulse");
  if ( !data ) return null;
  const hours = Math.max(0, Number(data.hours) || 0);
  const sys = actor.system;
  const { hoursPerRoll } = mental.healingRates(data.care, data.condition);
  const count = Math.min(100, Math.floor(hours / hoursPerRoll));
  const roll = count ? await new Roll(`${count}d10`).evaluate() : null;
  const rolls = roll ? roll.dice[0].results.map(r => r.result) : [];
  const healed = mental.naturalHealing({ damage: sys.damage.value, wounds: sys.wounds.value, hours, care: data.care,
    condition: data.condition, rolls });
  await actor.update({ "system.damage.value": sys.damage.value - healed.damage, "system.wounds.value": sys.wounds.value - healed.wounds });
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }), rolls: roll ? [roll] : [],
    content: `<div class="ep1e chat-card"><p>${L("healed", { name: actor.name, hours, damage: healed.damage, wounds: healed.wounds })}</p></div>`,
    whisper: gmWhisper(actor)
  });
}

/** Medical care (p. 208): a Medicine Test within 24 hours of an injury heals 1d10 damage and 1 wound. */
export async function promptMedicalCare(actor) {
  const data = await prompt(L("medicalTitle", { name: actor.name }), "helper", {
    helpers: helperChoices(actor, "medical"), hint: L("medicalHint")
  }, "fa-solid fa-kit-medical");
  if ( !data ) return null;
  const helper = chosenHelper(data, "medical");
  if ( !helper ) return null;
  return rollSkillTest(actor, {
    label: L("medicalLabel", { name: helper.name, skill: helper.label }), target: helper.target, ownPenalty: false,
    fastForward: true, input: { modifier: Number(data.modifier) || 0 }, ego: { kind: "medicalCare" }
  });
}

/* -------------------------------------------- */
/*  Willpower Stress Tests and hardening        */
/* -------------------------------------------- */

const halfOnSuccess = () => !!game.settings.get(SYSTEM_ID, "halfStressOnSuccess");

/** A Willpower Stress Test (p. 214) against a situation of the Stressful Experiences table, or another source. */
export async function promptStressTest(actor) {
  const data = await prompt(L("stressTitle", { name: actor.name }), "stress-test", {
    situations: Object.entries(mental.STRESSFUL_EXPERIENCES).map(([k, sv]) => ({ key: k, sv, label: `EP1E.Mental.situation.${k}` })),
    hardened: actor.system.hardening.filter(h => h.successes >= mental.HARDENING_SUCCESSES).map(h => h.source)
  }, "fa-solid fa-brain");
  if ( !data ) return null;
  const sv = String(data.sv ?? "").trim() || mental.STRESSFUL_EXPERIENCES[data.situation] || "0";
  const source = String(data.source ?? "").trim() || game.i18n.localize(`EP1E.Mental.situation.${data.situation}`);
  const entry = actor.system.hardening.find(h => norm(h.source) === norm(source));
  if ( entry && (entry.successes >= mental.HARDENING_SUCCESSES) ) {
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="ep1e chat-card"><p>${L("hardenedTo", { name: actor.name, source })}</p></div>`
    });
  }
  return rollSkillTest(actor, {
    label: L("stressLabel", { source }), target: actor.system.aptitudes.wil.value * 3, fastForward: true,
    input: { modifier: Number(data.modifier) || 0 }, ego: { kind: "stress", sv, source }
  });
}

/** Count a successful test against a source; the 5th makes the ego hardened to it, at -1 Moxie (p. 214). */
async function countHardening(actor, source) {
  const list = foundry.utils.deepClone(actor.system.hardening);
  let entry = list.find(h => norm(h.source) === norm(source));
  if ( !entry ) list.push(entry = { source, successes: 0 });
  entry.successes += 1;
  const update = { "system.hardening": list };
  const hardened = entry.successes === mental.HARDENING_SUCCESSES;
  if ( hardened ) {
    const max = Math.max(0, actor.system.moxie.max - 1);
    update["system.moxie.max"] = max;
    update["system.moxie.value"] = Math.min(actor.system.moxie.value, max);
  }
  await actor.update(update);
  return hardened ? L("hardened", { source }) : L("hardeningCount", { source, n: entry.successes, max: mental.HARDENING_SUCCESSES });
}

/* -------------------------------------------- */
/*  Derangements and disorders (pp. 209-214)    */
/* -------------------------------------------- */

/** Derangement or disorder traits of the system's compendium: [{ id, name, level }]. */
async function mentalTraits() {
  const pack = game.packs.get(`${SYSTEM_ID}.mental-health`);
  if ( !pack ) return [];
  const index = await pack.getIndex({ fields: ["system.key", "system.level"] });
  return index.map(e => ({ id: e._id, name: e.name, key: e.system?.key, level: e.system?.level ?? 1 }));
}

/**
 * After a trauma: choose the derangement it brings (or the disorder of a 4th trauma), from the compendium. A
 * derangement lasts 1d10 ÷ 2 hours of world time; it may replace a weaker one (an upgrade).
 */
export async function promptDerangement(actor) {
  const kind = mental.derangementFor(actor.system.trauma.value);
  const level = { minor: 1, moderate: 2, major: 3 }[kind];
  const all = await mentalTraits();
  const options = all.filter(t => (kind === "disorder") ? (t.key === "mentalDisorder") : ((t.key === "derangement") && (t.level === level)));
  const current = actor.items.filter(i => (i.type === "trait") && (i.system.key === "derangement"));
  const data = await prompt(L("derangementTitle", { name: actor.name }), "derangement", {
    kind: L(`severity.${kind}`), options, current: current.map(i => ({ id: i.id, name: i.name }))
  }, "fa-solid fa-head-side-virus");
  if ( !data?.trait ) return null;
  const pack = game.packs.get(`${SYSTEM_ID}.mental-health`);
  const item = (await pack.getDocument(data.trait)).toObject();
  delete item._id;
  item.system.cost = 0;
  let duration = "";
  if ( kind !== "disorder" ) {
    const roll = await new Roll(mental.DERANGEMENT_HOURS).evaluate();
    // 0 hours: the derangement fades within the hour (half an hour is kept)
    const seconds = Math.max(1800, roll.total * 3600);
    foundry.utils.setProperty(item, `flags.${SYSTEM_ID}.expiresAt`, game.time.worldTime + seconds);
    duration = L("derangementHours", { hours: roll.total });
  }
  if ( data.replace ) await actor.deleteEmbeddedDocuments("Item", [data.replace]);
  await actor.createEmbeddedDocuments("Item", [item]);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="ep1e chat-card"><p>${L("derangementAdded", { name: actor.name, trait: item.name })} ${duration}</p></div>`,
    whisper: gmWhisper(actor)
  });
}

/* -------------------------------------------- */
/*  Mental healing (p. 215)                     */
/* -------------------------------------------- */

/** A month without new stress: WIL x 3 Test to heal 1d10 stress, or 1 trauma once the stress is gone. */
export function rollMentalHealing(actor) {
  return rollSkillTest(actor, {
    label: L("mentalHealingLabel"), target: actor.system.aptitudes.wil.value * 3, ego: { kind: "mentalHealing" }
  });
}

/** Three months without stress or trauma: a WIL Test to be rid of a disorder (the multiplier can be changed). */
export function rollDisorderHealing(actor) {
  return rollSkillTest(actor, {
    label: L("disorderHealingLabel"), target: actor.system.aptitudes.wil.value, aptitude: "wil", multiplier: 1,
    ego: { kind: "disorderHealing" }
  });
}

const disorderCount = actor => actor.items.filter(i => (i.type === "trait") && (i.system.key === "mentalDisorder")).length;

/** A psychotherapy session: the therapist's test, +30 after psychosurgery, -10 per disorder (p. 215). */
export async function promptTherapy(actor) {
  const surgery = actor.effects.some(e => e.getFlag(SYSTEM_ID, "therapyBonus"));
  const data = await prompt(L("therapyTitle", { name: actor.name }), "therapy", {
    helpers: helperChoices(actor, "therapy"), psychosurgery: surgery, disorders: disorderCount(actor),
    penalty: -10 * disorderCount(actor)
  }, "fa-solid fa-couch");
  if ( !data ) return null;
  const helper = chosenHelper(data, "therapy");
  if ( !helper ) return null;
  const hours = Math.max(1, Number(data.hours) || 1);
  return rollSkillTest(actor, {
    label: L("therapyLabel", { name: helper.name, skill: helper.label, hours }), target: helper.target, ownPenalty: false,
    fastForward: true, input: { modifier: mental.therapyModifier({ psychosurgery: !!data.psychosurgery, disorders: disorderCount(actor) }) },
    ego: { kind: "therapy", hours }
  });
}

/* -------------------------------------------- */
/*  Psychosurgery (pp. 229-233)                 */
/* -------------------------------------------- */

/**
 * Psychosurgery on the actor: the surgeon's Psychosurgery against the subject's WIL x 3 (rolled at once unless the
 * subject does not resist). The card applies the stress and the result.
 */
export async function promptSurgery(actor) {
  const data = await prompt(L("surgeryTitle", { name: actor.name }), "surgery", {
    helpers: helperChoices(actor, "surgery"),
    procedures: Object.entries(mental.PROCEDURES).map(([k, p]) => ({
      key: k, label: `EP1E.Mental.procedure.${k}`, timeframe: p.timeframe, sv: p.sv || "0",
      degrees: Object.entries(p.degrees).map(([d, v]) => ({ key: `${k}.${d}`, label: `EP1E.Mental.degree.${d}`, value: v }))
    })),
    conditions: Object.entries(mental.SURGERY_MODIFIERS).map(([k, m]) => ({ key: k, label: `EP1E.Mental.surgeryCondition.${k}`, test: m.test }))
  }, "fa-solid fa-brain");
  if ( !data ) return null;
  const helper = chosenHelper(data, "surgery");
  if ( !helper ) return null;
  const [procedure, degree] = String(data.degree).split(".");
  const conditions = Object.keys(mental.SURGERY_MODIFIERS).filter(k => data[`cond.${k}`]);
  let subject = null;
  if ( data.resists ) {
    const roll = await new Roll("1d100").evaluate();
    const target = Math.max(0, (actor.system.aptitudes.wil.value * 3) - (actor.system.penalty?.total ?? 0));
    subject = { value: roll.total % 100, target };
  }
  return rollSkillTest(actor, {
    label: L("surgeryLabel", { name: helper.name, procedure: game.i18n.localize(`EP1E.Mental.procedure.${procedure}`) }),
    target: helper.target, ownPenalty: false, fastForward: true,
    input: { modifier: mental.surgeryModifier(procedure, degree, conditions) },
    ego: { kind: "surgery", procedure, degree, conditions, subject }
  });
}

/* -------------------------------------------- */
/*  Chat cards                                  */
/* -------------------------------------------- */

/** What the "apply" button of a mental test does, for its card. */
export function mentalSummary(test, result) {
  const e = test.ego;
  switch ( e.kind ) {
    case "stress": {
      if ( result.success ) {
        const half = halfOnSuccess() ? L("halfStress", { sv: e.sv }) : "";
        return { text: `${L("stressResisted")} ${half}`, button: L("countHardening") };
      }
      return { text: L("stressFailed", { sv: e.sv }), button: L("rollStress") };
    }
    case "mentalHealing":
      return result.success ? { text: L("mentalHealingText"), button: L("heal") } : { text: L("noHeal"), button: null };
    case "disorderHealing":
      return { text: result.success ? L("disorderHealed") : L("noHeal"), button: null };
    case "therapy": {
      if ( !result.success ) return { text: L("noHeal"), button: null };
      return { text: L("therapyText", { hours: e.hours }), button: L("heal") };
    }
    case "medicalCare":
      return result.success ? { text: L("medicalText"), button: L("heal") } : { text: L("noHeal"), button: null };
    case "surgery": {
      const subject = e.subject ? evaluateTest(e.subject) : null;
      const out = mental.surgeryOutcome({ ...result, value: test.value }, subject ? { ...subject, value: e.subject.value } : null);
      const resisted = e.subject ? L("subjectRoll", { value: String(e.subject.value).padStart(2, "0"), target: e.subject.target,
        result: subject.success ? L("succeeds") : L("fails") }) : L("noResistance");
      const sv = mental.PROCEDURES[e.procedure].sv || "0";
      return { text: `${resisted} ${L(`outcome.${out.effect}`, { weeks: out.weeks })} ${L("surgeryStress", { sv })}`, button: L("apply") };
    }
  }
  return { text: "", button: null };
}

async function markApplied(message, test, note) {
  test.ego.applied = note;
  await message.update({ content: await renderTestCard(test), [`flags.${SYSTEM_ID}.test`]: test });
}

const applyStress = (actor, sv) => applyToActor(actor, { stress: true, total: sv, label: "" }, { total: sv });

/** Apply the result of a mental test card. */
export async function applyMentalResult(message, test, actor) {
  const e = test.ego;
  const result = evaluateTest(test);
  const sys = actor.system;
  switch ( e.kind ) {
    case "stress": {
      if ( result.success ) {
        let note = await countHardening(actor, e.source);
        if ( halfOnSuccess() ) {
          const roll = await new Roll(e.sv).evaluate();
          const sv = mental.stressTaken(roll.total, true, { halfOnSuccess: true });
          if ( sv ) await applyStress(actor, sv);
          note += ` ${L("stressApplied", { sv })}`;
        }
        return markApplied(message, test, note);
      }
      const roll = await new Roll(e.sv).evaluate();
      if ( roll.total ) await applyStress(actor, roll.total);
      return markApplied(message, test, L("stressApplied", { sv: roll.total }));
    }
    case "mentalHealing": {
      const roll = await new Roll("1d10").evaluate();
      const healed = mental.naturalMentalHealing(result, { stress: sys.stress.value, traumas: sys.trauma.value, rolled: roll.total });
      await actor.update({ "system.stress.value": sys.stress.value - healed.stress, "system.trauma.value": sys.trauma.value - healed.traumas });
      return markApplied(message, test, L("mentalHealed", healed));
    }
    case "therapy": {
      const healed = mental.therapyHealing(e.hours, { stress: sys.stress.value, traumas: sys.trauma.value, disorders: disorderCount(actor) });
      await actor.update({ "system.stress.value": sys.stress.value - healed.stress, "system.trauma.value": sys.trauma.value - healed.traumas });
      return markApplied(message, test, L("therapyHealed", healed));
    }
    case "medicalCare": {
      const roll = await new Roll("1d10").evaluate();
      const damage = Math.min(sys.damage.value, roll.total);
      await actor.update({ "system.damage.value": sys.damage.value - damage, "system.wounds.value": Math.max(0, sys.wounds.value - 1) });
      return markApplied(message, test, L("medicalHealed", { damage }));
    }
    case "surgery": {
      const subject = e.subject ? { ...evaluateTest(e.subject), value: e.subject.value } : null;
      const out = mental.surgeryOutcome({ ...result, value: test.value }, subject);
      const formula = mental.PROCEDURES[e.procedure].sv;
      const rolled = formula ? (await new Roll(formula).evaluate()).total : 0;
      const stress = mental.surgeryStress(rolled, result, e.conditions);
      if ( stress.sv ) await applyStress(actor, stress.sv);
      if ( stress.trauma ) await actor.update({ "system.trauma.value": actor.system.trauma.value + 1 });
      if ( out.effect !== "none" ) await actor.createEmbeddedDocuments("ActiveEffect", [surgeryEffect(e, out)]);
      return markApplied(message, test, L("surgeryDone", { outcome: L(`outcome.${out.effect}`, { weeks: out.weeks }), sv: stress.sv })
        + (stress.trauma ? ` ${L("surgeryTrauma")}` : ""));
    }
  }
}

/** A marker effect of the psychosurgery done, lasting its weeks of world time when temporary. */
function surgeryEffect(e, out) {
  const name = L("surgeryEffect", { procedure: game.i18n.localize(`EP1E.Mental.procedure.${e.procedure}`),
    degree: game.i18n.localize(`EP1E.Mental.degree.${e.degree}`) });
  const flags = { [SYSTEM_ID]: { psychosurgery: e.procedure } };
  // Therapeutic psychosurgery gives +30 to the next psychotherapy sessions (p. 233)
  if ( e.procedure === "psychotherapy" ) flags[SYSTEM_ID].therapyBonus = true;
  const data = { name, img: "icons/svg/aura.svg", changes: [], disabled: false, transfer: false, flags };
  if ( out.effect === "temporary" ) {
    data.duration = { seconds: out.weeks * 7 * DAY, startTime: game.time.worldTime };
    flags[SYSTEM_ID].expiresAt = game.time.worldTime + (out.weeks * 7 * DAY);
  }
  return data;
}
