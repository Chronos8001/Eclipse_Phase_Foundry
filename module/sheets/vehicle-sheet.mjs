import { SYSTEM_ID } from "../config.mjs";
import { rollSkillTest } from "../dice/tests.mjs";
import { reloadWeapon } from "../dice/attack.mjs";
import { ItemSummaries } from "../helpers/summaries.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Sheet of robots and vehicles: shell statistics, damage, weapons and the controller's Pilot skill. */
export class EPVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["ep1e", "sheet", "actor", "vehicle"],
    position: { width: 680, height: 700 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollPilot: EPVehicleSheet.#onRollPilot,
      rollItem: EPVehicleSheet.#onRollItem,
      createItem: EPVehicleSheet.#onCreateItem,
      editItem: EPVehicleSheet.#onEditItem,
      deleteItem: EPVehicleSheet.#onDeleteItem,
      toggleEquipped: EPVehicleSheet.#onToggleEquipped,
      itemToChat: EPVehicleSheet.#onItemToChat,
      reload: EPVehicleSheet.#onReload,
      toggleSummary: EPVehicleSheet.#onToggleSummary
    }
  };

  /** Item descriptions shown under their row. */
  #summaries = new ItemSummaries(this);

  static #onToggleSummary(event, target) {
    return this.#summaries.toggle(target);
  }

  static PARTS = {
    sheet: { template: `systems/${SYSTEM_ID}/templates/actor/vehicle.hbs`, scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;
    const byType = type => actor.items.filter(i => i.type === type).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    Object.assign(context, {
      actor, system,
      source: actor.toObject(),
      config: CONFIG.EP1E,
      weaponRows: byType("weapon").map(item => ({ item, target: system.pilot, skillLabel: game.i18n.localize("EP1E.Skill.pilot") })),
      gear: actor.items.filter(i => i.type !== "weapon"),
      systemFields: system.schema.fields,
      enriched: {
        biography: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.biography, { relativeTo: actor, secrets: actor.isOwner })
      }
    });
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelectorAll("[data-item-field]").forEach(input => {
      input.addEventListener("change", async event => {
        event.stopPropagation();
        const item = this.document.items.get(input.closest("[data-item-id]")?.dataset.itemId);
        if ( item ) await item.update({ [input.dataset.itemField]: Number(input.value) || 0 });
      });
    });
    await this.#summaries.restore();
  }

  _getItem(target) {
    return this.document.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  /** Pilot Test with the vehicle's handling modifier (p. 195). */
  static #onRollPilot(event) {
    const sys = this.document.system;
    return rollSkillTest(this.document, {
      label: `${game.i18n.localize("EP1E.Skill.pilot")} (${this.document.name})`,
      target: sys.pilot + sys.handling,
      fastForward: event.shiftKey
    });
  }

  static #onRollItem(event, target) {
    return this._getItem(target)?.roll({ fastForward: event.shiftKey });
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(CONFIG.Item.typeLabels[type]) });
    const [item] = await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
    item?.sheet.render(true);
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

  static #onItemToChat(event, target) {
    return this._getItem(target)?.toChat();
  }

  static #onReload(event, target) {
    const item = this._getItem(target);
    if ( item ) return reloadWeapon(item);
  }
}
