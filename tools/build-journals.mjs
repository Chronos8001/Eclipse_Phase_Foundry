/**
 * Build the rules reference journals (in French) into packs/_source/rules-reference.
 *
 * Usage: node tools/build-journals.mjs
 *
 * The tables come from the rule modules (module/rules/*.mjs, checked by tools/test-rules.mjs) and their labels from
 * lang/fr.json, so that the journals give the same numbers and words as the sheet and the dialogs. Only the short
 * summaries are written here.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIFFICULTIES } from "../module/config.mjs";
import * as combat from "../module/rules/combat.mjs";
import * as mental from "../module/rules/mental.mjs";
import * as psi from "../module/rules/psi.mjs";
import * as mesh from "../module/rules/mesh.mjs";
import * as ego from "../module/rules/ego.mjs";
import * as adv from "../module/rules/advancement.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACK = "rules-reference";
const OUT = join(ROOT, "packs", "_source", PACK);
const FR = JSON.parse(readFileSync(join(ROOT, "lang", "fr.json"), "utf8"));

const missing = new Set();
/** Words the sheet does not show, used by the journals only. */
const LOCAL = {
  "EP1E.Mesh.privilege.public": "Public", "EP1E.Mesh.alert.none": "Aucune",
  "EP1E.Mesh.alert.passive": "Passive", "EP1E.Mesh.alert.active": "Active"
};
/** The French label of a key of lang/fr.json; the key itself (reported) when missing. */
function t(key) {
  const value = key.split(".").reduce((o, k) => o?.[k], FR) ?? LOCAL[key];
  if ( typeof value !== "string" ) {
    missing.add(key);
    return key.split(".").at(-1);
  }
  return value;
}

const id = (...parts) => createHash("sha1").update([PACK, ...parts].join(":")).digest("hex").slice(0, 16);
const signed = n => (n > 0 ? `+${n}` : (n < 0 ? `−${-n}` : "0"));
/** Dice formulas as printed in the books: "floor(1d10 / 2)" becomes "1d10 ÷ 2". */
const dice = f => String(f).replace(/floor\((.+?) \/ 2\)/g, "$1 ÷ 2").replace(/ceil\((.+?) \/ 2\)/g, "$1 ÷ 2 (arrondi supérieur)").replace(/^max\(0, (.+)\)$/, "$1 (min. 0)")
  .replace(/^0$/, "aucun");
/** Timeframes of the psychosurgery procedures and favors, as written in rules/*.mjs. */
const TIMEFRAMES = {
  "1 week": "1 semaine", "1 week (2 adding)": "1 semaine (2 pour ajouter)", "per day": "par jour", variable: "variable",
  "skill learning time ÷ 2": "temps d'apprentissage ÷ 2", "1 week per +10": "1 semaine par +10", "1 day per -10": "1 jour par −10",
  "1 day": "1 jour", "1 minute": "1 minute", "30 minutes": "30 minutes", "1 hour": "1 heure", "3 days": "3 jours"
};
const timeframe = text => TIMEFRAMES[text] ?? (missing.add(`timeframe: ${text}`), text);
const hours = h => (h === Infinity ? "plus" : (h < 24 ? `${h} h` : `${h / 24} j`));
const days = s => (s < 86400 ? `${s / 3600} h` : `${s / 86400} j`);

