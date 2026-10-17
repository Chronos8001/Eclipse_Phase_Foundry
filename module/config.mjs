/**
 * Static configuration for the Eclipse Phase 1st Edition system.
 * Exposed as CONFIG.EP1E.
 */
export const SYSTEM_ID = "ep1e";

export const APTITUDES = ["cog", "coo", "int", "ref", "sav", "som", "wil"];

export const REP_NETWORKS = ["at", "c", "e", "f", "g", "i", "r"];
/** The Networking field that taps each reputation network (Reputation Networks table, Core p. 287). */
export const REP_NETWORKING = {
  at: "Autonomists", c: "Hypercorps", e: "Ecologists", f: "Media", g: "Criminals", i: "Firewall", r: "Scientists"
};

/**
 * Learned skills from the Complete Skill List (Core p. 176).
 * field: the skill requires a field (Hardware: X, Networking: Y...)
 * noDefault: the skill may not be defaulted to its linked aptitude
 * starter: created automatically on new characters
 */
export const SKILLS = {
  animalHandling: { aptitude: "sav", category: "active", starter: true },
  beamWeapons: { aptitude: "coo", category: "active", starter: true, combat: true },
  blades: { aptitude: "som", category: "active", starter: true, combat: true },
  climbing: { aptitude: "som", category: "active", starter: true },
  clubs: { aptitude: "som", category: "active", starter: true, combat: true },
  control: { aptitude: "wil", category: "active", noDefault: true, psi: true },
  deception: { aptitude: "sav", category: "active", starter: true },
  demolitions: { aptitude: "cog", category: "active", noDefault: true, starter: true },
  disguise: { aptitude: "int", category: "active", starter: true },
  exoticMelee: { aptitude: "som", category: "active", field: true, combat: true },
  exoticRanged: { aptitude: "coo", category: "active", field: true, combat: true },
  flight: { aptitude: "som", category: "active", starter: true },
  fray: { aptitude: "ref", category: "active", starter: true, combat: true },
  freeFall: { aptitude: "ref", category: "active", starter: true },
  freerunning: { aptitude: "som", category: "active", starter: true },
  gunnery: { aptitude: "int", category: "active", starter: true, combat: true },
  hardware: { aptitude: "cog", category: "active", field: true, starter: true },
  impersonation: { aptitude: "sav", category: "active", starter: true },
  infiltration: { aptitude: "coo", category: "active", starter: true },
  infosec: { aptitude: "cog", category: "active", noDefault: true, starter: true },
  interfacing: { aptitude: "cog", category: "active", starter: true },
  intimidation: { aptitude: "sav", category: "active", starter: true },
  investigation: { aptitude: "int", category: "active", starter: true },
  kinesics: { aptitude: "sav", category: "active", starter: true },
  kineticWeapons: { aptitude: "coo", category: "active", starter: true, combat: true },
  medicine: { aptitude: "cog", category: "active", field: true, starter: true },
  navigation: { aptitude: "int", category: "active", starter: true },
  networking: { aptitude: "sav", category: "active", field: true, starter: true },
  palming: { aptitude: "coo", category: "active", starter: true },
  perception: { aptitude: "int", category: "active", starter: true },
  persuasion: { aptitude: "sav", category: "active", starter: true },
  pilot: { aptitude: "ref", category: "active", field: true, starter: true },
  programming: { aptitude: "cog", category: "active", noDefault: true, starter: true },
  protocol: { aptitude: "sav", category: "active", starter: true },
  psiAssault: { aptitude: "wil", category: "active", noDefault: true, psi: true, combat: true },
  psychosurgery: { aptitude: "int", category: "active", starter: true },
  research: { aptitude: "cog", category: "active", starter: true },
  scrounging: { aptitude: "int", category: "active", starter: true },
  seekerWeapons: { aptitude: "coo", category: "active", starter: true, combat: true },
  sense: { aptitude: "int", category: "active", noDefault: true, psi: true },
  sprayWeapons: { aptitude: "coo", category: "active", starter: true, combat: true },
  swimming: { aptitude: "som", category: "active", starter: true },
  throwingWeapons: { aptitude: "coo", category: "active", starter: true, combat: true },
  unarmedCombat: { aptitude: "som", category: "active", starter: true, combat: true },
  academics: { aptitude: "cog", category: "knowledge", field: true },
  art: { aptitude: "int", category: "knowledge", field: true },
  interest: { aptitude: "cog", category: "knowledge", field: true },
  language: { aptitude: "int", category: "knowledge", field: true, starter: true },
  profession: { aptitude: "cog", category: "knowledge", field: true }
};

