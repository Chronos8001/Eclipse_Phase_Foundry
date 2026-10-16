import { APTITUDES, REP_NETWORKS, SKILLS, SYSTEM_ID, skillChoices } from "../config.mjs";
import { SkillData } from "../data/item.mjs";
import { applyToActor, postDamageRoll, rollAptitudeTest, rollSkillTest } from "../dice/tests.mjs";
import { fallingDamage, shockTarget } from "../rules/combat.mjs";
import { reloadWeapon } from "../dice/attack.mjs";
import { createAIActor, hackSystem, removeIntrusion, scorch, subvertSystem, updateIntrusion } from "../dice/mesh.mjs";
import { ALERTS, statusModifier } from "../rules/mesh.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

const T = path => `systems/${SYSTEM_ID}/templates/actor/${path}.hbs`;
const PSI_ORDER = ["chi", "gamma", "epsilon"];

export class EPActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["ep1e", "sheet", "actor"],
    position: { width: 820, height: 780 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollAptitude: EPActorSheet.#onRollAptitude,
      rollItem: EPActorSheet.#onRollItem,
      rollFray: EPActorSheet.#onRollFray,
      rollStat: EPActorSheet.#onRollStat,
      createItem: EPActorSheet.#onCreateItem,
      createSkill: EPActorSheet.#onCreateSkill,
      editItem: EPActorSheet.#onEditItem,
      deleteItem: EPActorSheet.#onDeleteItem,
      toggleEquipped: EPActorSheet.#onToggleEquipped,
      reload: EPActorSheet.#onReload,
      hack: EPActorSheet.#onHack,
      subvert: EPActorSheet.#onSubvert,
      scorch: EPActorSheet.#onScorch,
      removeIntrusion: EPActorSheet.#onRemoveIntrusion,
      createAIActor: EPActorSheet.#onCreateAIActor,
      sleeve: EPActorSheet.#onSleeve,
      itemToChat: EPActorSheet.#onItemToChat,
      applyHarm: EPActorSheet.#onApplyHarm,
      fall: EPActorSheet.#onFall,
      resetMoxie: EPActorSheet.#onResetMoxie,
      createEffect: EPActorSheet.#onCreateEffect,
      editEffect: EPActorSheet.#onEditEffect,
      deleteEffect: EPActorSheet.#onDeleteEffect,
      toggleEffect: EPActorSheet.#onToggleEffect
    }
  };

  static PARTS = {
    header: { template: T("header") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    main: { template: T("main"), scrollable: [""] },
    skills: { template: T("skills"), scrollable: [""] },
    combat: { template: T("combat"), scrollable: [""] },
    equipment: { template: T("equipment"), scrollable: [""] },
    traits: { template: T("traits"), scrollable: [""] },
    ego: { template: T("ego"), scrollable: [""] },
    mesh: { template: T("mesh"), scrollable: [""] },
    effects: { template: T("effects"), scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "main", icon: "fa-solid fa-user-astronaut" },
        { id: "skills", icon: "fa-solid fa-list-check" },
        { id: "combat", icon: "fa-solid fa-crosshairs" },
        { id: "equipment", icon: "fa-solid fa-toolbox" },
        { id: "traits", icon: "fa-solid fa-brain" },
        { id: "ego", icon: "fa-solid fa-id-card" },
        { id: "mesh", icon: "fa-solid fa-network-wired" },
        { id: "effects", icon: "fa-solid fa-bolt" }
      ],
      initial: "main",
      labelPrefix: "EP1E.Tab"
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const byType = type => actor.items.filter(i => i.type === type).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    const skills = byType("skill").sort((a, b) => a.system.label.localeCompare(b.system.label, game.i18n.lang));
    const fray = system.getSkillTarget("fray").target;

    Object.assign(context, {
      actor, system,
      config: CONFIG.EP1E,
      isGM: game.user.isGM,
      isCharacter: actor.type === "character",
      tabs: this._prepareTabs("primary"),
      aptitudes: APTITUDES.map(key => ({
        key, ...system.aptitudes[key],
        label: `EP1E.Aptitude.${key}`,
        abbr: `EP1E.AptitudeAbbr.${key}`
      })),
      rep: REP_NETWORKS.map(key => ({ key, value: system.rep[key], label: `EP1E.Rep.${key}` })),
      morphs: byType("morph"),
      activeMorph: system.activeMorph,
      skillGroups: ["active", "knowledge"].map(category => ({
        category,
        title: `EP1E.SkillCategory.${category}`,
        list: skills.filter(s => s.system.category === category).map(item => ({
          item,
          hasField: !!SKILLS[item.system.key]?.field,
          aptitudeAbbr: `EP1E.AptitudeAbbr.${item.system.aptitude}`
        }))
      })),
      weaponRows: byType("weapon").map(item => {
        const w = item.system;
        const { target, label } = system.getSkillTarget(w.skill);
        return {
          item, target, skillLabel: label || "—",
          loaded: w.launcher ? actor.items.get(w.ammo.loaded)?.name : null,
          // Grenades and missiles are counted by quantity
          thrown: w.munition.kind !== "none"
        };
      }),
      armor: byType("armor"),
      gear: byType("gear"),
      augmentations: byType("augmentation"),
      traits: byType("trait"),
      software: byType("software"),
      substances: byType("substance"),
      intrusions: system.intrusions.map(i => ({
        ...i, alert: ALERTS[i.status], modifier: statusModifier(i.status),
        privilegeLabel: `EP1E.Mesh.privilege.${i.privileges}`
      })),
      intrusionStatuses: Object.fromEntries(["hidden", "covert", "spotted", "locked"].map(k => [k, `EP1E.Mesh.status.${k}`])),
      sleights: byType("sleight").sort((a, b) => PSI_ORDER.indexOf(a.system.psiType) - PSI_ORDER.indexOf(b.system.psiType)),
      effects: Array.from(actor.allApplicableEffects?.() ?? actor.effects),
      fray: { melee: fray + system.mods.defense, ranged: Math.floor(fray / 2) + system.mods.defense },
      woundSlots: Array.from({ length: Math.max(system.wounds.value, 0) }),
      enriched: {
        biography: await TextEditor().enrichHTML(system.biography, { relativeTo: actor, secrets: actor.isOwner }),
        notes: await TextEditor().enrichHTML(system.notes, { relativeTo: actor, secrets: actor.isOwner })
      },
      systemFields: system.schema.fields
    });
    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( partId in (context.tabs ?? {}) ) context.tab = context.tabs[partId];
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Inline editing of embedded item fields (skill ranks, ammo, etc.)
    this.element.querySelectorAll("[data-item-field]").forEach(input => {
      input.addEventListener("change", this.#onItemFieldChange.bind(this));
    });
    this.element.querySelectorAll("[data-intrusion-field]").forEach(input => {
      input.addEventListener("change", this.#onIntrusionFieldChange.bind(this));
    });
  }

  async #onIntrusionFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const id = input.closest("[data-intrusion-id]")?.dataset.intrusionId;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if ( input.type === "number" ) value = Number(value) || 0;
    if ( id ) await updateIntrusion(this.document, id, { [input.dataset.intrusionField]: value });
  }

  async #onItemFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const item = this.document.items.get(input.closest("[data-item-id]")?.dataset.itemId);
    if ( !item ) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if ( input.type === "number" ) value = Number(value) || 0;
    await item.update({ [input.dataset.itemField]: value });
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  _getItem(target) {
    return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  _getEffect(target) {
    const row = target.closest("[data-effect-id]");
    if ( !row ) return null;
    const parent = row.dataset.parentId ? this.document.items.get(row.dataset.parentId) : this.document;
    return parent?.effects.get(row.dataset.effectId) ?? null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onRollAptitude(event, target) {
    return rollAptitudeTest(this.document, target.dataset.aptitude, { fastForward: event.shiftKey });
  }

  static #onRollItem(event, target) {
    return this._getItem(target)?.roll({ fastForward: event.shiftKey });
  }

  /** Fray defense; halved against ranged attacks (Core p. 191). */
  static #onRollFray(event, target) {
    const ranged = target.dataset.ranged === "true";
    const sys = this.document.system;
    const { target: value, label } = sys.getSkillTarget("fray");
    return rollSkillTest(this.document, {
      label: ranged ? game.i18n.format("EP1E.Combat.frayRanged", { label }) : label,
      target: (ranged ? Math.floor(value / 2) : value) + sys.mods.defense,
      fastForward: event.shiftKey
    });
  }

  /** Stat-based tests such as WIL x 2 or DUR + Energy armor. */
  static #onRollStat(event, target) {
    const sys = this.document.system;
    const { stat } = target.dataset;
    const tests = {
      lucidity: { label: game.i18n.localize("EP1E.Stat.luc"), target: sys.stats.luc },
      willpower: { label: `${game.i18n.localize("EP1E.Aptitude.wil")} × 2`, target: sys.aptitudes.wil.value * 2 },
      shock: { label: game.i18n.localize("EP1E.Combat.shockTest"), target: shockTarget(sys.stats.dur, sys.damage.value, sys.armor.energy) }
    };
    const test = tests[stat];
    if ( test ) return rollSkillTest(this.document, { ...test, fastForward: event.shiftKey });
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(CONFIG.Item.typeLabels[type]) });
    const [item] = await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
    item?.sheet.render(true);
  }

  /** Create a skill from the configured list (or a custom one). */
  static async #onCreateSkill(event, target) {
    const category = target.dataset.category;
    const choices = Object.fromEntries(Object.entries(skillChoices({ blank: true }))
      .filter(([k]) => !k || (SKILLS[k].category === category)));
    const options = Object.entries(choices).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("EP1E.Skill.add") },
      classes: ["ep1e", "ep1e-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize("EP1E.Skill.label")}</label><select name="key">${options}</select></div>
        <div class="form-group"><label>${game.i18n.localize("EP1E.Skill.field")}</label><input type="text" name="field"></div>`,
      ok: { label: "EP1E.Skill.add", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      rejectClose: false
    });
    if ( !result ) return;
    const data = result.key
      ? SkillData.fromKey(result.key, { system: { field: result.field ?? "" } })
      : { name: game.i18n.localize("EP1E.Skill.newSkill"), type: "skill", system: { category, field: result.field ?? "" } };
    const [item] = await this.document.createEmbeddedDocuments("Item", [data]);
    if ( !result.key ) item?.sheet.render(true);
  }

  static #onEditItem(event, target) {
    this._getItem(target)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this._getItem(target);
    if ( !item ) return;
    if ( !event.shiftKey ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.format("EP1E.Item.deleteTitle", { name: item.name }) },
        content: `<p>${game.i18n.format("EP1E.Item.deleteConfirm", { name: item.name })}</p>`
      });
      if ( !ok ) return;
    }
    return item.delete();
  }

  static #onToggleEquipped(event, target) {
    const item = this._getItem(target);
    return item?.update({ "system.equipped": !item.system.equipped });
  }

  static #onHack() {
    return hackSystem(this.document);
  }

  static #onSubvert(event, target) {
    return subvertSystem(this.document, target.closest("[data-intrusion-id]")?.dataset.intrusionId);
  }

  /** Scorch the ego of a hacked cyberbrain with one of the actor's scorchers. */
  static async #onScorch(event, target) {
    const id = target.closest("[data-intrusion-id]")?.dataset.intrusionId;
    const programs = this.document.items.filter(i => (i.type === "software") && (i.system.category === "scorcher"));
    if ( !programs.length ) return ui.notifications.warn("EP1E.Mesh.noScorcher", { localize: true });
    let programId = programs[0].id;
    if ( programs.length > 1 ) {
      const options = programs.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
      const result = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("EP1E.Mesh.scorch") },
        classes: ["ep1e", "ep1e-dialog"],
        content: `<div class="form-group"><label>${game.i18n.localize("EP1E.Software.scorcher")}</label><select name="program">${options}</select></div>`,
        ok: { label: "EP1E.Mesh.scorch", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
        rejectClose: false
      });
      if ( !result ) return;
      programId = result.program;
    }
    return scorch(this.document, id, programId);
  }

  static async #onRemoveIntrusion(event, target) {
    const id = target.closest("[data-intrusion-id]")?.dataset.intrusionId;
    if ( id ) return removeIntrusion(this.document, id);
  }

  static #onCreateAIActor(event, target) {
    const item = this._getItem(target);
    if ( item ) return createAIActor(item, { owner: this.document });
  }

  static #onReload(event, target) {
    const item = this._getItem(target);
    if ( item ) return reloadWeapon(item);
  }

  static #onSleeve(event, target) {
    const item = this._getItem(target);
    if ( item ) return this.document.sleeve(item.id);
  }

  static #onItemToChat(event, target) {
    return this._getItem(target)?.toChat();
  }

  static async #onResetMoxie() {
    const moxie = this.document.system.moxie;
    return this.document.update({ "system.moxie.value": moxie.max });
  }

  /** Manual damage / stress entry (from the GM, a fall, a psi attack...). */
  static async #onApplyHarm(event, target) {
    const stress = target.dataset.kind === "stress";
    const typeOptions = Object.entries(CONFIG.EP1E.damageTypes)
      .map(([k, l]) => `<option value="${k}">${game.i18n.localize(l)}</option>`).join("");
    const content = `<div class="form-group"><label>${game.i18n.localize(stress ? "EP1E.Damage.sv" : "EP1E.Damage.dv")}</label>
        <input type="text" name="formula" value="${stress ? "1d10" : "1d10"}" required></div>`
      + (stress ? "" : `<div class="form-group"><label>${game.i18n.localize("EP1E.Weapon.ap")}</label><input type="number" name="ap" value="0"></div>
        <div class="form-group"><label>${game.i18n.localize("EP1E.Weapon.damageType")}</label><select name="damageType">${typeOptions}</select></div>
        <div class="form-group"><label>${game.i18n.localize("EP1E.Damage.armorDefeating")}</label><input type="checkbox" name="armorDefeating"></div>`);
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(stress ? "EP1E.Damage.applyStress" : "EP1E.Damage.applyDamage") },
      classes: ["ep1e", "ep1e-dialog"],
      content,
      ok: { label: "EP1E.Damage.roll", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      rejectClose: false
    });
    if ( !result ) return;
    const roll = await new Roll(String(result.formula || "0")).evaluate();
    return postDamageRoll(this.document, roll, {
      label: game.i18n.localize(stress ? "EP1E.Damage.stress" : "EP1E.Damage.damage"),
      ap: Number(result.ap) || 0,
      damageType: result.damageType ?? "none",
      armorDefeating: !!result.armorDefeating,
      stress
    });
  }

  /** Falling damage (p. 197), resisted by half the kinetic armor. */
  static async #onFall() {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("EP1E.Harm.fall"), icon: "fa-solid fa-person-falling" },
      classes: ["ep1e", "ep1e-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize("EP1E.Harm.fallDistance")}</label>
        <input type="number" name="meters" value="3" min="0" step="0.5" autofocus></div>
        <p class="hint">${game.i18n.localize("EP1E.Harm.fallHint")}</p>`,
      ok: { label: "EP1E.Damage.roll", callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      rejectClose: false
    });
    if ( !result ) return;
    const formula = fallingDamage(Number(result.meters) || 0);
    if ( !formula ) return ui.notifications.info("EP1E.Harm.fallHarmless", { localize: true });
    const roll = await new Roll(formula).evaluate();
    return applyToActor(this.document, {
      label: game.i18n.localize("EP1E.Harm.fall"), total: roll.total, ap: 0, damageType: "kinetic", armorHalved: true
    }, { rolls: [roll] });
  }

  static async #onCreateEffect() {
    const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("EP1E.Effect.new"), img: "icons/svg/aura.svg"
    }]);
    effect?.sheet.render(true);
  }

  static #onEditEffect(event, target) {
    this._getEffect(target)?.sheet.render(true);
  }

  static #onDeleteEffect(event, target) {
    return this._getEffect(target)?.delete();
  }

  static #onToggleEffect(event, target) {
    const effect = this._getEffect(target);
    return effect?.update({ disabled: !effect.disabled });
  }
}
