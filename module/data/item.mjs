import { APTITUDES, SKILLS } from "../config.mjs";

const { SchemaField, NumberField, StringField, BooleanField, HTMLField, ArrayField } = foundry.data.fields;

const int = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const text = (initial = "") => new StringField({ required: true, blank: true, initial });
const choice = (choices, initial) => new StringField({ required: true, blank: false, initial, choices });
const description = () => new HTMLField({ required: true, blank: true });

class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { description: description() };
  }
}

/* -------------------------------------------- */

export class SkillData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      key: text(),
      aptitude: choice(APTITUDES, "cog"),
      category: choice(["active", "knowledge"], "active"),
      field: text(),
      ranks: int(0, { min: 0 }),
      mod: int(0),
      specialization: text(),
      noDefault: new BooleanField({ initial: false })
    };
  }

  prepareDerivedData() {
    const name = this.parent.name;
    this.label = this.field ? `${name}: ${this.field}` : name;
    // Embedded skills are rated by the owning actor (EgoData#prepareSkills), which needs its aptitudes first
    if ( this.parent.actor ) return;
    this.aptitudeValue = 0;
    this.morphBonus = 0;
    this.total = this.ranks + this.mod;
  }

  /** Default skill data for a configured skill key. */
  static fromKey(key, overrides = {}) {
    const cfg = SKILLS[key];
    return foundry.utils.mergeObject({
      name: game.i18n.localize(`EP1E.Skill.${key}`),
      type: "skill",
      img: cfg.category === "knowledge" ? "icons/svg/book.svg" : "icons/svg/d20-black.svg",
      system: { key, aptitude: cfg.aptitude, category: cfg.category, noDefault: !!cfg.noDefault }
    }, overrides);
  }
}

/* -------------------------------------------- */

export class MorphData extends BaseItemData {
  static defineSchema() {
    const perAptitude = initial => new SchemaField(Object.fromEntries(APTITUDES.map(k => [k, int(initial)])));
    return {
      ...super.defineSchema(),
      morphType: choice(["biomorph", "pod", "synthmorph", "infomorph"], "biomorph"),
      aptitudeMax: perAptitude(30),
      aptitudeBonus: perAptitude(0),
      durability: int(30, { min: 0 }),
      speedMod: int(0),
      initMod: int(0),
      armor: new SchemaField({ energy: int(0, { min: 0 }), kinetic: int(0, { min: 0 }) }),
      movement: text(),
      implants: text(),
      advantages: text(),
      disadvantages: text(),
      skillBonuses: new ArrayField(new SchemaField({ key: text(), value: int(0) })),
      cpCost: int(0, { min: 0 }),
      creditCost: text(),
      active: new BooleanField({ initial: false })
    };
  }

  get woundThreshold() {
    return Math.ceil(this.durability / 5);
  }
}

/* -------------------------------------------- */

export class TraitData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      traitType: choice(["positive", "negative"], "positive"),
      scope: choice(["ego", "morph", "both"], "ego"),
      level: int(1, { min: 0 }),
      cost: int(0, { min: 0 }),
      costText: text()
    };
  }
}

/* -------------------------------------------- */

export class WeaponData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      weaponType: choice(["melee", "ranged"], "melee"),
      skill: text("unarmedCombat"),
      ap: int(0),
      dv: text("1d10"),
      damageType: choice(["kinetic", "energy", "none"], "kinetic"),
      addDB: new BooleanField({ initial: false }),
      modes: text(),
      // Launchers: loaded is the id of the embedded munition item they are loaded with, size its size
      ammo: new SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }), loaded: text(), size: text() }),
      range: text(),
      equipped: new BooleanField({ initial: false }),
      // Shock weapons call for a DUR + Energy armor test (Core p. 204)
      shock: new BooleanField({ initial: false }),
      area: new SchemaField({
        shape: choice(["none", "blast", "uniform", "cone"], "none"),
        radius: int(0, { min: 0 })
      }),
      twoHanded: new BooleanField({ initial: false }),
      cost: text(),
      quantity: int(1, { min: 0 }),
      // Grenades and seeker missiles (Core p. 341)
      munition: new SchemaField({
        kind: choice(["none", "grenade", "seeker"], "none"),
        size: choice(["micro", "mini", "standard"], "standard")
      }),
      // Munition sizes a launcher fires ("micro, mini")
      launcher: text()
    };
  }
}

/* -------------------------------------------- */

export class ArmorData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      energy: int(0),
      kinetic: int(0),
      equipped: new BooleanField({ initial: false }),
      // Accessories (helmets, shields...) add to worn armor without the layering penalty (Core p. 194)
      accessory: new BooleanField({ initial: false }),
      cost: text()
    };
  }
}

/* -------------------------------------------- */

export class GearData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      quantity: int(1, { min: 0 }),
      cost: text()
    };
  }
}

/* -------------------------------------------- */

export class AugmentationData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      augType: choice(["bioware", "cyberware", "nanoware", "meshware", "other"], "bioware"),
      cost: text()
    };
  }
}

/* -------------------------------------------- */

export class SleightData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      psiType: choice(["chi", "gamma", "epsilon"], "chi"),
      action: choice(["automatic", "quick", "complex", "task"], "automatic"),
      range: text(),
      duration: text(),
      strainMod: text(),
      skill: text()
    };
  }
}
