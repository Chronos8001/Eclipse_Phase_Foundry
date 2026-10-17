/**
 * Item descriptions shown under their row in the actor sheets (the chevron of templates/actor/parts/item-controls.hbs).
 * Each sheet keeps the ids of the open ones so that they stay open when it renders again.
 */
export class ItemSummaries {

  /** @param {foundry.applications.api.DocumentSheetV2} sheet */
  constructor(sheet) {
    this.sheet = sheet;
    this.open = new Set();
  }

  /** Open or close the description of the row holding `target`. */
  async toggle(target) {
    const row = target.closest("[data-item-id]");
    if ( !row ) return;
    const id = row.dataset.itemId;
    const open = !this.open.has(id);
    if ( open ) this.open.add(id);
    else this.open.delete(id);
    await this.#show(row, open);
  }

  /** After a render: show again the descriptions that were open. */
  async restore() {
    for ( const id of this.open ) {
      const row = this.sheet.element.querySelector(`[data-item-id="${id}"]`);
      if ( row ) await this.#show(row, true);
      else this.open.delete(id);
    }
  }

  /** Show (or hide) an item's description under its row: a list item, or a table row spanning the table. */
  async #show(row, open) {
    const next = row.nextElementSibling;
    if ( next?.classList.contains("item-summary") ) next.remove();
    row.classList.toggle("expanded", open);
    if ( !open ) return;
    const item = this.sheet.document.items.get(row.dataset.itemId);
    if ( !item ) return;
    const text = item.system.description
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description, { relativeTo: item, secrets: item.isOwner })
      : `<p class="hint">${game.i18n.localize("EP1E.Item.noDescription")}</p>`;
    const summary = document.createElement((row.tagName === "TR") ? "tr" : "li");
    summary.className = "item-summary";
    summary.hidden = row.hidden;
    summary.innerHTML = (row.tagName === "TR") ? `<td colspan="${row.children.length}">${text}</td>` : text;
    row.after(summary);
  }
}
