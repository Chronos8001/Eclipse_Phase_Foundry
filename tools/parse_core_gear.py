"""Parse the weapon and armor tables of the EP1e Core Rulebook into Foundry pack sources.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_gear.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source

Tables are read with `pdftotext -table -enc UTF-8`, which keeps the columns aligned, and sliced at the
column of the table header (the gear pages print prose and a navigation sidebar on the same lines).
Descriptions come from the plain-text paragraphs ("Name: text. [Cost]").
Replaces the hand transcription of tools/gear_data.py.
"""
import hashlib, html, json, os, re, subprocess, sys

PDF, OUT = sys.argv[1], sys.argv[2]
OFFSET = 2  # PDF page - printed page
SOURCE = "Eclipse Phase Core Rulebook"

DASHES = {"—": None, "--": None}
TABLE_NAMES = set()  # row names of every table read, used to strip table cells from the prose
COSTS = r"(?:Trivial|Low|Moderate|High|Expensive)"


def pdf_text(page, table=True):
    args = ["pdftotext", "-enc", "UTF-8", "-f", str(page), "-l", str(page)]
    if table:
        args.append("-table")
    out = subprocess.run(args + [PDF, "-"], capture_output=True)
    return out.stdout.decode("utf-8", errors="replace")


def table(page, header, stop=None, sections=False):
    """Rows of the table whose header line matches `header`, as lists of cells.
    With `sections`, single-cell lines (category headings such as "Railguns") do not end the table."""
    lines = pdf_text(page).split("\n")
    for i, line in enumerate(lines):
        m = re.search(header, line)
        if m:
            break
    else:
        raise SystemExit(f"Table {header!r} not found on PDF page {page}")
    col = m.start()
    rows, blank = [], 0
    for line in lines[i + 1:]:
        seg = re.sub(r"(?:\s*1\.1)+\d*\s*$", "", line[col:]).rstrip()  # decorative tail
        if not seg.strip():
            blank += 1
            if rows and blank > 3:
                break
            continue
        blank = 0
        if stop and re.search(stop, seg):
            break
        cells = re.split(r"\s{2,}", seg.strip())
        if len(cells) < 2 or not cells[0][:1].isupper():
            if rows and not sections:
                break
            continue
        rows.append(cells)
        TABLE_NAMES.add(re.sub(r" \(p\. \d+\)", "", cells[0]))
    return rows


def num(cell):
    """AP and armor cells: '—' means 0, '–4' is a negative number (en dash), '+2' an accessory bonus."""
    cell = cell.strip()
    if cell in DASHES or not cell:
        return 0
    m = re.fullmatch(r"([–+-]?)(\d+)", cell)
    if not m:
        return None
    return -int(m.group(2)) if m.group(1) in "–-" and m.group(1) else int(m.group(2))


def dv_formula(cell):
    """'2d10 + 3 + (SOM ÷ 10)' -> ('2d10 + 3', addDB, shock). Non-numeric DVs (pain, nanoswarm...) -> ''."""
    shock = "shock" in cell
    add_db = "SOM" in cell
    f = re.sub(r"\s*\+\s*\(SOM\s*÷\s*10\)", "", cell)
    f = re.sub(r"\s*\+\s*shock \(p\. \d+\)", "", f).strip()
    m = re.fullmatch(r"\(?(\d+d10)\s*÷\s*2\)?", f)
    if m:
        f = f"ceil({m.group(1)} / 2)"
    if not re.fullmatch(r"(ceil\()?\d+d10( / 2\))?( [+–-] \d+)?", f):
        f = ""
    return f.replace("–", "-"), add_db, shock


def ranges_table():
    """Weapon Ranges table (p. 203): {name: 'max short / max medium / max long / max extreme'}."""
    page = 203 + OFFSET
    rows = table(page, r"Weapon \(Type\)", sections=True)
    out = {}
    for cells in rows:
        name, bands = cells[0], cells[1:]
        if not bands:
            continue
        if name.startswith("To SOM") or any("SOM" in b for b in bands):
            out[name] = " / ".join(b.replace("To ", "").replace(" x ", " × ") for b in bands[:4])
            continue
        maxes = []
        for b in bands:
            m = re.search(r"[–-]\s*([\d,]+)\s*$", b)
            if m:
                maxes.append(m.group(1).replace(",", ""))
        if maxes:
            out[name] = maxes
    # Cells overprinted by the page decoration (checked visually on the rendered page: all 31–50)
    for name in ("Sprayer", "Torch", "Vortex Ring Gun"):
        if name in out and len(out[name]) == 3:
            out[name].append("50")
    return {k: (v if isinstance(v, str) else " / ".join(v)) for k, v in out.items()}


