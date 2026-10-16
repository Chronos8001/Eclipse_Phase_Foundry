import { SKILLS, SYSTEM_ID } from "../config.mjs";
import * as mesh from "../rules/mesh.mjs";
import { opposedWinner } from "../rules/combat.mjs";
import { setCondition } from "../helpers/effects.mjs";
import { applyToActor, evaluateTest, gmWhisper, rollSkillTest, testDialogContext } from "./tests.mjs";

/**
 * Hacking (Core pp. 254-262): breaking into systems, the intruder's status and alerts,
 * subverting a hacked system, scorching egos in hacked cyberbrains, and AI actors.
 */

const TEMPLATES = {
  hack: `systems/${SYSTEM_ID}/templates/dialog/hack.hbs`,
  subvert: `systems/${SYSTEM_ID}/templates/dialog/subvert.hbs`,
  result: `systems/${SYSTEM_ID}/templates/chat/intrusion.hbs`
};
const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);
const DialogV2 = () => foundry.applications.api.DialogV2;
const formData = (event, button) => foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(button.form).object);

/** Subversion actions (pp. 258-261): opposed by the monitor when the system is actively monitored. */
export const SUBVERSIONS = {
  useSystem: { opposed: false },
  backdoor: { opposed: true },
  crashSoftware: { opposed: false },
  crashAI: { opposed: true },
  eliminateTraces: { opposed: true },
  loadScript: { opposed: true },
  upgradeStatus: { opposed: false },
  reAuthenticate: { opposed: false },
  other: { opposed: false }
};

/** Best quality among the actor's programs with one of these keys (exploit, spoof...). */
function programQuality(actor, ...keys) {
  const programs = actor.items.filter(i => (i.type === "software") && keys.includes(i.system.key));
  return programs.length ? Math.max(...programs.map(i => i.system.quality)) : null;
}

/** Roll a monitor's Infosec Test against its rating. */
async function rollMonitor(rating, modifier = 0) {
  const roll = await new Roll("1d100").evaluate();
  const value = roll.total % 100;
  const target = Math.max(0, rating + modifier);
  return { roll, value, target, ...evaluateTest({ value, target }) };
}

/** Post the result of an intrusion or subversion. */
async function postResult(actor, data, rolls = []) {
  const content = await render(TEMPLATES.result, data);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }), content, rolls, whisper: gmWhisper(actor)
  });
}

/* -------------------------------------------- */
/*  Intrusion                                   */
/* -------------------------------------------- */

/**
 * Hack into a system (p. 255): defeat the firewall with an Infosec Test, then get past the monitor if any.
 * A successful intrusion is added to the actor's intrusions with its status.
 */
