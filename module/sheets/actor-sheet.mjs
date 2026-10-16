import { APTITUDES, REP_NETWORKS, SKILLS, SYSTEM_ID, skillChoices } from "../config.mjs";
import { SkillData } from "../data/item.mjs";
import { postDamageRoll, rollAptitudeTest, rollSkillTest } from "../dice/tests.mjs";
import { reloadWeapon } from "../dice/attack.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

const T = path => `systems/${SYSTEM_ID}/templates/actor/${path}.hbs`;

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
      sleeve: EPActorSheet.#onSleeve,
      itemToChat: EPActorSheet.#onItemToChat,
      applyHarm: EPActorSheet.#onApplyHarm,
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
      sleights: byType("sleight"),
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
      shock: { label: game.i18n.localize("EP1E.Combat.shockTest"), target: sys.stats.dur + sys.armor.energy }
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