# Running headers, navigation sidebar, page numbers and decorations printed on every page
SIDEBAR = r"(?:Synopsis|Welcome to Firewall|A Time of Eclipse|Game Mechanics|Character Creation|Skills|Action and Combat|" \
          r"Mind Hacks|The Mesh|Accelerated Future|Gear|gear|Running the Game|Reference)"
PAGE_FURNITURE = re.compile(rf"^(?:(?:1\.1)+\d*|\d{{1,3}}|{SIDEBAR}(?: {SIDEBAR})*)$")


# Table cells that the plain-text extraction interleaves with the prose
TABLE_LINE = re.compile(r"^(?:Armor Penetration|Damage Value|Average DV|Firing Modes|Ammo|AP|DV|Armor Used|as chemical|"
                        r"energy kinetic|Page|[a-z ]{0,30}(?:weapons|armor|seekers|exoskeletons)$|"
                        r"(?:[—–\d+ ,.()]|SA|BF|FA|SS|[EK]\b)+$)")


def descriptions(first, last):
    pages = (pdf_text(p, table=False) for p in range(first, last + 1))
    keep = []
    for page in pages:
        for l in page.split("\n"):
            s = l.strip()
            if PAGE_FURNITURE.match(s) or TABLE_LINE.match(s) or sum(n in s for n in TABLE_NAMES) >= 3:
                continue
            keep.append(l)
    text = "\n".join(keep)
    text = re.sub(r"-\n(?=[a-z])", "", text)
    return re.sub(r"\s+", " ", text)


def find_description(text, *names):
    for name in names:
        pat = re.escape(name) + r"(?: \([^)]*\))?: (.*?)\[(" + COSTS + r")[^\]]*\]"
        m = re.search(r"(?<![A-Za-z(-])" + pat, text)
        if m:
            return m.group(1).strip(), m.group(2)
    return "", ""


def make_id(pack, name):
    return hashlib.sha1(f"{pack}:{name}".encode()).hexdigest()[:16]


def doc(pack, name, type_, img, system, sort):
    _id = make_id(pack, name)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": type_, "img": img, "system": system,
            "effects": [], "flags": {}, "folder": None, "sort": sort, "ownership": {"default": 0}}


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


def describe(body, page, notes=""):
    parts = []
    if body:
        parts.append(f"<p>{html.escape(body, quote=False)}</p>")
    if notes:
        parts.append(f"<p>{notes}</p>")
    parts.append(f"<p><em>Source: {SOURCE}, p. {page}.</em></p>")
    return "".join(parts)


# ---------------------------------------------------------------- Weapons

WEAPON_TABLES = [
    # (printed page, header regex, skill, weapon type, name suffix, damage type)
    (335, r"^\s*Blades\s+Armor Penetration", "blades", "melee", "", "kinetic"),
    (335, r"clubs\s+Armor Penetration", "clubs", "melee", "", "kinetic"),
    (335, r"exotic melee weapons\s+Armor Penetration", "exoticMelee", "melee", "", "kinetic"),
    (335, r"Unarmed\s+Armor Penetration", "unarmedCombat", "melee", "", "kinetic"),
    (336, r"Firearms\s+Armor Penetration", "kineticWeapons", "ranged", " (Firearm)", "kinetic"),
    (336, r"railguns\s+Armor Penetration", "kineticWeapons", "ranged", " (Railgun)", "kinetic"),
    (339, r"beam weapons\s+Armor Penetration", "beamWeapons", "ranged", "", "energy"),
    (340, r"Spray Weapons\s+Armor Penetration", "sprayWeapons", "ranged", "", "kinetic"),
]
STOP = r"Armor Penetration|Firing Modes|^\s*[a-z]+ weapons\s*$"

# Description headings that differ from the table row names
DESC_ALIASES = {
    "Diamond Ax": ["Diamond Axe"], "Light Pistol": ["Pistols"], "Medium Pistol": ["Pistols"],
    "Heavy Pistol": ["Pistols"], "Submachine Gun": ["Submachine Guns"], "Automatic Rifle": ["Automatic Rifles"],
    "Laser Pulser": ["Laser Pulsers"], "Shard": ["Shard Pistol"], "Cybernetic Hand Laser": [],
    "HEAP": ["High-Explosive Armor-Piercing"],
}
# Range table names that differ from the weapon table names
RANGE_ALIASES = {"Submachine Gun": "SMG", "Automatic Rifle": "Assault Rifle", "Shard": "Shard Pistol"}
# Pack names kept from the previous transcription, so that existing links keep working
NAME_FIXES = {"Shard": "Shard Pistol"}
SPRAY_ENERGY = {"Torch"}
CONE = {"Shredder", "Shard"}
THROWABLE = {"Knife"}


