# Eclipse Phase (1re édition) pour Foundry VTT

Système non officiel pour jouer à **Eclipse Phase, 1re édition** sur Foundry VTT **v13 et v14**, y compris sur The Forge.

## Installation

### The Forge / Foundry (par manifeste)
1. Publiez une release GitHub taguée `v0.1.0` (le workflow `.github/workflows/release.yml` construit et joint `system.json` et `ep1e.zip`).
2. Sur The Forge : **My Foundry → Game Systems → Install System**, et collez l'URL du manifeste :
   `https://github.com/Chronos8001/Eclipse_Phase_Foundry/releases/latest/download/system.json`
   (sur un Foundry auto-hébergé : **Systèmes de jeu → Installer un système → URL du manifeste**).

### Développement local
```bash
npm install
npm run build        # vérifications + compilation des compendiums
node tools/test-rules.mjs
```
Copiez ou liez le dossier dans `Data/systems/ep1e` (le dossier doit s'appeler `ep1e`).

## Fonctionnalités

- **Égo et morphe séparés** : les aptitudes de base appartiennent à l'égo, le morphe actif fournit DUR, armure, bonus d'aptitudes, maximums d'aptitude, vitesse et bonus de compétences. On change de morphe en un clic.
- **Statistiques calculées** (p. 121-124) : LUC, ST, SF, SB, SM, INIT, VIT, BD, armure énergie/cinétique, malus de blessures et traumatismes (−10 chacun, filtre de douleur des synthomorphes inclus).
- **Compétences** : liste complète du livre de base (p. 176), créée automatiquement sur les nouveaux personnages ; domaines, spécialisations (+10), compétences sans défaut.
- **Tests d100** (00–99) : difficulté, modificateurs, multiplicateur d'aptitude (SOM × 3...), critiques sur les doubles, 00 et 99, marge de réussite/échec, succès excellents et échecs graves.
- **Moxie** : ignorer les modificateurs avant le jet, puis inverser le jet, passer en critique ou ignorer un échec critique depuis le chat (1 point par jet).
- **Combat** (p. 191-207) :
  - dialogue d'attaque : mode de tir (CpC, SA, rafale, automatique, suppression), tir concentré, portée mesurée sur la carte, modificateurs de la table p. 193, cibles et armes supplémentaires ;
  - munitions consommées selon le mode, rechargement, lanceurs chargés en grenades ou missiles (micro, mini, standard), grenades décomptées ;
  - test opposé : les cibles se défendent depuis la carte d'attaque (Esquive ÷ 2 à distance, parade en mêlée, défense totale), ou sont déclarées sans défense ;
  - dégâts appliqués aux cibles touchées : PA, armure, blessures, critique qui ignore l'armure, explosions selon la distance à l'épicentre (HEAP −4/m), dispersion des tirs ratés ;
  - choc (test DUR + armure É automatique, neutralisation puis malus dégressif), renversement, inconscience, saignement, feu, chute.
- **Statuts** de jeton : sonné (−30), défense totale (+30), au sol, inconscient, neutralisé, saignement, en feu, maîtrisé, aveuglé, mort ; leurs durées avancent à chaque tour de combat. Les couches d'armure donnent −20 par couche après la première.
- **Psi** (p. 220-228) : sleights actifs et passifs, test opposé à VOL × 2 (+30 pour les pods, Bouclier psi, traits Psi Defense/Vulnerability, défense psi totale), portée Proche, tension par cible (aucune pour les exsurgents), pouvoirs temporaires (VOL ÷ 5) et maintenus (−10), Pénétration, Psychic Stab et Onslaught, crise sur échec critique ; trait Psi : niveau requis et Seuil de traumatisme −1.
- **Mesh et piratage** (p. 246-262) : onglet Mesh avec les intrusions en cours ; piratage (pare-feu, privilèges, qualité de l'exploit et du pare-feu, en force, usurpation, cyberbrain −30) et test opposé au gardien → statut caché / discret / repéré / verrouillé et alertes ; subversion modifiée par le statut, avec dégradation sur échec grave ou critique ; scorchers contre l'ego d'un cyberbrain piraté ; création d'acteurs IA et muses à partir des logiciels.
- **Équipement** (p. 294-342) : augmentations avec leurs bonus en effets actifs (aptitudes, armure, vitesse, initiative, blessures ignorées, compétences via `system.skillMods`) ; drogues et toxines (prise d'une dose, effets pour la durée, test d'addiction VOL × 3) ; munitions cinétiques (modificateurs de PA et VD, demi-dégâts, armure doublée, choc) choisies au rechargement.
- **Robots et véhicules** : fiche dédiée (maniabilité, vitesse, armure, DUR, SB, SM = DUR × 2), test de Pilotage, dégâts et blessures comme un synthomorphe, test pour éviter l'accident dès 2 blessures.
- **Créatures et menaces** : PNJ prêts à l'emploi avec leur corps (morphe intégré), leurs compétences et leurs attaques ; une attaque de créature utilise son propre score (champ « Score d'attaque » de l'arme) au lieu d'une compétence. Les PNJ nommés des suppléments et des scénarios endossent le vrai morphe du compendium (aptitudes de l'ego et rangs déduits des valeurs imprimées), avec leurs traits, sleights, logiciels, armes et armures.
- **Stress** et traumatismes, appliqués de la même façon.
- **Initiative** : d100 + INIT, réduite par les blessures.
- **Effets actifs** sur acteurs et objets (implants, traits...).
- **Compendiums** : les 130 morphes du *Morph Recognition Guide* (variantes, modules flexbot et eidolons inclus), les traits, armes et armures du livre de base, les 65 sleights du livre de base, de *Transhuman* et de *X-Risks*, tout l'équipement du livre de base (107 augmentations, 129 objets dont 19 munitions, 44 drogues et toxines, 20 logiciels) et 213 objets nouveaux de *Transhuman*, *Sunward*, *Rimward*, *Gatecrashing*, *Panopticon* et *Firewall* (un dossier par livre), dont 8 serveurs pour infomorphes de *Transhuman* (leurs bonus sont un effet à activer quand l'infomorphe y tourne) ; 75 robots et véhicules du livre de base et des suppléments ; 103 créatures et menaces de *X-Risks* (Threat Recognition Guide et Critter Catalog) ; 38 PNJ et créatures du livre de base, de *Gatecrashing*, *Sunward*, *Firewall*, *Zone Stalkers* et des scénarios *The Devotees*, *Ego Hunter*, *Glory* et *The Stars Our Destination* (un dossier par livre ; ceux que *X-Risks* reprend n'y figurent qu'une fois).
- Interface en **français** et **anglais**.

## Structure

| Dossier | Contenu |
|---|---|
| `module/` | Code (modèles de données, documents, fiches, jets) |
| `templates/` | Templates Handlebars |
| `packs/_source/` | Sources JSON des compendiums |
| `tools/` | Compilation des packs, vérifications, extraction depuis les PDF |

Les sources des compendiums ont été extraites des livres avec `tools/parse_mrg.py` (morphes), `tools/parse_core.py` (traits), `tools/parse_core_gear.py` (armes, armures) `tools/parse_sleights.py` (sleights), `tools/parse_core_software.py` (logiciels), `tools/parse_core_equipment.py` (augmentations, équipement, substances) `tools/parse_supplement_gear.py` (équipement des suppléments), `tools/parse_core_vehicles.py` et `tools/parse_supplement_vehicles.py` (robots et véhicules) `tools/parse_threats.py` (créatures et menaces de *X-Risks*) et `tools/parse_npcs.py` (PNJ et créatures des autres livres). Les tableaux illisibles par `pdftotext` (substances, munitions, véhicules) sont transcrits dans `tools/data/` et vérifiés cellule par cellule contre le texte du tableau. Les scripts d'extraction nécessitent vos PDF et `pdftotext`.

## Licence

Code sous licence MIT. Le contenu de jeu provient d'Eclipse Phase (Posthuman Studios), publié sous licence [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). Projet non officiel et non commercial.