/** Test difficulty modifiers (Core p. 115). */
export const DIFFICULTIES = [
  { value: 30, label: "EP1E.Difficulty.effortless" },
  { value: 20, label: "EP1E.Difficulty.simple" },
  { value: 10, label: "EP1E.Difficulty.easy" },
  { value: 0, label: "EP1E.Difficulty.average" },
  { value: -10, label: "EP1E.Difficulty.difficult" },
  { value: -20, label: "EP1E.Difficulty.challenging" },
  { value: -30, label: "EP1E.Difficulty.hard" }
];

export const EP1E = {
  aptitudes: Object.fromEntries(APTITUDES.map(k => [k, `EP1E.Aptitude.${k}`])),
  aptitudeAbbr: Object.fromEntries(APTITUDES.map(k => [k, `EP1E.AptitudeAbbr.${k}`])),
  rep: Object.fromEntries(REP_NETWORKS.map(k => [k, `EP1E.Rep.${k}`])),
  skills: SKILLS,
  skillCategories: { active: "EP1E.SkillCategory.active", knowledge: "EP1E.SkillCategory.knowledge" },
  morphTypes: {
    biomorph: "EP1E.MorphType.biomorph",
    pod: "EP1E.MorphType.pod",
    synthmorph: "EP1E.MorphType.synthmorph",
    infomorph: "EP1E.MorphType.infomorph"
  },
  traitTypes: { positive: "EP1E.TraitType.positive", negative: "EP1E.TraitType.negative" },
  traitScopes: { ego: "EP1E.TraitScope.ego", morph: "EP1E.TraitScope.morph", both: "EP1E.TraitScope.both" },
  backgroundKinds: { background: "EP1E.Background.kind.background", faction: "EP1E.Background.kind.faction", package: "EP1E.Background.kind.package" },
  weaponTypes: { melee: "EP1E.WeaponType.melee", ranged: "EP1E.WeaponType.ranged" },
  areaShapes: {
    none: "EP1E.AreaShape.none",
    blast: "EP1E.AreaShape.blast",
    uniform: "EP1E.AreaShape.uniform",
    cone: "EP1E.AreaShape.cone"
  },
  munitionKinds: { none: "EP1E.MunitionKind.none", grenade: "EP1E.MunitionKind.grenade", seeker: "EP1E.MunitionKind.seeker" },
  munitionSizes: { micro: "EP1E.MunitionSize.micro", mini: "EP1E.MunitionSize.mini", standard: "EP1E.MunitionSize.standard" },
  damageTypes: {
    kinetic: "EP1E.DamageType.kinetic",
    energy: "EP1E.DamageType.energy",
    none: "EP1E.DamageType.none"
  },
  // Psi attacks are resisted by mental armor (Psi Shield); not offered on weapons
  harmTypes: { damage: "EP1E.Sleight.harmDamage", stress: "EP1E.Sleight.harmStress" },
  softwareCategories: {
    program: "EP1E.Software.program",
    ai: "EP1E.Software.ai",
    scorcher: "EP1E.Software.scorcher",
    skillsoft: "EP1E.Software.skillsoft"
  },
  vehicleCategories: {
    robot: "EP1E.VehicleCategory.robot", aircraft: "EP1E.VehicleCategory.aircraft", groundcraft: "EP1E.VehicleCategory.groundcraft",
    personal: "EP1E.VehicleCategory.personal", watercraft: "EP1E.VehicleCategory.watercraft",
    spacecraft: "EP1E.VehicleCategory.spacecraft", other: "EP1E.VehicleCategory.other"
  },
  gearCategories: {
    other: "EP1E.GearCategory.other", armorMod: "EP1E.GearCategory.armorMod", comms: "EP1E.GearCategory.comms",
    surveillance: "EP1E.GearCategory.surveillance", espionage: "EP1E.GearCategory.espionage",
    everyday: "EP1E.GearCategory.everyday", nanotech: "EP1E.GearCategory.nanotech", pet: "EP1E.GearCategory.pet",
    scavenger: "EP1E.GearCategory.scavenger", service: "EP1E.GearCategory.service", survival: "EP1E.GearCategory.survival",
    ammo: "EP1E.GearCategory.ammo", weaponAccessory: "EP1E.GearCategory.weaponAccessory",
    server: "EP1E.GearCategory.server"
  },
  substanceCategories: {
    drug: "EP1E.Substance.drug", nanodrug: "EP1E.Substance.nanodrug", narcoalgorithm: "EP1E.Substance.narcoalgorithm",
    chemical: "EP1E.Substance.chemical", toxin: "EP1E.Substance.toxin", nanotoxin: "EP1E.Substance.nanotoxin",
    pathogen: "EP1E.Substance.pathogen", psi: "EP1E.Substance.psi"
  },
  substanceTypes: { "": "—", chem: "EP1E.Substance.chem", bio: "EP1E.Substance.bio", nano: "EP1E.Substance.nano", electronic: "EP1E.Substance.electronic" },
  addictionTypes: { "": "—", mental: "EP1E.Substance.mental", physical: "EP1E.Substance.physical", both: "EP1E.Substance.both" },
  softwareHarms: { none: "EP1E.Software.harmNone", damage: "EP1E.Sleight.harmDamage", stress: "EP1E.Sleight.harmStress" },
  scorchEffects: { "": "EP1E.Software.harmNone", nightmare: "EP1E.Mesh.nightmare", shutter: "EP1E.Mesh.shutter", spasm: "EP1E.Mesh.spasm" },
  augmentationTypes: {
    standard: "EP1E.AugType.standard",
    bioware: "EP1E.AugType.bioware",
    cyberware: "EP1E.AugType.cyberware",
    nanoware: "EP1E.AugType.nanoware",
    meshware: "EP1E.AugType.meshware",
    cosmetic: "EP1E.AugType.cosmetic",
    robotic: "EP1E.AugType.robotic",
    other: "EP1E.AugType.other"
  },
  psiTypes: { chi: "EP1E.PsiType.chi", gamma: "EP1E.PsiType.gamma", epsilon: "EP1E.PsiType.epsilon" },
  psiActivations: { active: "EP1E.Sleight.active", passive: "EP1E.Sleight.passive" },
  psiRanges: { self: "EP1E.PsiRange.self", touch: "EP1E.PsiRange.touch", close: "EP1E.PsiRange.close" },
  psiDurations: {
    constant: "EP1E.PsiDuration.constant",
    instant: "EP1E.PsiDuration.instant",
    temporary: "EP1E.PsiDuration.temporary",
    sustained: "EP1E.PsiDuration.sustained"
  },
  durationUnits: { turns: "EP1E.DurationUnit.turns", minutes: "EP1E.DurationUnit.minutes", hours: "EP1E.DurationUnit.hours" },
  psiSkills: { "": "EP1E.Sleight.noSkill", control: "EP1E.Skill.control", psiAssault: "EP1E.Skill.psiAssault", sense: "EP1E.Skill.sense" },
  psiCreatures: {
    sentient: "EP1E.PsiCreature.sentient",
    partial: "EP1E.PsiCreature.partial",
    animal: "EP1E.PsiCreature.animal",
    alien: "EP1E.PsiCreature.alien"
  },
  actionTypes: {
    automatic: "EP1E.Action.automatic",
    quick: "EP1E.Action.quick",
    complex: "EP1E.Action.complex",
    task: "EP1E.Action.task"
  },
  difficulties: DIFFICULTIES
};

/** Localized choices for skill keys, sorted by label. */
export function skillChoices({ blank = true } = {}) {
  const entries = Object.keys(SKILLS)
    .map(k => [k, game.i18n.localize(`EP1E.Skill.${k}`)])
    .sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang));
  const choices = Object.fromEntries(entries);
  return blank ? { "": game.i18n.localize("EP1E.Skill.custom"), ...choices } : choices;
}