def two_handed(desc):
    return bool(re.search(r"two-?\s?handed", desc, re.I))


def parse_weapons():
    ranges = ranges_table()
    tables = [(spec, table(spec[0] + OFFSET, spec[1], STOP)) for spec in WEAPON_TABLES]
    seekers = table(339 + OFFSET, r"Seeker Weapons\s+Firing Modes", STOP)
    munitions = table(341 + OFFSET, r"Grenade/Seeker Type\s+AP", STOP)
    text = descriptions(334 + OFFSET, 342 + OFFSET)
    docs, parent = [], None
    for (page, header, skill, wtype, suffix, dtype), rows in tables:
        for cells in rows:
            raw = cells[0]
            name = re.sub(r"\s*\(p\. \d+\)", "", raw)
            ref = re.search(r"\(p\. (\d+)\)", raw)
            sub_mode = name.endswith(" Mode")
            if wtype == "melee":
                ap, dv_cell = cells[1], cells[2]
                modes, ammo = "", 0
            else:
                ap, dv_cell = cells[1], cells[2]
                modes = cells[4] if len(cells) > 4 else ""
                ammo = num(cells[5]) if len(cells) > 5 else 0
            dv, add_db, shock = dv_formula(dv_cell)
            if sub_mode:
                full = f"{parent['base']} ({name})"
                ammo = ammo or parent["ammo"]
            else:
                full = NAME_FIXES.get(name, name) + suffix
                parent = {"base": name, "ammo": ammo or 0}
            base = parent["base"]
            body, cost = find_description(text, *(DESC_ALIASES.get(base, [base]) or [base]))
            if body == "" and ref:
                body = f"See p. {ref.group(1)}."
            rng = ranges.get(RANGE_ALIASES.get(base, base), "")
            if suffix == " (Railgun)" and rng:  # Railguns: +50% to every range category (p. 203)
                rng = " / ".join(str(int(int(x) * 1.5)) for x in rng.split(" / "))
            if base in THROWABLE:
                rng = ranges.get("Blades", "")
            system = {
                "weaponType": wtype, "skill": skill, "ap": num(ap) or 0, "dv": dv,
                "damageType": "energy" if (dtype == "energy" or base in SPRAY_ENERGY) else dtype,
                "addDB": add_db, "modes": modes, "ammo": {"value": ammo or 0, "max": ammo or 0},
                "range": rng, "equipped": False, "shock": shock,
                "area": {"shape": "cone" if base in CONE else "none", "radius": 0},
                "twoHanded": two_handed(body), "cost": cost, "quantity": 1,
                "munition": {"kind": "none", "size": "standard"}, "launcher": "",
                "description": describe(body, page, "Table: " + html.escape(dv_cell) if not dv else ""),
            }
            img = "icons/svg/sword.svg" if wtype == "melee" else "icons/svg/target.svg"
            docs.append(doc("weapons", full, "weapon", img, system, (len(docs) + 1) * 1000))

    # Seeker launchers (p. 339): damage comes from the loaded missile
    launcher_sizes = {"Disposable Launcher": "standard", "Seeker Armband": "micro", "Seeker Pistol": "micro",
                      "Seeker Rifle": "micro, mini", "Underbarrel Seeker": "micro"}
    for cells in seekers:
        name, modes, ammo = cells[0], cells[1], cells[2] if len(cells) > 2 else "0"
        body, cost = find_description(text, name)
        counts = [int(n) for n in re.findall(r"\d+", ammo)] or [0]
        system = {
            "weaponType": "ranged", "skill": "seekerWeapons", "ap": 0, "dv": "", "damageType": "kinetic",
            "addDB": False, "modes": modes, "ammo": {"value": counts[0], "max": counts[0]}, "range": "",
            "equipped": False, "shock": False, "area": {"shape": "none", "radius": 0},
            "twoHanded": two_handed(body), "cost": cost, "quantity": 1,
            "munition": {"kind": "none", "size": "standard"}, "launcher": launcher_sizes.get(name, "micro"),
            "description": describe(body, 339, f"Ammo: {html.escape(ammo)}." if len(counts) > 1 else ""),
        }
        docs.append(doc("weapons", name, "weapon", "icons/svg/target.svg", system, (len(docs) + 1) * 1000))

    # Grenades and seeker missiles (p. 341): one grenade and one seeker item per munition type
    blast_radius = {"Concussion": 10, "EMP": 50, "Overload": 10, "Splash": 10}
    for cells in munitions:
        if len(cells) < 4:
            continue
        name, ap, dv_cell, armor = cells[0], cells[1], cells[2], cells[-1]
        dv, _, _ = dv_formula(dv_cell)
        body, cost = find_description(text, *DESC_ALIASES.get(name, [name]))
        ap_val = num(ap)
        notes = "AP: armor × 2." if ap_val is None else ""
        uniform = name == "Thermobaric" or name in blast_radius
        for kind, label, skill, size in (("grenade", "Grenade", "throwingWeapons", "standard"),
                                         ("seeker", "Seeker", "seekerWeapons", "mini")):
            if kind == "grenade" and "HEAP" in name:
                continue  # HEAP is only available for seekers
            short = re.sub(r" \(.*", "", name)
            system = {
                "weaponType": "ranged", "skill": skill, "ap": ap_val or 0, "dv": dv,
                "damageType": "kinetic" if armor == "K" else "energy" if armor == "E" else "none",
                "addDB": False, "modes": "SS" if kind == "grenade" else "",
                "ammo": {"value": 0, "max": 0},
                "range": ranges.get("Standard Grenades", "") if kind == "grenade" else "",
                "equipped": False, "shock": False,
                "area": {"shape": "uniform" if uniform else "blast", "radius": blast_radius.get(short, 0)},
                "twoHanded": False, "cost": cost, "quantity": 1,
                "munition": {"kind": kind, "size": size}, "launcher": "",
                "description": describe(body, 341, notes),
            }
            img = "icons/svg/explosion.svg" if kind == "grenade" else "icons/svg/fire.svg"
            docs.append(doc("weapons", f"{short} {label}", "weapon", img, system, (len(docs) + 1) * 1000))
    write("weapons", docs)
    return docs


