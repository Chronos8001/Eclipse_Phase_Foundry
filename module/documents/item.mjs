import { rollAttack, rollSkillTest } from "../dice/tests.mjs";
import { createMessage } from "../helpers/chat.mjs";

export class EPItem extends Item {

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    // The first morph added to an actor becomes the sleeved one
    if ( (this.type === "morph") && this.actor && !this.actor.system.activeMorph ) {
      this.updateSource({ "system.active": true });
    }
    else if ( (this.type === "morph") && this.actor && this.system.active ) {
      this.updateSource({ "system.active": false });
    }
  }

  /** Roll whatever this item naturally rolls. */
  async roll(options = {}) {
    if ( !this.actor ) return null;
    switch ( this.type ) {
      case "skill":
        return rollSkillTest(this.actor, {
          label: this.system.label,
          target: this.system.total,
          specialization: this.system.specialization,
          ...options
        });
      case "weapon":
        return rollAttack(this.actor, this, options);
      case "sleight": {
        const { target, label } = this.actor.system.getSkillTarget(this.system.skill);
        return rollSkillTest(this.actor, {
          label: label ? `${this.name} (${label})` : this.name,
          target: label ? target : this.actor.system.aptitudes.wil.value,
          ...options
        });
      }
      default:
        return this.toChat();
    }
  }

  /** Post the item description to chat. */
  async toChat() {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const content = `<div class="ep1e chat-card item-card"><header><img src="${this.img}" alt=""><h3>${this.name}</h3></header>`
      + `${await TextEditor.enrichHTML(this.system.description ?? "", { relativeTo: this })}</div>`;
    return createMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor: this.actor }), content });
  }
}
