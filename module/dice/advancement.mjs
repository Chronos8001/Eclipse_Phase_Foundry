import { APTITUDES, REP_NETWORKS, SYSTEM_ID } from "../config.mjs";
import * as adv from "../rules/advancement.mjs";
import { gmWhisper } from "./tests.mjs";

/**
 * Character creation and advancement (Core pp. 134-136, 152-153): a summary of the Customization Points a sheet
 * stands for, and spending Rez Points.
 */

const L = (key, data) => (data ? game.i18n.format(`EP1E.Advance.${key}`, data) : game.i18n.localize(`EP1E.Advance.${key}`));
const skillsOf = actor => actor.items.filter(i => i.type === "skill");

/** The creation summary of the Ego tab: CP by category, the budget and the rules not followed. */
export function creationSummary(actor) {
  const sys = actor.system;
  const traits = actor.items.filter(i => i.type === "trait");
  const result = adv.creationCost({
    aptitudes: APTITUDES.map(k => sys.aptitudes[k].base),
    moxie: sys.moxie.max,
    skills: skillsOf(actor).map(s => ({
      category: s.system.category, aptitude: sys.aptitudes[s.system.aptitude]?.base ?? 0,
      ranks: s.system.ranks, free: s.system.free, specialized: !!s.system.specialization
    })),
    rep: REP_NETWORKS.map(k => sys.rep[k]),
    traits: traits.map(t => ({ cost: t.system.levelCost ?? t.system.cost, negative: t.system.traitType === "negative", morph: t.system.scope === "morph" })),
    morph: sys.activeMorph?.system.cpCost ?? 0,
    sleights: actor.items.filter(i => i.type === "sleight").length,
    packages: actor.items.filter(i => (i.type === "background") && (i.system.kind === "package")).reduce((sum, i) => sum + i.system.pp, 0),
    other: sys.details.cpOther
  });
  const budget = (sys.details.cp || adv.DEFAULT_CP) + result.gained;
  return {
    // "Other" CP has its own input on the sheet
    lines: Object.entries(result.lines).filter(([key]) => key !== "other").map(([key, cp]) => ({ key, cp, label: `EP1E.Advance.line.${key}` })),
    spent: result.spent, budget, left: budget - result.spent, gained: result.gained,
    warnings: result.warnings.map(w => L(`warning.${w.key}`, w.data ?? {}))
  };
}

/** What a Rez Point purchase applies to: the choices of the dialog. */
function rezTargets(actor) {
  const sys = actor.system;
  return {
    aptitudes: APTITUDES.map(k => ({ key: k, label: `EP1E.Aptitude.${k}`, value: sys.aptitudes[k].base })),
    skills: skillsOf(actor).sort((a, b) => a.system.label.localeCompare(b.system.label, game.i18n.lang))
      .map(s => ({ id: s.id, label: s.system.label, total: s.system.total })),
    networks: REP_NETWORKS.map(k => ({ key: k, label: `EP1E.Rep.${k}`, value: sys.rep[k] }))
  };
}

