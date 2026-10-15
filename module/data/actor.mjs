import { APTITUDES, REP_NETWORKS, SKILLS } from "../config.mjs";

const { SchemaField, NumberField, StringField, HTMLField } = foundry.data.fields;

const int = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const text = () => new StringField({ required: true, blank: true, initial: "" });

/** Highest rating any aptitude may reach, augmented or not (Core p. 124). */
const APTITUDE_HARD_CAP = 40;
/** At most 3 wounds' worth of modifiers may be ignored (Core p. 207). */
const MAX_IGNORED_WOUNDS = 3;

/**
 * Data shared by player characters and NPCs.
 * Ego-side values are stored; morph-side values come from the active morph item.
 */
export class EgoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      aptitudes: new SchemaField(Object.fromEntries(APTITUDES.map(k => [k, new SchemaField({
        base: int(10, { min: 0 }),
        mod: int(0)
      })]))),
      moxie: new SchemaField({ value: int(1, { min: 0 }), max: int(1, { min: 0 }) }),
      damage: new SchemaField({ value: int(0, { min: 0 }) }),
      wounds: new SchemaField({ value: int(0, { min: 0 }) }),
      stress: new SchemaField({ value: int(0, { min: 0 }) }),
      trauma: new SchemaField({ value: int(0, { min: 0 }) }),
      mods: new SchemaField({
        dur: int(0), wt: int(0), luc: int(0), tt: int(0), init: int(0), spd: int(0), db: int(0),
        energyArmor: int(0), kineticArmor: int(0),
        woundsIgnored: int(0, { min: 0 }), traumasIgnored: int(0, { min: 0 })
      }),
      rep: new SchemaField(Object.fromEntries(REP_NETWORKS.map(k => [k, int(0, { min: 0 })]))),
      details: new SchemaField({
        background: text(),
        faction: text(),
        gender: text(),
        age: text(),
        motivations: text(),
        muse: text(),
        credits: int(0),
        rez: new SchemaField({ value: int(0, { min: 0 }), total: int(0, { min: 0 }) }),
        cp: int(0)
      }),
      biography: new HTMLField({ required: true, blank: true }),
      notes: new HTMLField({ required: true, blank: true })
    };
  }

  /** The currently sleeved morph item, if any. */
  get activeMorph() {
    return this.parent.items.find(i => (i.type === "morph") && i.system.active) ?? null;
  }

  prepareDerivedData() {
    const actor = this.parent;
    const morph = this.activeMorph;
    const m = morph?.system;
    const mods = this.mods;

    // Aptitudes: ego base limited by the morph's aptitude maximum, then augmented (Core p. 124)
    for ( const key of APTITUDES ) {
      const apt = this.aptitudes[key];
      apt.max = m ? m.aptitudeMax[key] : APTITUDE_HARD_CAP;
      apt.morph = m ? m.aptitudeBonus[key] : 0;
      apt.value = Math.clamp(Math.min(apt.base + apt.morph, apt.max) + apt.mod, 0, APTITUDE_HARD_CAP);
      apt.capped = (apt.base + apt.morph) > apt.max;
    }
    const a = key => this.aptitudes[key].value;

    // Morph statistics
    const isSynth = m?.morphType === "synthmorph";
    const isInfomorph = m?.morphType === "infomorph";
    const dur = Math.max(0, (m?.durability ?? 0) + mods.dur);
    const wt = Math.max(0, Math.ceil(dur / 5) + mods.wt);
    const dr = isSynth ? dur * 2 : Math.ceil(dur * 1.5);
    const luc = Math.max(0, (a("wil") * 2) + mods.luc);
    const tt = Math.max(0, Math.ceil(luc / 5) + mods.tt);
    const ir = luc * 2;
    const init = ((a("int") + a("ref")) * 2) + (m?.initMod ?? 0) + mods.init;
    const spd = Math.clamp(1 + (m?.speedMod ?? 0) + mods.spd, 1, 4);
    const db = Math.floor(a("som") / 10) + mods.db;
    this.stats = { dur, wt, dr, luc, tt, ir, init, spd, db, isSynth, isInfomorph };

    // Armor: morph armor plus all equipped armor items
    const armor = { energy: (m?.armor.energy ?? 0) + mods.energyArmor, kinetic: (m?.armor.kinetic ?? 0) + mods.kineticArmor };
    for ( const item of actor.items ) {
      if ( (item.type !== "armor") || !item.system.equipped ) continue;
      armor.energy += item.system.energy;
      armor.kinetic += item.system.kinetic;
    }
    this.armor = armor;

    // Health and mental health tracks (max values feed the token bars)
    this.damage.max = dur;
    this.stress.max = luc;
    const ignoredWounds = Math.min(MAX_IGNORED_WOUNDS, mods.woundsIgnored + (isSynth ? 1 : 0));
    const woundPenalty = Math.max(0, this.wounds.value - ignoredWounds) * 10;
    const traumaPenalty = Math.max(0, this.trauma.value - mods.traumasIgnored) * 10;
    this.penalty = { wounds: woundPenalty, trauma: traumaPenalty, total: woundPenalty + traumaPenalty };
    this.status = {
      incapacitated: (dur > 0) && (this.damage.value >= dur),
      dead: (dur > 0) && (this.damage.value >= dr),
      insane: (luc > 0) && (this.stress.value >= ir),
      unstable: (luc > 0) && (this.stress.value >= luc)
    };

    this.morph = morph ? { id: morph.id, name: morph.name, img: morph.img, type: m.morphType } : null;

    this.#prepareSkills(m);
  }

  /** Compute each skill's rating: linked aptitude + ranks + morph bonus (Core p. 123). */
  #prepareSkills(morphSystem) {
    const bonuses = {};
    for ( const b of morphSystem?.skillBonuses ?? [] ) {
      if ( b.key ) bonuses[b.key] = (bonuses[b.key] ?? 0) + b.value;
    }
    for ( const item of this.parent.items ) {
      if ( item.type !== "skill" ) continue;
      const s = item.system;
      s.aptitudeValue = this.aptitudes[s.aptitude]?.value ?? 0;
      s.morphBonus = bonuses[s.key] ?? 0;
      const cannotDefault = s.noDefault && (s.ranks <= 0);
      s.total = cannotDefault ? 0 : Math.max(0, s.aptitudeValue + s.ranks + s.morphBonus + s.mod);
      s.defaulting = s.ranks <= 0;
    }
  }

  /** Find the best skill item matching a configured skill key. */
  getSkill(key) {
    if ( !key ) return null;
    let best = null;
    for ( const item of this.parent.items ) {
      if ( (item.type !== "skill") || (item.system.key !== key) ) continue;
      if ( !best || (item.system.total > best.system.total) ) best = item;
    }
    return best;
  }

  /** Target number for a skill key, defaulting to the linked aptitude when the actor lacks it. */
  getSkillTarget(key) {
    const skill = this.getSkill(key);
    if ( skill ) return { target: skill.system.total, label: skill.system.label, skill };
    const cfg = SKILLS[key];
    if ( !cfg ) return { target: 0, label: "", skill: null };
    const label = game.i18n.localize(`EP1E.Skill.${key}`);
    return { target: cfg.noDefault ? 0 : this.aptitudes[cfg.aptitude].value, label, skill: null };
  }
}

export class CharacterData extends EgoData {}

export class NpcData extends EgoData {}