export async function hackSystem(actor) {
  const exploit = programQuality(actor, "exploit");
  const spoof = programQuality(actor, "spoof");
  const { target, label, skill } = actor.system.getSkillTarget("infosec");
  const content = await render(TEMPLATES.hack, {
    ...testDialogContext(actor, { label, target, specialization: skill?.system.specialization }),
    skillLabel: label,
    exploit, spoof,
    privileges: Object.keys(mesh.PRIVILEGES).filter(k => k !== "public")
      .map(k => ({ key: k, label: `EP1E.Mesh.privilege.${k}`, modifier: mesh.PRIVILEGES[k] })),
    qualities: mesh.QUALITY.map(q => ({ value: q, selected: q === 0 }))
  });
  const input = await DialogV2().wait({
    window: { title: game.i18n.localize("EP1E.Mesh.hack"), icon: "fa-solid fa-user-secret" },
    classes: ["ep1e", "ep1e-dialog"],
    content,
    buttons: [{ action: "hack", label: "EP1E.Mesh.hack", icon: "fa-solid fa-user-secret", default: true, callback: formData }],
    rejectClose: false
  });
  if ( !input ) return null;

  const method = input.method ?? "standard";
  if ( (method !== "spoof") && (exploit === null) ) ui.notifications.warn("EP1E.Mesh.noExploit", { localize: true });
  const bruteForce = method === "bruteForce";
  const modifier = mesh.intrusionModifier({
    privileges: input.privileges,
    exploit: Number(method === "spoof" ? spoof : exploit) || 0,
    firewall: Number(input.firewall) || 0,
    cyberbrain: !!input.cyberbrain,
    bruteForce
  });
  const message = await rollSkillTest(actor, {
    label: game.i18n.format("EP1E.Mesh.hackLabel", { target: input.target || "?" }),
    target,
    specialization: skill?.system.specialization,
    fastForward: true,
    input: { ...input, difficulty: Number(input.difficulty) || 0, modifier: (Number(input.modifier) || 0) + modifier }
  });
  const flag = message?.getFlag(SYSTEM_ID, "test");
  if ( !flag ) return null;
  const hacker = evaluateTest(flag);

  // Monitored systems: Variable Opposed Infosec Test against the watchdog
  const rating = Number(input.monitor) || 0;
  const monitor = rating ? await rollMonitor(rating) : null;
  const outcome = mesh.intrusionOutcome(hacker, monitor, { bruteForce });
  if ( outcome.status ) {
    const intrusions = foundry.utils.deepClone(actor.system._source.intrusions);
    intrusions.push({
      id: foundry.utils.randomID(), target: input.target || "?", privileges: input.privileges, status: outcome.status,
      firewall: Number(input.firewall) || 0, monitor: rating, cyberbrain: !!input.cyberbrain, notes: ""
    });
    await actor.update({ "system.intrusions": intrusions });
  }
  return postResult(actor, {
    title: game.i18n.format("EP1E.Mesh.hackLabel", { target: input.target || "?" }),
    monitor, status: outcome.status, retry: outcome.retry, bruteForce,
    timeframe: game.i18n.localize(bruteForce ? "EP1E.Mesh.timeBruteForce" : "EP1E.Mesh.timeStandard")
  }, monitor ? [monitor.roll] : []);
}

/** The intrusion of an actor with this id. */
function getIntrusion(actor, id) {
  return actor.system.intrusions.find(i => i.id === id) ?? null;
}

/** Change an intrusion's fields. */
export function updateIntrusion(actor, id, changes) {
  const intrusions = foundry.utils.deepClone(actor.system._source.intrusions);
  const entry = intrusions.find(i => i.id === id);
  if ( !entry ) return;
  Object.assign(entry, changes);
  return actor.update({ "system.intrusions": intrusions });
}

/** Leave a system. */
export function removeIntrusion(actor, id) {
  return actor.update({ "system.intrusions": actor.system._source.intrusions.filter(i => i.id !== id) });
}

/* -------------------------------------------- */
/*  Subversion                                  */
/* -------------------------------------------- */

/**
 * Subvert a hacked system (pp. 258-261) with an Infosec (or other) Test, modified by the intruder's status
 * (passive alert -10, active alert -20, Hidden +30) and cyberbrain security (-30). A Severe Failure downgrades
 * the status one step, a critical failure makes the intruder Locked; an Excellent Success while upgrading
 * improves it one step.
 */