/** The cost of a purchase from the dialog's values, as { cost } or { error }, with the update it makes. */
function purchase(actor, data) {
  const sys = actor.system;
  const kind = data.kind;
  const points = Number(data.points) || 0;
  const skill = actor.items.get(data.skill);
  switch ( kind ) {
    case "aptitude": {
      const key = data.aptitude;
      const linkedTotals = skillsOf(actor).filter(s => s.system.aptitude === key).map(s => s.system.total);
      const res = adv.rezCost(kind, { from: sys.aptitudes[key].base, points, linkedTotals });
      return { ...res, update: { [`system.aptitudes.${key}.base`]: sys.aptitudes[key].base + points },
        what: L("boughtAptitude", { aptitude: game.i18n.localize(`EP1E.Aptitude.${key}`), points }) };
    }
    case "skill":
    case "specialization": {
      if ( !skill ) return { error: "nothing" };
      const res = adv.rezCost(kind, { total: skill.system.total, points: kind === "skill" ? points : 1, specialized: !!skill.system.specialization });
      if ( (kind === "specialization") && !String(data.specialization ?? "").trim() ) return { error: "specializationName" };
      const itemUpdate = (kind === "skill") ? { "system.ranks": skill.system.ranks + points }
        : { "system.specialization": String(data.specialization).trim() };
      return { ...res, itemUpdate, item: skill,
        what: (kind === "skill") ? L("boughtSkill", { skill: skill.system.label, points })
          : L("boughtSpecialization", { skill: skill.system.label, specialization: String(data.specialization).trim() }) };
    }
    case "moxie": {
      const res = adv.rezCost(kind, { from: sys.moxie.max, points });
      return { ...res, update: { "system.moxie.max": sys.moxie.max + points, "system.moxie.value": sys.moxie.value + points },
        what: L("boughtMoxie", { points }) };
    }
    case "rep": {
      const key = data.network;
      const res = adv.rezCost(kind, { points });
      return { ...res, update: { [`system.rep.${key}`]: sys.rep[key] + (points * adv.REP_PER_POINT) },
        what: L("boughtRep", { rep: game.i18n.localize(`EP1E.Rep.${key}`), value: points * adv.REP_PER_POINT }) };
    }
    case "credit": {
      const res = adv.rezCost(kind, { points });
      return { ...res, update: { "system.details.credits": sys.details.credits + (points * adv.CREDIT_PER_POINT) },
        what: L("boughtCredit", { credit: points * adv.CREDIT_PER_POINT }) };
    }
    case "sleight": {
      const psi = actor.items.some(i => (i.type === "trait") && (i.system.key === "psi"));
      return { ...adv.rezCost(kind, { points, psi }), update: {}, what: L("boughtSleight", { points }) };
    }
  }
  return { error: "nothing" };
}

/** Prompt for spending Rez Points, previewing the cost, then apply the purchase and log it in chat. */
export async function promptRez(actor) {
  const content = await foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/dialog/rez.hbs`, {
    ...rezTargets(actor), available: actor.system.details.rez.value,
    kinds: ["aptitude", "skill", "specialization", "moxie", "rep", "credit", "sleight"].map(k => ({ key: k, label: `EP1E.Advance.kind.${k}` }))
  });
  const read = form => new foundry.applications.ux.FormDataExtended(form).object;
  // Show the fields of the chosen purchase and its cost as the form changes (renderDialogV2 hook)
  const hook = Hooks.on("renderDialogV2", (dialog, element) => {
    if ( !dialog.options.classes.includes("ep1e-rez") ) return;
    const form = element.querySelector("form") ?? element;
    const refresh = () => {
      const values = read(form);
      form.querySelectorAll("[data-for]").forEach(el => { el.hidden = !el.dataset.for.split(" ").includes(values.kind); });
      const res = purchase(actor, values);
      const cost = form.querySelector(".rez-cost");
      if ( cost ) cost.textContent = res.error ? L(`error.${res.error}`) : L("cost", { cost: res.cost });
    };
    form.addEventListener("change", refresh);
    form.addEventListener("input", refresh);
    refresh();
  });
  let data;
  try {
    data = await foundry.applications.api.DialogV2.wait({
      window: { title: L("title", { name: actor.name }), icon: "fa-solid fa-arrow-trend-up" },
      classes: ["ep1e", "ep1e-dialog", "ep1e-rez"],
      content,
      buttons: [{ action: "buy", label: "EP1E.Advance.buy", icon: "fa-solid fa-check", default: true, callback: (event, button) => read(button.form) }],
      rejectClose: false
    });
  } finally {
    Hooks.off("renderDialogV2", hook);
  }
  if ( !data ) return null;
  const res = purchase(actor, data);
  if ( res.error ) return ui.notifications.warn(L(`error.${res.error}`));
  const available = actor.system.details.rez.value;
  if ( res.cost > available ) return ui.notifications.warn(L("notEnough", { cost: res.cost, available }));
  await actor.update({ ...res.update, "system.details.rez.value": available - res.cost });
  if ( res.itemUpdate ) await res.item.update(res.itemUpdate);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="ep1e chat-card"><p>${L("spentLog", { name: actor.name, cost: res.cost, what: res.what })}</p>
      <p class="hint">${L("monthly")}</p></div>`,
    whisper: gmWhisper(actor)
  });
}
