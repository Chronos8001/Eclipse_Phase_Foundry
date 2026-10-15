"""Generate weapon and armor pack sources from the EP1e core rulebook tables (pp. 311-312, 334-340, 193).

Values were transcribed by hand from the Gear chapter. Usage:
    python -I tools/gear_data.py packs/_source
"""
import hashlib, json, os, re, sys

OUT = sys.argv[1]
SRC = "<p><em>Source: Eclipse Phase Core Rulebook.</em></p>"

def make_id(name, salt):
    return hashlib.sha1(f"{salt}:{name}".encode()).hexdigest()[:16]

def write(pack, docs):
    d = os.path.join(OUT, pack)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(pack, len(docs))

def doc(pack, name, type_, img, system, sort):
    _id = make_id(name, pack)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": type_, "img": img, "system": system,
            "effects": [], "flags": {}, "folder": None, "sort": sort, "ownership": {"default": 0}}

# name, weaponType, skill, ap, dv, damageType, addDB, modes, ammo, range, notes
WEAPONS = [
    # Blades
    ("Diamond Ax", "melee", "blades", -3, "2d10 + 3", "kinetic", True, "", 0, "", ""),
    ("Flex Cutter", "melee", "blades", -1, "1d10 + 3", "kinetic", True, "", 0, "", ""),
    ("Knife", "melee", "blades", -1, "1d10 + 2", "kinetic", True, "", 0, "", "Peut être lancé (Throwing Weapons)."),
    ("Monofilament Sword", "melee", "blades", -4, "2d10 + 2", "kinetic", True, "", 0, "", ""),
    ("Vibroblade", "melee", "blades", -2, "2d10", "kinetic", True, "", 0, "", ""),
    ("Wasp Knife", "melee", "blades", -1, "1d10 + 2", "kinetic", True, "", 0, "", "Injection de gaz/drogue (voir p. 335)."),
    # Clubs
    ("Club", "melee", "clubs", 0, "1d10 + 2", "kinetic", True, "", 0, "", ""),
    ("Extendable Baton", "melee", "clubs", 0, "1d10 + 2", "kinetic", True, "", 0, "", ""),
    ("Shock Baton", "melee", "clubs", 0, "1d10 + 2", "kinetic", True, "", 0, "", "+ choc (p. 204)."),
    # Exotic melee
    ("Monowire Garrote", "melee", "exoticMelee", -8, "3d10", "kinetic", False, "", 0, "", ""),
    # Unarmed
    ("Unarmed", "melee", "unarmedCombat", 0, "1d10", "kinetic", True, "", 0, "", "Synthmorphs de taille humaine : +2 DV."),
    ("Bioware Claws", "melee", "unarmedCombat", -1, "1d10 + 1", "kinetic", True, "", 0, "", "Voir p. 304."),
    ("Cyberclaws", "melee", "unarmedCombat", -2, "1d10 + 3", "kinetic", True, "", 0, "", "Voir p. 307."),
    ("Densiplast Gloves", "melee", "unarmedCombat", 0, "1d10 + 2", "kinetic", True, "", 0, "", ""),
    ("Shock Gloves", "melee", "unarmedCombat", 0, "1d10", "kinetic", True, "", 0, "", "+ choc (p. 204)."),
    # Firearms
    ("Light Pistol (Firearm)", "ranged", "kineticWeapons", 0, "2d10", "kinetic", False, "SA, BF, FA", 10, "10 / 25 / 40 / 60", ""),
    ("Medium Pistol (Firearm)", "ranged", "kineticWeapons", -2, "2d10 + 2", "kinetic", False, "SA, BF, FA", 12, "10 / 30 / 50 / 70", ""),
    ("Heavy Pistol (Firearm)", "ranged", "kineticWeapons", -4, "2d10 + 4", "kinetic", False, "SA, BF, FA", 16, "10 / 35 / 60 / 80", ""),
    ("Submachine Gun (Firearm)", "ranged", "kineticWeapons", -2, "2d10 + 3", "kinetic", False, "SA, BF, FA", 20, "30 / 80 / 125 / 230", ""),
    ("Automatic Rifle (Firearm)", "ranged", "kineticWeapons", -6, "2d10 + 6", "kinetic", False, "SA, BF, FA", 30, "150 / 250 / 500 / 900", ""),
    ("Sniper Rifle (Firearm)", "ranged", "kineticWeapons", -12, "2d10 + 10", "kinetic", False, "SA", 40, "180 / 400 / 1100 / 2300", ""),
    ("Machine Gun (Firearm)", "ranged", "kineticWeapons", -6, "2d10 + 6", "kinetic", False, "BF, FA", 50, "100 / 400 / 1000 / 2000", ""),
    # Railguns
    ("Light Pistol (Railgun)", "ranged", "kineticWeapons", -3, "2d10 + 2", "kinetic", False, "SA, BF, FA", 10, "15 / 37 / 60 / 90", "Batterie : 200 tirs."),
    ("Medium Pistol (Railgun)", "ranged", "kineticWeapons", -5, "2d10 + 4", "kinetic", False, "SA, BF, FA", 12, "15 / 45 / 75 / 105", "Batterie : 200 tirs."),
    ("Heavy Pistol (Railgun)", "ranged", "kineticWeapons", -7, "2d10 + 6", "kinetic", False, "SA, BF, FA", 16, "15 / 52 / 90 / 120", "Batterie : 200 tirs."),
    ("Submachine Gun (Railgun)", "ranged", "kineticWeapons", -5, "2d10 + 5", "kinetic", False, "SA, BF, FA", 20, "45 / 120 / 187 / 345", "Batterie : 200 tirs."),
    ("Automatic Rifle (Railgun)", "ranged", "kineticWeapons", -9, "2d10 + 8", "kinetic", False, "SA, BF, FA", 30, "225 / 375 / 750 / 1350", "Batterie : 200 tirs."),
    ("Sniper Rifle (Railgun)", "ranged", "kineticWeapons", -15, "2d10 + 12", "kinetic", False, "SA", 40, "270 / 600 / 1650 / 3450", "Batterie : 200 tirs."),
    ("Machine Gun (Railgun)", "ranged", "kineticWeapons", -9, "2d10 + 8", "kinetic", False, "BF, FA", 50, "150 / 600 / 1500 / 3000", "Batterie : 200 tirs."),
    # Beam weapons
    ("Cybernetic Hand Laser", "ranged", "beamWeapons", 0, "2d10", "energy", False, "SA", 50, "30 / 80 / 125 / 230", "Voir p. 308."),
    ("Laser Pulser", "ranged", "beamWeapons", 0, "2d10", "energy", False, "SA", 100, "30 / 100 / 150 / 250", ""),
    ("Microwave Agonizer", "ranged", "beamWeapons", 0, "", "energy", False, "SA", 50, "5 / 15 / 30 / 50", "Mode douleur ou mode « roast » (AP -5, 2d10). Voir description p. 339."),
    ("Particle Beam Bolter", "ranged", "beamWeapons", -2, "2d10 + 4", "energy", False, "SA", 50, "30 / 100 / 150 / 300", ""),
    ("Plasma Rifle", "ranged", "beamWeapons", -8, "3d10 + 12", "energy", False, "SS", 10, "20 / 50 / 100 / 300", ""),
    ("Stunner", "ranged", "beamWeapons", 0, "ceil(1d10 / 2)", "energy", False, "SA", 200, "10 / 25 / 40 / 60", "+ choc (p. 204)."),
    # Spray weapons
    ("Shard Pistol", "ranged", "sprayWeapons", -10, "1d10 + 6", "kinetic", False, "SA, BF, FA", 100, "10 / 30 / 50 / 70", ""),
    ("Shredder", "ranged", "sprayWeapons", -10, "2d10 + 5", "kinetic", False, "SA, BF, FA", 100, "10 / 40 / 70 / 100", "Effet de cône (voir p. 340)."),
    ("Torch", "ranged", "sprayWeapons", -4, "3d10", "energy", False, "SS", 20, "5 / 15 / 30 / ‒", ""),
]