const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
  rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const list = items => `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
const h2 = text => `<h2>${text}</h2>`;
const p = text => `<p>${text}</p>`;
const source = text => `<p><em>Source : ${text}.</em></p>`;

/* -------------------------------------------- */

const ENTRIES = [
  {
    name: "1. Tests",
    content: [
      p("On lance 1d100 (00 à 99) contre un score cible : la compétence (ou l'aptitude par défaut) avec ses modificateurs. Un jet inférieur ou égal à la cible réussit. 00 réussit toujours, 99 échoue toujours."),
      list([
        "<strong>Critique</strong> : un double (00, 11, 22…) ; succès critique s'il réussit, échec critique sinon.",
        "<strong>Marge de réussite (MR)</strong> : cible − jet ; <strong>marge d'échec (ME)</strong> : jet − cible.",
        "<strong>Réussite excellente</strong> : MR ≥ 30 ; <strong>échec grave</strong> : ME ≥ 30.",
        "Les modificateurs cumulés ne dépassent pas ±60.",
        "<strong>Par défaut</strong> : sans la compétence, on teste l'aptitude liée.",
        "<strong>Travail d'équipe</strong> : +10 par aide, +30 au plus.",
        "<strong>Nouvel essai</strong> : −10 cumulatif par essai après un échec, −60 au plus.",
        "<strong>Prendre son temps</strong> : +10 par minute en plus (pour une tâche, par tranche de 50 % de sa durée). <strong>Se presser</strong> : −10 par tranche de 10 % gagnée, 60 % au plus.",
        "<strong>Tâches</strong> : la MR réduit la durée de 10 % par 10 points ; un échec fait perdre 10 % de la durée par 10 points de ME.",
        "<strong>Tests opposés</strong> : les deux réussissent, le jet le plus haut l'emporte ; égalité : impasse."
      ]),
      h2("Difficulté"),
      table(["Difficulté", "Modificateur"], DIFFICULTIES.map(d => [t(d.label), signed(d.value)])),
      h2("Moxie"),
      p("Un point par jet, au plus :"),
      list([t("EP1E.Moxie.ignoreModsHint"), t("EP1E.Moxie.flipHint"), t("EP1E.Moxie.critHint"), t("EP1E.Moxie.ignoreCritHint"),
        "Agir en premier dans une phase d'action."]),
      source("Eclipse Phase Core Rulebook, p. 115-122")
    ]
  },
  {
    name: "2. Combat",
    content: [
      p("Attaque : test de la compétence de l'arme, opposé à la Défense (Fray) de la cible, divisée par deux contre les armes à distance. L'attaque touche si elle réussit et bat la défense ; une impasse rate. Défense totale : " +
        `${signed(combat.FULL_DEFENSE_BONUS)}. Réussite excellente : +5 aux dommages (MR ≥ 30), +10 (MR ≥ 60).`),
      h2("Modes de tir"),
      table(["Mode", "Munitions", "Attaques par action complexe", "Tir concentré"],
        Object.entries(combat.FIRING_MODES).map(([k, m]) => [t(`EP1E.FiringMode.${k}`) + ` (${k})`, m.ammo, m.attacks, m.concentrated ? `+${m.concentrated}` : "—"])),
      h2("Portée"),
      table(["Portée", "Modificateur"], Object.entries(combat.RANGE_MODIFIERS).map(([k, v]) => [t(`EP1E.Range.${k}`), signed(v)])),
      p(`Bout portant : ${combat.POINT_BLANK} m ou moins.`),
      h2("Modificateurs de combat"),
      ...["general", "melee", "ranged"].map(g => table([{ general: "Général", melee: "Mêlée", ranged: "Distance" }[g], ""],
        Object.entries(combat.COMBAT_MODIFIERS[g]).map(([k, v]) => [t(`EP1E.CombatMod.${k}`), signed(v)]))),
      list([
        `Cible supplémentaire avec la même action : ${signed(combat.MULTIPLE_TARGET_PENALTY)} par cible.`,
        `Chaque couche d'armure au-delà de la première : ${signed(combat.LAYERED_ARMOR_PENALTY)}.`,
        `Arme à choc : test de DUR + armure énergétique ; ${signed(combat.SHOCK_MODIFIER)} qui diminue de 10 par tour.`,
        "Chute : 1d10 à 1-2 m, 2d10 à 3-5 m, 3d10 à 6-8 m, +1 par mètre au-delà ; l'armure cinétique compte pour moitié.",
        "Feu : 1d10 ÷ 2, puis 1d10, 2d10, 3d10, puis +5 tous les 5 tours."
      ]),
      source("Eclipse Phase Core Rulebook, p. 189-207")
    ]
  },
  {
    name: "3. Dommages et soins",
    content: [
      list([
        "Seuil de blessure (SB) = DUR ÷ 5 ; seuil de mort = DUR × 1,5 (biomorphes), × 2 (synthomorphes).",
        "L'armure (énergie ou cinétique) réduit les dommages ; la pénétration d'armure la réduit.",
        "Une blessure par tranche complète de SB dans un même coup ; chaque blessure donne −10 à tous les tests.",
        "Dommages ≥ DUR : hors de combat ; dommages ≥ seuil de mort : mort.",
        "Un biomorphe blessé dont les dommages dépassent la DUR saigne : 1 point par tour."
      ]),
      h2("Guérison naturelle"),
      table(["Soins", "1d10 dommages", "1 blessure"], Object.entries(mental.HEALING).map(([k, v]) =>
        [t(`EP1E.Mental.care.${k}`).replace(/ \(.*$/, ""), `${v.damage} h`, days(v.wound * 3600)])),
      p("Conditions mauvaises : durées doublées ; difficiles : triplées, et les blessures ne guérissent pas. Les blessures ne guérissent qu'une fois les dommages soignés."),
      source("Eclipse Phase Core Rulebook, p. 207-208")
    ]
  },
  {
    name: "4. Stress et santé mentale",
    content: [
      list([
        "Lucidité (LUC) = VOL × 2 ; seuil de traumatisme (ST) = LUC ÷ 5 (arrondi supérieur) ; seuil de folie = LUC × 2.",
        "Test de stress : VOL × 3 ; réussi, aucun stress (règle optionnelle de X-Risks : la moitié).",
        "Un traumatisme par tranche complète de ST dans un même stress ; chaque traumatisme donne −10 à tous les tests.",
        "1er traumatisme : dérangement mineur ; 2e et 3e : aggravation (modéré, majeur) ou nouveau mineur ; 4e et suivants : le dérangement majeur devient un trouble.",
        `Un dérangement dure ${dice(mental.DERANGEMENT_HOURS)} heures, ou jusqu'à des soins psychiatriques.`,
        "Stress ≥ LUC : hors de contrôle ; stress ≥ seuil de folie : folie permanente.",
        `Endurcissement : ${mental.HARDENING_SUCCESSES} tests réussis contre une même source rendent insensible, à −1 Moxie (maximum).`
      ]),
      h2("Expériences stressantes"),
      table(["Situation", "Stress"], Object.entries(mental.STRESSFUL_EXPERIENCES).map(([k, v]) => [t(`EP1E.Mental.situation.${k}`), dice(v)])),
      h2("Guérison"),
      list([
        "Naturelle : chaque mois sans nouveau stress, un test de VOL × 3 soigne 1d10 de stress, ou 1 traumatisme une fois le stress soigné.",
        `Psychothérapie (test de Psychothérapie, −10 par trouble, ${signed(mental.THERAPY_PSYCHOSURGERY_BONUS)} après une psychochirurgie réussie) : 1 stress par ${mental.THERAPY_HOURS.stress} h, puis 1 traumatisme par ${mental.THERAPY_HOURS.trauma} h, puis 1 trouble par ${mental.THERAPY_HOURS.disorder} h.`
      ]),
      h2("Psychochirurgie"),
      p("Test de Psychochirurgie opposé à VOL × 3 du sujet s'il résiste. Le stress s'applique quel que soit le résultat : moitié sur une réussite excellente, aucun sur un critique, double sur un échec grave, plus un traumatisme sur un échec critique."),
      table(["Procédure", "Modificateur", "Stress", "Durée"], Object.entries(mental.PROCEDURES).map(([k, v]) => [
        t(`EP1E.Mental.procedure.${k}`),
        Object.entries(v.degrees).map(([d, m]) => (Object.keys(v.degrees).length > 1 ? `${t(`EP1E.Mental.degree.${d}`)} ${signed(m)}` : signed(m))).join(", "),
        v.sv ? dice(v.sv) : "aucun", timeframe(v.timeframe)])),
      table(["Condition", "Test", "Stress"], Object.entries(mental.SURGERY_MODIFIERS).map(([k, v]) =>
        [t(`EP1E.Mental.surgeryCondition.${k}`).replace(/ \(.*$/, ""), signed(v.test), v.double ? "× 2" : signed(v.sv)])),
      source("Eclipse Phase Core Rulebook, p. 209-215, 229-233")
    ]
  },
  {
    name: "5. Psi",
    content: [
      list([
        `Niveau du trait Psi requis : chi ${psi.REQUIRED_LEVEL.chi}, gamma ${psi.REQUIRED_LEVEL.gamma}, epsilon ${psi.REQUIRED_LEVEL.epsilon}.`,
        `Portée Proche : ${psi.CLOSE_RANGE} m (${psi.CLOSE_RANGE_VS_ASYNC} m contre un async), ${signed(psi.CLOSE_RANGE_PENALTY)} par mètre au-delà.`,
        "Seuls les cerveaux biologiques sont visés : pas les synthomorphes, robots ni infomorphes.",
        `Résister : test opposé de VOL × 2 ; ${signed(psi.POD_DEFENSE_BONUS)} pour les pods ; défense psi totale ${signed(psi.PSI_FULL_DEFENSE_BONUS)}.`,
        "Tension : 1d10 ÷ 2 (arrondi supérieur) + le modificateur du sleight, par cible.",
        "Durée temporaire : VOL ÷ 5 (arrondi supérieur) tours, minutes ou heures.",
        `Chaque sleight maintenu : −${psi.SUSTAINED_PENALTY} à tous les autres tests.`
      ]),
      table(["Cible", "Modificateur", "Tension en plus"], Object.entries(psi.CREATURES).map(([k, v]) =>
        [t(`EP1E.PsiCreature.${k}`), signed(v.modifier), signed(v.strain)])),
      source("Eclipse Phase Core Rulebook, p. 220-228")
    ]
  },
  {
    name: "6. Mesh et piratage",
    content: [
      list([
        "Intrusion : test d'Infosec contre le pare-feu, opposé au moniteur si le système est surveillé.",
        `Piratage en force : ${signed(mesh.BRUTE_FORCE_BONUS)}, 1 minute, toujours repéré (verrouillé).`,
        `Cyberbrain : ${signed(mesh.CYBERBRAIN_MODIFIER)} pour pirater et subvertir.`,
        `Intrus caché : ${signed(mesh.HIDDEN_BONUS)} pour subvertir le système.`,
        "Après un test sur le système : échec grave, le statut baisse d'un cran ; échec critique, verrouillé.",
        `Verrouillage : l'intrus verrouillé se défend à ${signed(mesh.LOCKOUT_MODIFIER)}.`,
        "Script : Programmation ÷ 10 étapes. Planter une IA : 2 tests opposés réussis de suite (3 pour une AGI ou un infomorphe)."
      ]),
      table(["Privilèges visés", "Modificateur"], Object.entries(mesh.PRIVILEGES).map(([k, v]) => [t(`EP1E.Mesh.privilege.${k}`), signed(v)])),
      table(["Statut", "Alerte", "Modificateur"], mesh.STATUSES.map(s =>
        [t(`EP1E.Mesh.status.${s}`), t(`EP1E.Mesh.alert.${mesh.ALERTS[s]}`), signed(mesh.ALERT_MODIFIERS[mesh.ALERTS[s]])])),
      p(`Qualité du matériel et des logiciels : de ${mesh.QUALITY[0]} (relique) à +${mesh.QUALITY.at(-1)} (dernier cri).`),
      source("Eclipse Phase Core Rulebook, p. 246-262")
    ]
  },
  {
    name: "7. Ego, forks et réputation",
    content: [
      h2("Resleeving"),
      list([
        "Intégration : SOM × 3 de l'ego (sans les bonus du morphe). Aliénation : INT × 3. Continuité : VOL × 3.",
        "Aliénation ratée : 1 stress par 10 points de ME (double sur un échec critique)."
      ]),
      table(["Test d'intégration", "Effet"], ["criticalSuccess", "success", "failure", "severeFailure", "criticalFailure"].map(outcome => {
        const fx = ego.integrationEffect({ outcome, margin: 0 });
        const duration = fx.days === null ? "jusqu'au prochain morphe" : (fx.days === 1 ? "1 jour" : `${fx.days} jours + 1 par 10 points de ME`);
        return [t(`EP1E.Outcome.${outcome}`).replace(/ !$/, ""), fx.moxie ? t("EP1E.Ego.integrationMoxie") : (fx.modifier
          ? `${signed(fx.modifier)} ${fx.physical ? "aux actions physiques" : "à toutes les actions"}, ${duration}` : t("EP1E.Ego.integrationNone"))];
      })),
      table(["Situation", "Modificateur"], ego.SLEEVING_MODIFIERS.map(m =>
        [t(`EP1E.Ego.modifier.${m.key}`) + (m.alienation ? " (aliénation seulement)" : ""), signed(m.value)])),
      table(["Continuité", "Stress"], Object.entries(ego.CONTINUITY_SITUATIONS).map(([k, v]) => [t(`EP1E.Ego.situation.${k}`).replace(/ \(.*$/, ""), dice(v)])),
      p(`Ne pas savoir ce qui s'est passé : +${ego.NOT_KNOWING_STRESS} stress. La MR du test de continuité retire 1 stress par 10 points, la ME en ajoute 1.`),
      h2("Forks"),
      table(["Fork", "Aptitudes", "LUC", "INIT", "Compétences actives", "Connaissances", "Moxie"], Object.entries(ego.FORKS).map(([k, f]) => [
        t(`EP1E.Ego.forkKind.${k}`), signed(f.aptitude), signed(f.luc), signed(f.init),
        f.activeMax ? `${f.activeCount ? `${f.activeCount} au plus, ` : ""}${f.activeMax} max.` : "toutes",
        f.knowledgeMax ? `${f.knowledgeCount} au plus, ${f.knowledgeMax} max.` : "toutes", f.moxie === null ? "inchangée" : f.moxie])),
      h2("Fusion"),
      table(["Séparés depuis", "Modificateur", "Réussite", "Échec"], ego.MERGING.map((r, i) => [
        i ? `${hours(ego.MERGING[i - 1].upTo)} ${r.upTo === Infinity ? "et plus" : `à ${hours(r.upTo)}`}` : `moins de ${hours(r.upTo)}`, signed(r.modifier),
        `${dice(r.success.sv)} stress, ${t(`EP1E.Ego.memory.${r.success.memory}`)}`, `${dice(r.failure.sv)} stress, ${t(`EP1E.Ego.memory.${r.failure.memory}`)}`])),
      h2("Réputation et faveurs"),
      p("Niveau de rep : 1 par tranche de 20 points (0-19 : niveau 1). Test de Networking du réseau : ±10 par niveau d'écart entre la rep et la faveur ; brûler de la rep donne +1 par point (+30 au plus)."),
      table(["Faveur", "Délai", "Rep brûlée si pas rechargée", "Recharge"], Object.entries(ego.FAVORS).map(([k, f]) =>
        [`Niveau ${k}`, timeframe(f.timeframe), f.burn, days(f.refresh)])),
      source("Eclipse Phase Core Rulebook, p. 268-289")
    ]
  },
  {
    name: "8. Création et progression",
    content: [
      list([
        `Gratuit : ${adv.FREE.aptitudes} points d'aptitude, ${adv.FREE.moxie} Moxie, ${adv.FREE.credit} crédits, ${adv.FREE.rep} points de rep.`,
        `${adv.DEFAULT_CP} points de création (le MJ peut en fixer de 700 à 1 200) ; 1 point de package vaut ${adv.CP_PER_PP} PC (Transhuman).`,
        `Aptitudes : ${adv.LIMITS.aptitudeMin} à ${adv.LIMITS.aptitudeMax} (avant le morphe) ; Moxie ${adv.LIMITS.moxieMax} au plus.`,
        `Compétences : 1 point par point jusqu'à ${adv.LIMITS.expert}, 2 au-delà ; ${adv.LIMITS.creationSkillMax} au plus à la création, ${adv.LIMITS.skillMax} ensuite.`,
        `Minimums : ${adv.LIMITS.activeMinimum} PC en compétences actives, ${adv.LIMITS.knowledgeMinimum} en connaissances.`,
        `Plafonds : ${adv.LIMITS.repCp} PC en rep (${adv.LIMITS.creationRepMax} par réseau), ${adv.LIMITS.creditCp} PC en crédits, ${adv.LIMITS.positiveTraits} PC de traits positifs, ${adv.LIMITS.negativeTraits} de traits négatifs (${adv.LIMITS.negativeMorphTraits} de traits de morphe), ${adv.LIMITS.sleightsPerType} sleights chi et ${adv.LIMITS.sleightsPerType} gamma.`
      ]),
      table(["Achat", "Coût (PC ou points de rez)"], [
        ["1 point de Moxie", adv.COST.moxie], ["1 point d'aptitude", adv.COST.aptitude],
        ["1 sleight", adv.COST.sleight], ["1 spécialisation", adv.COST.specialization],
        [`${adv.REP_PER_POINT} points de rep`, adv.COST.rep], [`${adv.CREDIT_PER_POINT} crédits`, adv.COST.credit]
      ]),
      p("Progression : les points de rez s'achètent aux mêmes tarifs ; une aptitude coûte en plus 1 point par compétence liée qui passe au-delà de 60."),
      source("Eclipse Phase Core Rulebook, p. 134-136, 152-153 ; Eclipse Phase Transhuman, p. 14")
    ]
  }
];

/* -------------------------------------------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
ENTRIES.forEach((e, n) => {
  const entryId = id(e.name);
  const pageId = id(e.name, "page");
  const doc = {
    _id: entryId, _key: `!journal!${entryId}`, name: e.name, folder: null, sort: (n + 1) * 1000,
    ownership: { default: 0 }, flags: {},
    pages: [{
      _id: pageId, _key: `!journal.pages!${entryId}.${pageId}`, name: e.name.replace(/^\d+\. /, ""), type: "text",
      title: { show: true, level: 1 }, text: { content: e.content.join(""), format: 1 }, sort: 100000,
      ownership: { default: -1 }, flags: {}, system: {}
    }]
  };
  const slug = e.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  writeFileSync(join(OUT, `${slug}.json`), `${JSON.stringify(doc, null, 2)}\n`);
});
console.log(`${PACK} ${readdirSync(OUT).length}`);
if ( missing.size ) {
  console.error(`Missing labels: ${[...missing].join(", ")}`);
  process.exitCode = 1;
}