export async function subvertSystem(actor, id) {
  const intrusion = getIntrusion(actor, id);
  if ( !intrusion ) return null;
  const sys = actor.system;
  const content = await render(TEMPLATES.subvert, {
    ...testDialogContext(actor, { label: intrusion.target, target: sys.getSkillTarget("infosec").target }),
    intrusion,
    actions: Object.keys(SUBVERSIONS).map(k => ({ key: k, label: `EP1E.Mesh.action.${k}` })),
    skills: ["infosec", "programming", "interfacing", "research"].map(k => ({ key: k, label: `EP1E.Skill.${k}` })),
    statusModifier: mesh.statusModifier(intrusion.status),
    cyberbrain: intrusion.cyberbrain ? mesh.CYBERBRAIN_MODIFIER : 0
  });
  const input = await DialogV2().wait({
    window: { title: game.i18n.format("EP1E.Mesh.subvertTitle", { target: intrusion.target }), icon: "fa-solid fa-terminal" },
    classes: ["ep1e", "ep1e-dialog"],
    content,
    buttons: [{ action: "roll", label: "EP1E.Test.roll", icon: "fa-solid fa-terminal", default: true, callback: formData }],
    rejectClose: false
  });
  if ( !input ) return null;

  const action = SUBVERSIONS[input.action] ? input.action : "useSystem";
  if ( (action === "upgradeStatus") && (intrusion.status === "locked") ) {
    return ui.notifications.warn("EP1E.Mesh.cannotUpgrade", { localize: true });
  }
  const { target, label, skill } = sys.getSkillTarget(input.skill || "infosec");
  const modifier = mesh.statusModifier(intrusion.status, { subvert: action !== "upgradeStatus" })
    + (intrusion.cyberbrain ? mesh.CYBERBRAIN_MODIFIER : 0);
  const message = await rollSkillTest(actor, {
    label: `${game.i18n.localize(`EP1E.Mesh.action.${action}`)} — ${intrusion.target} (${label})`,
    target,
    specialization: skill?.system.specialization,
    fastForward: true,
    input: { ...input, difficulty: Number(input.difficulty) || 0, modifier: (Number(input.modifier) || 0) + modifier }
  });
  const flag = message?.getFlag(SYSTEM_ID, "test");
  if ( !flag ) return null;
  const result = { ...evaluateTest(flag), value: flag.value };

  // Actively monitored systems oppose some actions, and an upgrade from Spotted (p. 256)
  const opposed = intrusion.monitor && (SUBVERSIONS[action].opposed || ((action === "upgradeStatus") && (intrusion.status === "spotted")));
  const monitor = opposed ? await rollMonitor(intrusion.monitor) : null;
  const won = monitor ? (opposedWinner(result, { ...monitor, value: monitor.value }) === "attacker") : result.success;

  let status = mesh.statusAfterTest(intrusion.status, result);
  if ( (action === "upgradeStatus") && won && result.excellent && (status === intrusion.status) ) status = mesh.upgradeStatus(status);
  if ( status !== intrusion.status ) await updateIntrusion(actor, id, { status });
  return postResult(actor, {
    title: `${game.i18n.localize(`EP1E.Mesh.action.${action}`)} — ${intrusion.target}`,
    monitor, won, subversion: true, status, changed: status !== intrusion.status,
    crash: (action === "crashAI") ? game.i18n.localize("EP1E.Mesh.crashHint") : ""
  }, monitor ? [monitor.roll] : []);
}

/* -------------------------------------------- */
/*  Scorching                                   */
/* -------------------------------------------- */

/**
 * Scorch the ego in a hacked cyberbrain (p. 261): an attack card opposed by the target's Infosec,
 * with the -30 cyberbrain modifier and the intruder's status.
 */
export async function scorch(actor, id, programId) {
  const intrusion = getIntrusion(actor, id);
  const program = actor.items.get(programId);
  if ( !intrusion || !program ) return null;
  const tokens = Array.from(game.user.targets).filter(t => t.actor);
  if ( !tokens.length ) return ui.notifications.warn("EP1E.Mesh.scorchTarget", { localize: true });
  const p = program.system;
  const { target, label, skill } = actor.system.getSkillTarget("infosec");
  return rollSkillTest(actor, {
    label: `${program.name} (${label})`,
    target,
    specialization: skill?.system.specialization,
    fastForward: true,
    input: { modifier: mesh.CYBERBRAIN_MODIFIER + mesh.statusModifier(intrusion.status) + p.quality },
    attack: {
      name: program.name,
      scorch: true,
      defenseSkill: "infosec",
      formula: p.damage,
      ap: 0,
      // Scorch damage is neurological: armor does not apply
      damageType: "none",
      stress: p.harm === "stress",
      effect: p.effect,
      ranged: false,
      notes: [game.i18n.localize("EP1E.Mesh.cyberbrain"), game.i18n.localize(`EP1E.Mesh.status.${intrusion.status}`)],
      targets: tokens.map(t => ({ tokenUuid: t.document.uuid, actorUuid: t.actor.uuid, name: t.name }))
    }
  });
}