ARMOR = [
    ("Armor Clothing", 3, 4), ("Armor Vest", 6, 6), ("Body Armor (Light)", 10, 10), ("Body Armor (Heavy)", 13, 13),
    ("Crash Suit (Inactive)", 3, 4), ("Crash Suit (Active)", 4, 6), ("Hard Suit", 15, 15),
    ("Helmet (Light)", 2, 2), ("Helmet (Full)", 3, 3), ("Riot Shield", 3, 2), ("Second Skin", 1, 3),
    ("Smart Skin", 3, 2), ("Smart Vac Clothing", 2, 4), ("Spray Armor", 2, 2),
    ("Vacsuit (Light)", 5, 5), ("Vacsuit (Standard)", 7, 7),
    ("Synthmorph Industrial Armor", 10, 10), ("Synthmorph Combat Armor (Light)", 14, 12),
    ("Synthmorph Combat Armor (Heavy)", 16, 16),
    ("Battle Suit Powered Exoskeleton", 18, 18), ("Exowalker", 2, 4), ("Hyperdense Exoskeleton", 6, 12),
    ("Transporter Exoskeleton", 2, 4), ("Trike Exoskeleton", 2, 4),
]
ACCESSORIES = {"Helmet (Light)", "Helmet (Full)", "Riot Shield"}

weapons = []
for i, (name, wtype, skill, ap, dv, dtype, addDB, modes, ammo, rng, notes) in enumerate(WEAPONS):
    img = "icons/svg/sword.svg" if wtype == "melee" else "icons/svg/target.svg"
    weapons.append(doc("weapons", name, "weapon", img, {
        "weaponType": wtype, "skill": skill, "ap": ap, "dv": dv, "damageType": dtype, "addDB": addDB,
        "modes": modes, "ammo": {"value": ammo, "max": ammo}, "range": rng, "equipped": False,
        "description": (f"<p>{notes}</p>" if notes else "") + SRC,
    }, (i + 1) * 1000))
write("weapons", weapons)

armor = []
for i, (name, energy, kinetic) in enumerate(ARMOR):
    note = "<p>Accessoire : s'ajoute à l'armure portée (+E/+K).</p>" if name in ACCESSORIES else ""
    armor.append(doc("armor", name, "armor", "icons/svg/shield.svg", {
        "energy": energy, "kinetic": kinetic, "equipped": False, "description": note + SRC,
    }, (i + 1) * 1000))
write("armor", armor)
