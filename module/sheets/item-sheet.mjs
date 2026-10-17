import { APTITUDES, SYSTEM_ID, skillChoices } from "../config.mjs";
import { createAIActor } from "../dice/mesh.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class EPItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["ep1e", "sheet", "item"],
    position: { width: 560, height: 600 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addSkillBonus: EPItemSheet.#onAddSkillBonus,
      removeSkillBonus: EPItemSheet.#onRemoveSkillBonus,
      createEffect: EPItemSheet.#onCreateEffect,
      editEffect: EPItemSheet.#onEditEffect,
      deleteEffect: EPItemSheet.#onDeleteEffect,
      toggleEffect: EPItemSheet.#onToggleEffect,
      createAIActor: EPItemSheet.#onCreateAIActor
    }
  };

  static PARTS = {
    header: { template: `systems/${SYSTEM_ID}/templates/item/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    details: { template: `systems/${SYSTEM_ID}/templates/item/details.hbs`, scrollable: [""] },
    description: { template: `systems/${SYSTEM_ID}/templates/item/description.hbs`, scrollable: [""] },
    effects: { template: `systems/${SYSTEM_ID}/templates/item/effects.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "details", icon: "fa-solid fa-sliders" },
        { id: "description", icon: "fa-solid fa-book-open" },
        { id: "effects", icon: "fa-solid fa-bolt" }
      ],
      initial: "details",
      labelPrefix: "EP1E.Tab"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const cfg = CONFIG.EP1E;
    Object.assign(context, {
      item,
      system: item.system,
      config: cfg,
      systemFields: item.system.schema.fields,
      tabs: this._prepareTabs("primary"),
      detailsPartial: `systems/${SYSTEM_ID}/templates/item/parts/${item.type}.hbs`,
      typeLabel: CONFIG.Item.typeLabels[item.type],
      aptitudeChoices: Object.fromEntries(APTITUDES.map(k => [k, cfg.aptitudeAbbr[k]])),
      aptitudes: APTITUDES.map(k => ({
        key: k, abbr: cfg.aptitudeAbbr[k],
        max: item.system.aptitudeMax?.[k], bonus: item.system.aptitudeBonus?.[k]
      })),
      skillChoices: skillChoices({ blank: true }),
      effects: Array.from(item.effects),
      enrichedDescription: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description, {
        relativeTo: item, secrets: item.isOwner
      })
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
    // Morph skill bonuses live in an array: edit them outside the regular form submission
    this.element.querySelectorAll("[data-bonus-index]").forEach(input => {
      input.addEventListener("change", this.#onSkillBonusChange.bind(this));
    });
  }

  async #onSkillBonusChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const bonuses = foundry.utils.deepClone(this.document.system._source.skillBonuses ?? []);
    const entry = bonuses[Number(input.dataset.bonusIndex)];
    if ( !entry ) return;
    entry[input.dataset.bonusField] = input.type === "number" ? (Number(input.value) || 0) : input.value;
    await this.document.update({ "system.skillBonuses": bonuses });
  }

  /* -------------------------------------------- */

  static #onAddSkillBonus() {
    const bonuses = foundry.utils.deepClone(this.document.system._source.skillBonuses ?? []);
    bonuses.push({ key: "", value: 10 });
    return this.document.update({ "system.skillBonuses": bonuses });
  }

  static #onRemoveSkillBonus(event, target) {
    const index = Number(target.dataset.index);
    const bonuses = foundry.utils.deepClone(this.document.system._source.skillBonuses ?? []);
    bonuses.splice(index, 1);
    return this.document.update({ "system.skillBonuses": bonuses });
  }

  _getEffect(target) {
    return this.document.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static async #onCreateEffect() {
    const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("EP1E.Effect.new"), img: "icons/svg/aura.svg", transfer: true
    }]);
    effect?.sheet.render(true);
  }

  static #onEditEffect(event, target) {
    this._getEffect(target)?.sheet.render(true);
  }

  static #onDeleteEffect(event, target) {
    return this._getEffect(target)?.delete();
  }

  /** Create an NPC from an AI program, owned by the program's owner if any. */
  static #onCreateAIActor() {
    return createAIActor(this.document, { owner: this.document.actor });
  }

  static #onToggleEffect(event, target) {
    const effect = this._getEffect(target);
    return effect?.update({ disabled: !effect.disabled });
  }
}