/**
 * Resolve the WIL x 2 Test of a nightmare, shutter or spasm scorcher on a hit target (p. 332).
 * @param {Actor} actor       The ego that was hit
 * @param {string} effect     nightmare | shutter | spasm
 * @param {boolean} excellent The attacker scored an Excellent Success (shutter: -60)
 */
export async function scorchEffect(actor, effect, { excellent = false } = {}) {
  if ( effect === "shutter" ) {
    // -30 to one sense (-60 on an Excellent Success), fading by 10 per Action Turn: the GM picks the sense
    const modifier = excellent ? -60 : -30;
    return postResult(actor, { title: game.i18n.localize("EP1E.Mesh.shutter"), note: game.i18n.format("EP1E.Mesh.shutterNote", { modifier }) });
  }
  const wil = actor.system.aptitudes.wil.value;
  const message = await rollSkillTest(actor, {
    label: `${game.i18n.localize(`EP1E.Mesh.${effect}`)} (${game.i18n.localize("EP1E.Aptitude.wil")} × 2)`,
    target: wil * 2, fastForward: true
  });
  const flag = message?.getFlag(SYSTEM_ID, "test");
  if ( !flag ) return null;
  const result = evaluateTest(flag);
  const turns = Math.max(1, Math.floor(result.margin / 10));
  if ( effect === "spasm" ) {
    // Failure: convulsing and disabled 1 turn per 10 MoF; success: -30 fading by 10 per turn. Pain tolerance does not help
    if ( result.success ) return setCondition(actor, "stunned", { modifier: -30, timer: { left: 1, every: 1, step: 10 } });
    await setCondition(actor, "prone");
    return setCondition(actor, "incapacitated", { timer: { left: turns } });
  }
  if ( effect === "nightmare" ) {
    // Success: -10 until the end of the next turn; failure: 1d10 ÷ 2 stress and panic for 1 turn per 10 MoF
    if ( result.success ) return setCondition(actor, "stunned", { modifier: -10, timer: { left: 2 } });
    const roll = await new Roll("ceil(1d10 / 2)").evaluate();
    await applyToActor(actor, { label: game.i18n.localize("EP1E.Mesh.nightmare"), total: roll.total, stress: true }, { rolls: [roll] });
    return postResult(actor, { title: game.i18n.localize("EP1E.Mesh.nightmare"), note: game.i18n.format("EP1E.Mesh.panic", { turns }) });
  }
}

/* -------------------------------------------- */
/*  AIs                                         */
/* -------------------------------------------- */

/**
 * Create an NPC actor from an AI program (p. 331): its aptitudes and skills, unable to default (p. 264).
 * @param {Item} program  An AI software item
 * @param {object} [options]
 * @param {Actor} [options.owner]  The character the AI or muse serves (its name prefixes the AI's)
 */
export async function createAIActor(program, { owner = null } = {}) {
  const p = program.system;
  const apt = p.aptitudes;
  const skills = p.skills.map(s => {
    const cfg = SKILLS[s.key];
    const base = cfg ? apt[cfg.aptitude] : 0;
    const data = cfg
      ? CONFIG.Item.dataModels.skill.fromKey(s.key, { system: { field: s.field, specialization: s.specialization } })
      : { name: s.name, type: "skill", system: { field: s.field, specialization: s.specialization } };
    data.system.ranks = Math.max(0, s.value - base);
    return data;
  });
  const name = owner ? game.i18n.format("EP1E.Mesh.aiOf", { name: program.name, owner: owner.name }) : program.name;
  const actor = await Actor.implementation.create({
    name,
    type: "npc",
    img: program.img,
    system: {
      ai: true,
      moxie: { value: 0, max: 0 },
      aptitudes: Object.fromEntries(Object.entries(apt).map(([k, v]) => [k, { base: v, mod: 0 }])),
      biography: p.description
    },
    items: skills
  });
  if ( actor ) {
    ui.notifications.info(game.i18n.format("EP1E.Mesh.aiCreated", { name: actor.name }));
    actor.sheet.render(true);
  }
  return actor;
}
