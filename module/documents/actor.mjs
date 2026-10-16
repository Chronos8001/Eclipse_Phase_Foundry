import { APTITUDES, SKILLS } from "../config.mjs";
import { SkillData } from "../data/item.mjs";
import { fallingArmor } from "../rules/combat.mjs";

export class EPActor extends Actor {

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    const updates = {};
    if ( this.type === "character" ) {
      updates["prototypeToken.actorLink"] = true;
      updates["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      // New characters start with the standard skill list (unless created from existing data)
      if ( !this.items.some(i => i.type === "skill") ) {
        updates.items = [...(data.items ?? []), ...EPActor.starterSkills()];
      }
    }
    updates["prototypeToken.bar1.attribute"] = "damage";
    updates["prototypeToken.bar2.attribute"] = "stress";
    this.updateSource(updates);
  }

  /** Item data for the default set of skills given to new characters. */
  static starterSkills() {
    return Object.entries(SKILLS)
      .filter(([, cfg]) => cfg.starter)
      .map(([key]) => SkillData.fromKey(key));
  }

  /** @override */
  getRollData() {
    // Core returns the system model itself: copy it so derived shortcuts don't leak into the document
    const data = { ...super.getRollData() };
    const sys = this.system;
    for ( const k of APTITUDES ) data[k] = sys.aptitudes[k].value;
    Object.assign(data, sys.stats ?? {});
    // Wounds and traumas lower the Initiative score (Core p. 189)
    data.initiative = (sys.stats?.init ?? 0) - (sys.penalty?.initiative ?? 0);
    data.penalty = sys.penalty?.total ?? 0;
    return data;
  }

  /** Sleeve into one of the actor's morph items, deactivating the others. */
  async sleeve(morphId) {
    const updates = this.items.filter(i => i.type === "morph").map(i => ({
      _id: i.id, "system.active": i.id === morphId ? !i.system.active : false
    }));
    return this.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Apply physical damage (Core pp. 192, 207).
   * @param {object} opts
   * @param {number} opts.dv              Rolled damage value
   * @param {number} [opts.ap=0]          Armor penetration (negative number)
   * @param {string} [opts.damageType]    kinetic | energy | none
   * @param {boolean} [opts.armorDefeating] Critical hit: armor is ignored
   * @param {boolean} [opts.armorHalved]  Armor counts for half, rounded down (falls, p. 197)
   * @param {boolean} [opts.armorDoubled] Armor counts double (plastic ammunition, p. 337)
   */
  async applyDamage({ dv, ap = 0, damageType = "kinetic", armorDefeating = false, armorHalved = false, armorDoubled = false }) {
    const sys = this.system;
    let baseArmor = (damageType === "none") ? 0 : (sys.armor[damageType] ?? 0);
    if ( armorHalved ) baseArmor = fallingArmor(baseArmor);
    if ( armorDoubled ) baseArmor *= 2;
    const armor = armorDefeating ? 0 : Math.max(0, baseArmor + ap);
    const damage = Math.max(0, dv - armor);
    const wt = sys.stats.wt;
    const wounds = (wt > 0) ? Math.floor(damage / wt) : 0;
    await this.update({
      "system.damage.value": sys.damage.value + damage,
      "system.wounds.value": sys.wounds.value + wounds
    });
    return { kind: "damage", dv, armor, damage, wounds, total: this.system.damage.value };
  }

  /** Apply mental stress (Core p. 209). Armor never applies. */
  async applyStress({ sv }) {
    const sys = this.system;
    const stress = Math.max(0, sv);
    const tt = sys.stats.tt;
    const traumas = (tt > 0) ? Math.floor(stress / tt) : 0;
    await this.update({
      "system.stress.value": sys.stress.value + stress,
      "system.trauma.value": sys.trauma.value + traumas
    });
    return { kind: "stress", sv, damage: stress, wounds: traumas, total: this.system.stress.value };
  }
}