# ---------------------------------------------------------------- Armor

ARMOR_DESC = {"Crash Suit (Inactive)": "Crash Suit", "Crash Suit (Active)": "Crash Suit",
              "Helmet (Light)": "Helmet", "Helmet (Full)": "Helmet",
              "Synthmorph Industrial Armor": "Industrial Armor",
              "Synthmorph Combat Armor (Light)": "Light Combat Armor",
              "Synthmorph Combat Armor (Heavy)": "Heavy Combat Armor",
              "Bioweave Armor (Light)": "Bioweave Armor", "Bioweave Armor (Heavy)": "Bioweave Armor",
              "Vacsuit (Light)": "Light Vacsuit", "Vacsuit (Standard)": "Standard Vacsuit",
              "Battle Suit Powered Exoskeleton": "Battle Suit", "Transporter Exoskeleton": "Transporter",
              "Trike Exoskeleton": "Trike"}


def parse_armor():
    rows = table(312 + OFFSET, r"armor\s+energy\s+kinetic")
    docs = []
    texts = {}
    for cells in rows:
        if len(cells) < 4:
            continue
        name, e, k, page = cells[0], cells[1], cells[2], int(cells[3])
        if page not in texts:
            texts[page] = descriptions(page + OFFSET - 1, page + OFFSET + 1)
        body, cost = find_description(texts[page], ARMOR_DESC.get(name, name), re.sub(r" \(.*", "", name))
        accessory = e.startswith("+")
        system = {
            "energy": num(e), "kinetic": num(k), "equipped": False, "accessory": accessory, "cost": cost,
            "description": describe(body, page, "Accessory: adds to worn armor without the layering penalty."
                                    if accessory else ""),
        }
        docs.append(doc("armor", name, "armor", "icons/svg/shield.svg", system, (len(docs) + 1) * 1000))
    write("armor", docs)
    return docs


def summary(docs, cols):
    for d in docs:
        s = d["system"]
        print("  " + " | ".join(str(s.get(c) if not isinstance(s.get(c), dict) else
                                     "/".join(str(v) for v in s[c].values())) for c in cols).ljust(10),
              "|", d["name"], "|", len(re.sub("<[^>]+>", "", s["description"])))


weapons = parse_weapons()
armor = parse_armor()
if "--summary" in sys.argv:
    summary(weapons, ["skill", "ap", "dv", "damageType", "modes", "ammo", "range", "shock", "area", "munition"])
    summary(armor, ["energy", "kinetic", "accessory", "cost"])
