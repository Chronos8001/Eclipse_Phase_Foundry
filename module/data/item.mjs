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
      // Rules read some traits by key (psi, psiDefense...), whatever their displayed name
      key: text(),
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
        radius: int(0, { min: 0 }),
        // DV lost per meter from the epicenter (p. 193); HEAP loses 4
        falloff: int(2, { min: 0 })
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
      key: text(),
      category: choice(["other", "armorMod", "comms", "surveillance", "espionage", "everyday", "nanotech", "pet",
        "scavenger", "service", "survival", "ammo", "weaponAccessory"], "other"),
      quantity: int(1, { min: 0 }),
      cost: text(),
      // Kinetic ammunition (Core p. 337): modifiers to the weapon's AP and DV
      ammo: new SchemaField({
        ap: int(0),
        dv: text(),
        half: new BooleanField({ initial: false }),
        noDamage: new BooleanField({ initial: false }),
        armorDoubled: new BooleanField({ initial: false }),
        shock: new BooleanField({ initial: false })
      })
    };
  }
}

/* -------------------------------------------- */

export class AugmentationData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      key: text(),
      // standard: included in most morphs; cosmetic: body mods; robotic: synthmorph and bot enhancements (Core pp. 300-312)
      augType: choice(["standard", "bioware", "cyberware", "nanoware", "meshware", "cosmetic", "robotic", "other"], "bioware"),
      cost: text()
    };
  }
}

/* -------------------------------------------- */

export class SleightData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      key: text(),
      psiType: choice(["chi", "gamma", "epsilon"], "chi"),
      // Active sleights are used (and cause strain); passive ones are always on (Core p. 221)
      activation: choice(["active", "passive"], "passive"),
      action: choice(["automatic", "quick", "complex", "task"], "automatic"),
      range: choice(["self", "touch", "close"], "self"),
      duration: choice(["constant", "instant", "temporary", "sustained"], "constant"),
      durationUnit: choice(["turns", "minutes", "hours"], "turns"),
      strainMod: int(0),
      // Mindlink: +N strain per target after the first; Penetration: 1 strain per point of AP
      strainPerTarget: int(0, { min: 0 }),
      strainPerAP: new BooleanField({ initial: false }),
      skill: text(),
      // Psi attack harm (roll data, e.g. 1d10 + ceil(@wil / 10)), as physical damage or mental stress
      damage: text(),
      harm: choice(["damage", "stress"], "damage"),
      exsurgent: new BooleanField({ initial: false }),
      // A temporary or sustained sleight in use, and the Action Turns left for a temporary one
      active: new BooleanField({ initial: false }),
      remaining: int(0, { min: 0 })
    };
  }

  /** Version 0.1 stored range, duration and strain modifier as free text. */
  static migrateData(source) {
    if ( typeof source.strainMod === "string" ) {
      source.strainMod = Number(source.strainMod.replace(/[–−]/g, "-").match(/[+-]?\s*\d+/)?.[0].replace(/\s/g, "") ?? 0);
    }
    if ( (typeof source.range === "string") && !["self", "touch", "close"].includes(source.range) ) {
      source.range = source.range.toLowerCase().match(/self|touch|close/)?.[0] ?? "self";
    }
    if ( (typeof source.duration === "string") && !["constant", "instant", "temporary", "sustained"].includes(source.duration) ) {
      const text = source.duration.toLowerCase();
      source.duration = text.match(/constant|instant|sustained/)?.[0] ?? (text.startsWith("temp") ? "temporary" : "constant");
      if ( source.duration === "temporary" ) source.durationUnit = text.includes("hour") ? "hours" : (text.includes("minute") ? "minutes" : "turns");
    }
    return super.migrateData(source);
  }

  /** Sleights in use count down; constant and passive ones are always on. */
  get isActive() {
    return (this.activation === "passive") || (this.duration === "constant") || this.active;
  }
}

/* -------------------------------------------- */

/** Programs, AIs, scorchers and skillsofts (Core pp. 331-332). */
export class SoftwareData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Rules find programs by key (exploit, spoof, firewall...), whatever their displayed name
      key: text(),
      category: choice(["program", "ai", "scorcher", "skillsoft"], "program"),
      // Mesh gear quality (p. 247): -30 to +30, applied to tests made with the program
      quality: int(0, { min: -30, max: 30 }),
      cost: text(),
      // Scorchers: harm on a successful attack, or a special effect resolved by a WIL x 2 Test
      damage: text(),
      harm: choice(["none", "damage", "stress"], "none"),
      effect: choice(["", "nightmare", "shutter", "spasm"], ""),
      // AIs: aptitudes and skills of the program, used to create the AI actor
      aptitudes: new SchemaField(Object.fromEntries(APTITUDES.map(k => [k, int(10, { min: 0 })]))),
      skills: new ArrayField(new SchemaField({
        key: text(), name: text(), field: text(), value: int(0, { min: 0 }), specialization: text()
      }))
    };
  }
}

/* -------------------------------------------- */

/** Drugs, chemicals, toxins, pathogens and narcoalgorithms (Core pp. 317-325). */
export class SubstanceData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      key: text(),
      category: choice(["drug", "nanodrug", "narcoalgorithm", "chemical", "toxin", "nanotoxin", "pathogen", "psi"], "drug"),
      substanceType: choice(["", "chem", "bio", "nano", "electronic"], ""),
      // Application methods (D dermal, Inh, Inj, O oral), onset and duration as printed
      application: text(),
      onset: text(),
      duration: text(),
      addictionMod: text(),
      addictionType: choice(["", "mental", "physical", "both"], ""),
      cost: text(),
      quantity: int(1, { min: 0 })
    };
  }
}
