"""Parse the new gear of the Eclipse Phase supplements into one Foundry pack, with a folder per book.

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_supplement_gear.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

In the supplements, each item is a heading in capitals followed by a paragraph that ends with its [Cost]; sections
are capitalized headings too (BIOWARE, SURVIVAL GEAR...). Each book below maps its section headings to an item
type and category; robots and vehicles (stat blocks) are left for the robot and vehicle actors.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]
PACK = "supplement-gear"

AUG = lambda c: ("augmentation", c)
GEAR = lambda c: ("gear", c)
SOFT = ("software", "program")
SUBST = ("substance", "drug")
SKIP = (None, None)

BOOKS = [
    {
        "file": "eclipse phase transhuman.pdf", "title": "Transhuman", "offset": 3, "pages": [(142, 144), (200, 202), (213, 217)],
        # Items the book gives without a cost
        "costless": {"MICRO-TOOLS"},
        "sections": {"SOFTWARE PLUG-INS": SOFT, "UPGRADES": SOFT, "ADDITIONAL": SOFT, "BIOWARE": AUG("bioware"),
                     "CYBERWARE": AUG("cyberware"), "NANOWARE": AUG("nanoware"), "ROBOTIC ENHANCEMENTS": AUG("robotic"),
                     "SOFTWARE": SOFT, "FLEXBOT UPGRADES": AUG("robotic"), "SWARMANOID ENHANCEMENTS": AUG("robotic"),
                     "UPGRADING MORPHS": SKIP, "EIDOLONS": SKIP, "SWARMANOIDS": SKIP,
                     "SWARMANOID ATTACKS": SKIP, "PRE-ORDERING MODIFICATIONS": SKIP},
    },
    {
        "file": "ep sunward.pdf", "title": "Sunward", "offset": 3, "pages": [(169, 172)],
        "sections": {"NEW BIOWARE": AUG("bioware"), "NEW CYBERWARE": AUG("cyberware"), "NEW NANOWARE": AUG("nanoware"),
                     "NEW ROBOTIC ENHANCEMENTS": AUG("robotic"), "ROBOTIC ENHANCEMENTS": AUG("robotic"),
                     "SURVIVAL GEAR": GEAR("survival"), "EVERYDAY TECHNOLOGY": GEAR("everyday"), "SMART ANIMALS": GEAR("pet"),
                     "MARTIAN MAGLEV TRAINS": SKIP, "ROBOTS": SKIP, "VEHICLES": SKIP, "ROBOTS AND VEHICLES": SKIP},
    },
    {
        "file": "eclipse phase rimward.pdf", "title": "Rimward", "offset": 3, "pages": [(192, 196)],
        "costless": {"AQUARIUM PET"},
        "sections": {"NEW CYBERWARE": AUG("cyberware"), "NEW NANOWARE": AUG("nanoware"), "NEW BIOWARE": AUG("bioware"),
                     "NEW ROBOTIC ENHANCEMENTS": AUG("robotic"), "ARMOR MODS": GEAR("armorMod"),
                     "EVERYDAY TECHNOLOGY": GEAR("everyday"), "SURVIVAL GEAR": GEAR("survival"), "SMART ANIMALS": GEAR("pet"),
                     "PETS": GEAR("pet"), "ROBOTS": SKIP, "ROBOTS AND VEHICLES": SKIP, "VEHICLES": SKIP},
    },
    {
        "file": "Eclipse Phase gatecrashing.pdf", "title": "Gatecrashing", "offset": 3, "pages": [(155, 163), (167, 168)],
        # Weapons: skill and damage type from the text; AP, DV, modes, ammo and ranges read from their table page
        "weapons": {"PLASMA CUTTER": {"skill": "beamWeapons", "weaponType": "ranged", "damageType": "energy", "table": 161}},
        "sections": {"NEW BIOWARE": AUG("bioware"), "NEW CYBERWARE": AUG("cyberware"), "NEW NANOWARE": AUG("nanoware"),
                     "COMMUNICATIONS GEAR": GEAR("comms"), "EVERYDAY TECHNOLOGY": GEAR("everyday"),
                     "EXPLORATION GEAR": GEAR("survival"), "SMART ANIMALS": GEAR("pet"), "SURVIVAL GEAR": GEAR("survival"),
                     "XENOARCHEOLOGY GEAR": GEAR("scavenger"), "ALIEN RELICS": GEAR("other"),
                     "SPECIAL TRAIT": SKIP, "ROBOTS": SKIP, "VEHICLES": SKIP, "POWERSUITS": SKIP},
    },
    {
        "file": "eclipse phase panopticon.pdf", "title": "Panopticon", "offset": 2, "pages": [(150, 159)],
        "costless": {"CRYPTO-CRED"},
        "skip": [("OPTIONAL RULE: UPLIFT GSPS", "one level (or by 10,000"), ("UPLIFT DRUGS", None)],
        "sections": {"BIOWARE": AUG("bioware"), "CYBERWARE": AUG("cyberware"), "NANOWARE": AUG("nanoware"),
                     "ROBOTIC ENHANCEMENTS": AUG("robotic"), "COMMUNICATIONS GEAR": GEAR("comms"),
                     "COVERT AND ESPIONAGE TECHNOLOGIES": GEAR("espionage"), "DRUGS AND CHEMICALS": SUBST,
                     "NANOTECHNOLOGY": GEAR("nanotech"), "SENSOR SYSTEMS": GEAR("surveillance"), "SERVICES": GEAR("service"),
                     "SMART ANIMALS": GEAR("pet"), "SOFTWARE": SOFT, "SURVIVAL GEAR": GEAR("survival"), "ROBOTS": SKIP},
    },
    {
        "file": "eclipse phase firewall.pdf", "title": "Firewall", "offset": 2, "pages": [(176, 181)],
        "weapons": {"PLASMA SWORD (BLADES)": {"skill": "blades", "weaponType": "melee", "damageType": "energy", "table": 181},
                    "ANTIMATTER GRENADE": {"skill": "demolitions", "weaponType": "ranged", "damageType": "kinetic"}},
        "skip": [("RECREATIONAL DRUGS", None)],
        "sections": {"CYBERWARE": AUG("cyberware"), "COVERT OPS GEAR": GEAR("espionage"), "DRUGS": SUBST,
                     "EVERYDAY TECHNOLOGY": GEAR("everyday"), "NANOTECHNOLOGY": GEAR("nanotech"), "SENSORS": GEAR("surveillance"),
                     "SOFTWARE": SOFT, "ROBOTS": SKIP, "WEAPONS": ("weapon", ""), "USING NON-FIREWALL FACTIONS": SKIP},
    },
]

COST = re.compile(r"\[((?:Trivial|Low|Moderate|Medium|High|Expensive|Free|One Cost Category|Only Available|Increase)[^\]]*)\]")
# A capitalized line with at least one word (stat rows of numbers are not headings)
CAPS = re.compile(r"^(?=.*[A-ZÆ]{2})[A-Z0-9Æ][A-Z0-9Æ &/,.'’()+-]{2,60}$")
# Category labels printed after some names ("WINGS (PHYSICAL AUGMENTATION)")
LABEL = re.compile(r"\s*\(((PHYSICAL|MENTAL) (AUGMENTATION|MODIFICATION)|ENHANCED SENSE|EVERYDAY TECHNOLOGY|BLADES)\)", re.I)
VEHICLE = re.compile(r"\((GROUNDCRAFT|AIRCRAFT|HOVERCRAFT|SPACECRAFT|WATERCRAFT|ROBOT)\)", re.I)
# Running headers, chapter tabs and table headings in capitals
FURNITURE = re.compile(
    r"^(GAME INFORMATION|.*GAME INFORMATION|SURVEILLANCE HABITATS UPLIFTS|GATECRASHING OPS PANDORA GATES|EXTRASOLAR SYSTEMS.*|"
    r"SOL-MERCURY VENUS EARTH|EARTH ORBIT LUNA MARS INNER FRINGE|MAIN BELT JUPITER|SATURN.*|FIREWALL OTHER GROUPS.*|"
    r"CHARACTER CREATION|TER CREATION|CREATION|OPTIONAL RULE|EXAMPLE|NEW GEAR|NEW MORPH ENHANCEMENTS|"
    # Chapter tabs and stat block headings
    r"SURVEILLANCE|HABITATS|UPLIFTS|CREATURES|CREATURE|ANIMAL|PANOPTICON|COG COO INT.*|BEAM WEAPON RANGES|BEAM WEAPONS|FIRING MODES.*|AMMO \d+|"
    r"ARMOR PENETRATION.*|DAMAGE VALUE.*|AVERAGE DV.*|"
    r"PLAYING CHARACTERS|MORPHS|CHARACTER OPTIONS.*|.*CREATION:.*|"
    r"(\.\d)+.*|\d{1,3})$")


def lines(book):
    out = []
    for first, last in book["pages"]:
        for p in range(first, last + 1):
            text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p),
                                   os.path.join(FOLDER, book["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
            for line in text.split("\n"):
                # Control characters, and the end-of-section glyph that prints as a lone "n"
                line = re.sub(r"\s+n$", "", re.sub(r"[\x00-\x1f]", "", line).strip())
                if line and not FURNITURE.match(line):
                    out.append((line, p - book["offset"]))
    return out


def join(parts):
    text = ""
    for l in parts:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text)


def title(caps):
    small = {"and", "of", "the", "or", "to", "in", "for", "a", "an", "with"}
    caps = LABEL.sub("", caps).strip()
    words = caps.lower().split()
    out = [w if (i and w in small) else re.sub(r"^([^a-z]*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
           for i, w in enumerate(words)]
    name = " ".join(out)
    # Hyphenated or slashed words and acronyms: "Neo-cetacean" -> "Neo-Cetacean", "Qe Comm" -> "QE Comm"
    name = re.sub(r"([-/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), name)
    return re.sub(r"\b(Qe|Ai|Id|Xp|Emp|Gps|Ar|Vr|Dna|Ecg|Rfid)\b", lambda m: m.group(1).upper(), name)


DRUG_TABLE_ROWS = ("DRUG ", "TYPE ", "APPLICATION ", "ONSET TIME ", "DURATION ", "ADDICTION MODIFIER", "ADDICTION TYPE ")


def drug_tables(tagged):
    """Lines of the drug tables (one row per line: DRUG names, TYPE..., ADDICTION TYPE...), and the other lines.
    The cells of a row may run over the next line."""
    tables, rest, current, drugs, types = [], [], None, 0, None
    for line, page in tagged:
        if line.startswith("DRUG ") and not COST.search(line):
            current, types = [line], None
            tables.append(current)
            continue
        if current is None:
            rest.append((line, page))
            continue
        current.append(line)
        # The DURATION row is printed on one line: it gives the number of drugs
        if line.startswith("DURATION "):
            drugs = len(re.findall(r"\d+ (?:Action Turns?|minutes?|hours?|days?)", line))
        if line.startswith("ADDICTION TYPE"):
            types = 0
        if types is not None:
            types += len(re.findall(r"Mental|Physical|Both|—", line))
            # The table ends with its addiction types, possibly continued on the next line
            if types >= drugs:
                current = None
    return [" ".join(t) for t in tables], rest


def read_drug_table(text, names):
    """{name: (type, application, onset, duration, addiction modifier, addiction type)} from a flattened drug table."""
    m = re.search(r"DRUG (.+?)\s+TYPE (.+?)\s+APPLICATION (.+?)\s+(?:[A-Z][A-Z ]+\s+)?ONSET TIME (.+?)\s+DURATION (.+?)\s+"
                  r"ADDICTION MODIFIER (.+?)\s+ADDICTION TYPE (.+)$", text)
    if not m:
        raise SystemExit(f"Unreadable drug table: {text[:120]}")
    order = sorted((n for n in names if n in m.group(1)), key=lambda n: m.group(1).index(n))
    cells = [
        re.findall(r"(?:Chem|Bio|Nano)(?:, Narcoalgorithm)?", m.group(2)),
        re.findall(r"(?:(?:D|Inh|Inj|O|Code), )*(?:D|Inh|Inj|O|Code)", m.group(3)),
        re.findall(r"\d+ (?:Action Turns?|minutes?|hours?|days?)|Immediate", m.group(4)),
        re.findall(r"\d+ (?:Action Turns?|minutes?|hours?|days?)", m.group(5)),
        re.findall(r"[+−–-]\d+|—", m.group(6)),
        re.findall(r"Mental|Physical|Both|—", m.group(7)),
    ]
    if any(len(c) != len(order) for c in cells) or not order:
        raise SystemExit(f"Drug table cells do not line up with {order}: {cells}")
    out = {}
    for i, name in enumerate(order):
        kind = cells[0][i].split(",")[0].lower()
        mod = cells[4][i].replace("−", "–").replace("-", "–")
        out[name] = (kind, cells[1][i], cells[2][i], cells[3][i], "" if mod == "—" else mod,
                     "" if cells[5][i] == "—" else cells[5][i].lower())
    return out


def parse(book):
    """Entries {type, category, name, text, page} of a book, and the stats of its drugs."""
    section, current, out = SKIP, None, []
    complete = lambda: current is None or bool(COST.search(current["text"][-1] if current["text"] else ""))
    tables, tagged = drug_tables(skip_blocks(lines(book), book.get("skip", [])))
    costless = book.get("costless", set())
    # An unfinished entry interrupted mid-sentence (by a sidebar, a stat block or a chapter tab) is suspended
    # until its text resumes with a lowercase line
    suspended = False
    # Whether the next line of prose continues a sentence (starts in lowercase)
    prose = [i for i, (l, _) in enumerate(tagged) if not CAPS.match(l)]
    continues = {}
    for a, b in zip([-1] + prose, prose):
        for i in range(a + 1, b + 1):
            continues[i] = bool(re.match(r"^[a-z]", tagged[b][0]))
    for index, (line, page) in enumerate(tagged):
        unfinished = current is not None and bool(current["text"]) and not complete()
        sentence_end = unfinished and bool(re.search(r"[.!?:)\]][\"”’]?$", current["text"][-1])) and not continues.get(index)
        if CAPS.match(line) and not COST.search(line):
            if unfinished and not sentence_end:
                suspended = True
                if line in book["sections"]:
                    section = book["sections"][line]
                continue
            if line in book["sections"]:
                if current and not complete() and current["name"] not in costless:
                    out.remove(current)  # a heading that never got a cost: not an item
                section, current, suspended = book["sections"][line], None, False
                continue
            if section[0] is None:
                continue
            # A capitalized line: an item name, or the second line of a name split in two
            if current and not current["text"]:
                current["name"] += " " + line
                continue
            if unfinished and current["name"] not in costless:
                out.remove(current)  # a paragraph without a cost before this heading: rules text, not an item
            current = {"type": section[0], "category": section[1], "name": line, "text": [], "page": page}
            out.append(current)
            suspended = False
            continue
        if suspended:
            if not re.match(r"^[a-z]", line):
                continue
            suspended = False
        if current and not complete():
            current["text"].append(line)
        elif current and line.startswith("Skills:") and current["type"] == "software":
            # AI skills printed after the cost
            current["stats"] = line
    items = []
    for e in out:
        if VEHICLE.search(e["name"]):
            continue  # robots and vehicles become actors
        text = join(e["text"])
        m = list(COST.finditer(text))
        if not m:
            if e["name"] in costless:
                items.append({**e, "name": title(e["name"]), "desc": text.strip(), "cost": ""})
            continue
        cost = m[-1]
        desc = text[:cost.start()].strip()
        if e.get("stats"):
            desc = f"{desc} {e['stats']}"
        item = {**e, "name": title(e["name"]), "desc": desc, "cost": cost.group(1)}
        if e["name"] in book.get("weapons", {}):
            item["type"] = "weapon"
            item["weapon"] = weapon_stats(book, book["weapons"][e["name"]])
        items.append(item)
    # Drug stats from the drug tables, matched by item name
    drugs = [i["name"] for i in items if i["type"] == "substance"]
    stats = {}
    for table in tables:
        stats.update(read_drug_table(table, drugs))
    for i in items:
        if i["type"] == "substance":
            if i["name"] not in stats:
                raise SystemExit(f"{book['title']}: no table row for the drug {i['name']}")
            i["stats"] = stats[i["name"]]
    return items


def weapon_stats(book, cfg):
    """WeaponData of a supplement weapon: one-row tables, each value printed after its column label."""
    stats = {"weaponType": cfg["weaponType"], "skill": cfg["skill"], "ap": 0, "dv": "", "damageType": cfg["damageType"],
             "addDB": False, "modes": "", "ammo": {"value": 0, "max": 0, "loaded": "", "size": ""}, "range": "",
             "equipped": False, "shock": False, "area": {"shape": "none", "radius": 0, "falloff": 2}, "twoHanded": False,
             "quantity": 1, "munition": {"kind": "none", "size": "standard"}, "launcher": ""}
    if "table" not in cfg:
        return stats
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(cfg["table"]), "-l", str(cfg["table"]),
                           os.path.join(FOLDER, book["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
    text = re.sub(r"\s+", " ", text)
    after = lambda label, pattern: (re.search(re.escape(label) + r".*?(" + pattern + ")", text) or [None, None])[1]
    ap = after("ARMOR PENETRATION (AP)", r"[–−-]\d+")
    dv = after("DAMAGE VALUE (DV)", r"\d+d10(?: \+ \d+)?")
    if not (ap and dv):
        raise SystemExit(f"{book['title']}: no AP/DV found on page {cfg['table']}")
    stats["ap"] = int(ap.replace("–", "-").replace("−", "-"))
    stats["dv"] = dv
    modes = re.search(r"FIRING MODES ((?:SS|SA|BF|FA)(?:, (?:SS|SA|BF|FA))*)", text)
    stats["modes"] = modes.group(1) if modes else ""
    ammo = re.search(r"AMMO (\d+)", text)
    if ammo:
        stats["ammo"].update(value=int(ammo.group(1)), max=int(ammo.group(1)))
    bands = [after(label, r"\d+[–-]\d+") for label in ("SHORT RANGE", "MEDIUM RANGE", "LONG RANGE", "EXTREME RANGE")]
    if all(bands):
        stats["range"] = " / ".join(b.split("–")[-1].split("-")[-1] for b in bands)
    return stats


def skip_blocks(tagged, blocks):
    """Drop the lines of each block, from the line starting with its first text to the line starting with its end text
    (a single line when the end text is None)."""
    out, skipping = [], None
    for line, page in tagged:
        if skipping is None:
            block = next((b for b in blocks if line.startswith(b[0])), None)
            if block:
                skipping = block[1]
                continue
            out.append((line, page))
        elif (skipping is not None) and line.startswith(skipping):
            skipping = None
    return out


def key(name):
    words = re.sub(r"[^A-Za-z0-9 ]+", " ", name).split()
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def system_for(e, book):
    desc = (f"<p>{html.escape(e['desc'], quote=False)}</p>"
            f"<p><em>Source: Eclipse Phase {book['title']}, p. {e['page']}.</em></p>")
    base = {"key": key(e["name"]), "cost": e["cost"], "description": desc}
    if e["type"] == "augmentation":
        return {**base, "augType": e["category"]}
    if e["type"] == "weapon":
        return {**base, **e["weapon"]}
    # Suits giving an Armor Value (energy/kinetic) are armor, like the vacsuits of the core rulebook
    av = AV.search(e["desc"]) if e["type"] == "gear" else None
    if av:
        energy, kinetic = [int(x) for x in (av.group(1, 2) if av.group(1) else av.group(3, 4))]
        e["type"] = "armor"
        return {**base, "energy": energy, "kinetic": kinetic, "equipped": False, "accessory": False}
    if e["type"] == "gear":
        return {**base, "category": e["category"], "quantity": 1,
                "ammo": {"ap": 0, "dv": "", "half": False, "noDamage": False, "armorDoubled": False, "shock": False}}
    if e["type"] == "software":
        ai = e["name"].endswith(" AI")
        aptitudes, skills = ai_stats(e["desc"]) if ai else ({k: 10 for k in APTITUDES}, [])
        return {**base, "category": "ai" if ai else "program", "quality": 0, "damage": "", "harm": "none", "effect": "",
                "aptitudes": aptitudes, "skills": skills}
    if e["type"] == "substance":
        kind, application, onset, duration, mod, addiction = e["stats"]
        return {**base, "category": "drug", "substanceType": kind, "application": application, "onset": onset,
                "duration": duration, "addictionMod": mod, "addictionType": addiction, "quantity": 1}


# AI stat lines ("REF 20. Skills: Infosec 30, Hardware: Electronics 40..."), as in tools/parse_core_software.py
APTITUDES = {"COG": "cog", "COO": "coo", "INT": "int", "REF": "ref", "SAV": "sav", "SOM": "som", "WIL": "wil"}
SKILL_KEYS = {
    "academics": "academics", "art": "art", "beam weapons": "beamWeapons", "blades": "blades", "climbing": "climbing",
    "demolitions": "demolitions", "deception": "deception", "flight": "flight", "fray": "fray", "freerunning": "freerunning",
    "gunnery": "gunnery", "hardware": "hardware", "impersonation": "impersonation", "infiltration": "infiltration",
    "infosec": "infosec", "interest": "interest", "interests": "interest", "interface": "interfacing",
    "interfacing": "interfacing", "intimidation": "intimidation", "investigation": "investigation", "kinesics": "kinesics",
    "kinetic weapons": "kineticWeapons", "language": "language", "medicine": "medicine", "navigation": "navigation",
    "networking": "networking", "perception": "perception", "persuasion": "persuasion", "pilot": "pilot",
    "profession": "profession", "professional": "profession", "programming": "programming", "protocol": "protocol",
    "research": "research", "scrounging": "scrounging", "spray weapons": "sprayWeapons", "unarmed combat": "unarmedCombat",
    "animal handling": "animalHandling", "throwing weapons": "throwingWeapons", "seeker weapons": "seekerWeapons",
}


def ai_stats(text):
    aptitudes = {k: 10 for k in APTITUDES.values()}
    for abbr, value in re.findall(r"\b(COG|COO|INT|REF|SAV|SOM|WIL) (\d+)\b", text.split("Skills:")[0]):
        aptitudes[APTITUDES[abbr]] = int(value)
    skills = []
    m = re.search(r"Skills: (.*?)(?:\.\s|\.?$)", text)
    for part in re.split(r",\s*", m.group(1) if m else ""):
        sm = re.match(r"^([A-Za-z ]+?)(?::\s*(.+?))?(?:\s*\(([^)]*)\))?\s+(\d+)(?:\s*\((\d+)\))?$", part.strip())
        if not sm:
            continue
        name, field, spec, value, _ = sm.groups()
        skills.append({"key": SKILL_KEYS.get(name.strip().lower(), ""), "name": name.strip(), "field": (field or "").strip(),
                       "value": int(value), "specialization": spec or ""})
    return aptitudes, skills


AV = re.compile(r"(?:\bAV|[Aa]rmor of(?: AV)?)\s*(\d+)\s*/\s*(\d+)|\b(\d+)\s*/\s*(\d+)\s+armor")

IMAGES = {"weapon": "icons/svg/sword.svg", "armor": "icons/svg/shield.svg", "augmentation": "icons/svg/upgrade.svg", "gear": "icons/svg/item-bag.svg",
          "software": "icons/svg/hanging-sign.svg", "substance": "icons/svg/pill.svg"}


def build():
    docs, folders = [], []
    for b, book in enumerate(BOOKS):
        folder_id = make_id("folder", book["title"])
        folders.append({"_id": folder_id, "_key": f"!folders!{folder_id}", "name": book["title"], "type": "Item",
                        "folder": None, "sorting": "a", "sort": (b + 1) * 1000, "color": None, "flags": {}, "description": ""})
        seen = set()
        for n, e in enumerate(parse(book)):
            if e["name"] in seen:
                continue
            seen.add(e["name"])
            _id = make_id(book["title"], e["name"])
            system = system_for(e, book)  # may turn an armored suit into armor
            docs.append({"_id": _id, "_key": f"!items!{_id}", "name": e["name"], "type": e["type"], "img": IMAGES[e["type"]],
                         "system": system, "effects": [], "flags": {}, "folder": folder_id,
                         "sort": (n + 1) * 1000, "ownership": {"default": 0}})
    return folders, docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for x in folders:
        with open(os.path.join(d, f"_folder-{x['name'].lower()}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        book = next(f["name"] for f in folders if f["_id"] == x["folder"]).lower()
        slug = re.sub(r"[^a-z0-9]+", "-", f"{book}-{x['name'].lower()}").strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs), "items in", len(folders), "folders")


folders, docs = build()
write(folders, docs)
if "--summary" in sys.argv:
    sys.stdout.reconfigure(encoding="utf-8")
    for x in docs:
        book = next(f["name"] for f in folders if f["_id"] == x["folder"])
        s = x["system"]
        cat = s.get("augType") or s.get("category") or f"{s.get('energy')}/{s.get('kinetic')}"
        print(f"{book[:12]:12} {x['type']:12} {cat:11} {x['name'][:36]:36} {s['cost'][:16]:16} {len(s['description'])}")
