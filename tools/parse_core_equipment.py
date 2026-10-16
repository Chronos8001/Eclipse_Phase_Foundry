"""Parse the equipment entries of the EP1e Core Rulebook Gear chapter into Foundry pack sources.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_equipment.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source [--summary]

Gear entries read "Name: description. [Cost]". An entry ends at its [Cost]; text between a cost and the next
entry (sidebars, headings, section introductions) is skipped. The standard augmentations are headed paragraphs.
Numeric bonuses that the rules can apply (aptitudes, armor, speed, initiative, wounds ignored, skills) are added
as active effects from the EFFECTS table, which follows the text of each description.
"""
import hashlib, html, json, os, re, subprocess, sys

PDF, OUT = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else (None, None)
OFFSET = 2
SOURCE = "Eclipse Phase Core Rulebook"

JUNK = re.compile(r"^((\d?\.\d+)+\.?\d*|\d{1,3}|gear|Synopsis Welcome to Firewall|A Time of Eclipse.*|Skills Action and Combat|"
                  r"Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference|Skills|Action and Combat|"
                  r"Skills Action and Combat.*)$")
# "Name: text" (BTX prints a space before the colon)
ENTRY = re.compile(r"^([A-Z][\w’'/&()+.-]*(?: [\w’'/&()+-]+){0,5})\s?:\s+(.*)$")

# Augmentations (pp. 300-312): (heading that opens the section, augType)
AUG_FIRST, AUG_LAST = 302, 314
AUG_SECTIONS = [
    ("Standard Augmentations", "standard"), ("Bioware", "bioware"), ("Cyberware", "cyberware"),
    ("Nanoware", "nanoware"), ("Cosmetic Mods", "cosmetic"), ("Robotic Enhancements", "robotic"),
]
# The section ends at the Armor heading that follows the robotic Sensors
AUG_END = ("Armor", "Sensors")
# Sidebars printed among the entries ("Name:" lines without a cost): (first line, start of its last line)
AUG_SKIP = [("Using Enhanced Senses", "Infrared:"), ("using enhanced senses (cont.)", "everything inside.")]
# Paragraph entries without "Name:" (headings)
HEADED = {"Basic Biomods", "Basic Mesh Inserts", "Cortical Stack", "Cyberbrain"}
# Sub-headings inside a section: not entries
SUBHEADINGS = {"Enhanced Senses", "Mental Augmentations", "Mental Augmentation", "Physical Augmentations",
               "Armor", "Mobility Systems", "Physical Modifications", "Sensors", "Synthmorphs and", "Bioware"}

# Active effects, from the numbers given in each description: (target field, value).
# Only constant, unconditional bonuses; situational ones (Adrenal Boost) start disabled.
APT = lambda k: f"system.aptitudes.{k}.mod"
SKILL = lambda k: f"system.skillMods.{k}"
EFFECTS = {
    "Bioweave Armor (Light)": [("system.mods.energyArmor", 2), ("system.mods.kineticArmor", 3)],
    "Bioweave Armor (Heavy)": [("system.mods.energyArmor", 3), ("system.mods.kineticArmor", 4)],
    "Carapace Armor": [("system.mods.energyArmor", 11), ("system.mods.kineticArmor", 11)],
    "Cyberlimb Plus": [(APT("som"), 5)],
    "Emotional Dampers": [(SKILL("deception"), 30), (SKILL("impersonation"), 30)],
    "Endocrine Control": [("system.mods.woundsIgnored", 1), (SKILL("deception"), 20)],
    "Grip Pads": [(SKILL("climbing"), 30)],
    "Hardened Skeleton": [("system.mods.dur", 5), (APT("som"), 5)],
    "Medichines": [("system.mods.woundsIgnored", 1)],
    "Mental Speed": [("system.mods.init", 30)],
    "Muscle Augmentation": [(APT("som"), 5)],
    "Neurachem": [("system.mods.spd", 1)],
    "Oracles": [(SKILL("investigation"), 10)],
    "Pneumatic Limbs": [(SKILL("freerunning"), 20)],
    "Reflex Boosters": [(APT("ref"), 10), ("system.mods.spd", 1)],
    "Shape Adjusting": [(SKILL("disguise"), 30)],
    "Skinflex": [(SKILL("disguise"), 30)],
}
# Effects switched on by the user when the augmentation is triggered
SITUATIONAL = {
    "Adrenal Boost": [("system.mods.woundsIgnored", 1), (APT("ref"), 10)],
}

PACK_IMG = {"augmentation": "icons/svg/upgrade.svg", "substance": "icons/svg/pill.svg", "gear": "icons/svg/item-bag.svg"}


def page_lines(first, last):
    out = []
    for p in range(first, last + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), PDF, "-"],
                              capture_output=True).stdout.decode("utf-8", errors="replace")
        for line in text.split("\n"):
            # Some lines end with control characters (backspaces)
            line = re.sub(r"[\x00-\x1f]", "", line).strip()
            if line and not JUNK.match(line):
                out.append((line, p - OFFSET))
    return out


def join(parts):
    text = ""
    for l in parts:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text).replace("•", " • ").replace("  ", " ")


def skip_blocks(tagged, blocks, removed=None):
    """Drop the lines of each block, from the line starting with its first text to the line starting with its end text
    (kept when the block has a third item, True). The text of each removed block is stored in removed[first text]."""
    out, skipping, current, keep_end = [], None, None, False
    for line, page in tagged:
        if skipping is not None and line.startswith(skipping):
            skipping = None
            if keep_end:
                out.append((line, page))
                continue
            if removed is not None:
                removed[current] += " " + line
            continue
        if skipping is None:
            block = next((b for b in blocks if line.startswith(b[0])), None)
            if block:
                skipping, current, keep_end = block[1], block[0], len(block) > 2 and block[2]
                if removed is not None:
                    removed[current] = line
                continue
            out.append((line, page))
        elif removed is not None:
            removed[current] += " " + line
    return out


def entries(first, last, sections, end, headed=frozenset(), subheadings=frozenset(), skip=(), removed=None):
    """[{category, name, text, page}] of the entries between the first section heading and the end.
    end: (heading, previous heading): the first such heading found after the previous one."""
    tagged = skip_blocks(page_lines(first, last), skip, removed)
    heads = dict(sections)
    start = next(i for i, (l, _) in enumerate(tagged) if l == sections[0][0])
    after = next(i for i, (l, _) in enumerate(tagged) if (i >= start) and (l == end[1]))
    stop = next(i for i, (l, _) in enumerate(tagged) if (i > after) and (l == end[0]))
    category, current, out = None, None, []
    complete = lambda: (current is None) or (bool(current["text"]) and current["text"][-1].rstrip().endswith("]"))
    for line, page in tagged[start:stop]:
        if line in heads and complete():
            category, current = heads[line], None
            continue
        if line in headed:
            current = {"category": category, "name": line, "text": [], "page": page}
            out.append(current)
            continue
        if (line in subheadings) and complete():
            continue
        # Two entries can share a line ("... [Low] Next: text"): split after each cost
        for chunk in re.split(r"(?<=\])\s+(?=[A-Z][\w’'/&()+ -]{1,50}:\s)", line):
            m = ENTRY.match(chunk)
            # The first entry after an introduction may start mid-line ("... common. Eidetic Memory: ...")
            if not m and complete():
                # (at most four words, so that a sentence ending with "Pilot: Aircraft skill." is not a name)
                m = re.search(r"[.)]\s+([A-Z][\w’'/&()+.-]*(?: [\w’'/&()+-]+){0,3}):\s+(.*)$", chunk)
            # A headed paragraph without a cost (Nanoswarms) ends where the next "Name:" entry starts
            if m and (complete() or (current["name"] in headed and ENTRY.match(chunk))):
                current = {"category": category, "name": m.group(1), "text": [m.group(2)], "page": page}
                out.append(current)
            elif current and not complete():
                current["text"].append(chunk)
    for e in out:
        e["text"] = join(e["text"])
    return [e for e in out if e["text"]]


def split_cost(text):
    m = re.search(r"\[([^\]]+)\]\s*$", text)
    return (text[:m.start()].strip(), m.group(1)) if m else (text, "")


def make_id(pack, name):
    return hashlib.sha1(f"{pack}:{name}".encode()).hexdigest()[:16]


def effect(pack, name, changes, disabled=False):
    item_id = make_id(pack, name)
    _id = hashlib.sha1(f"{pack}:{name}:effect".encode()).hexdigest()[:16]
    return {
        "_id": _id, "_key": f"!items.effects!{item_id}.{_id}", "name": name, "img": "icons/svg/upgrade.svg",
        # v13 reads the numeric mode, v14 the string type
        "changes": [{"key": k, "mode": 2, "type": "add", "value": str(v), "priority": None} for k, v in changes],
        "disabled": disabled, "transfer": True, "duration": {}, "flags": {}, "description": "", "origin": None,
        "statuses": [], "tint": "#ffffff",
    }


def doc(pack, name, type_, system, sort, changes=None, situational=None):
    _id = make_id(pack, name)
    effects = [effect(pack, name, changes)] if changes else []
    if situational:
        effects.append(effect(pack, f"{name} (active)", situational, disabled=True))
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": type_, "img": PACK_IMG[type_], "system": system,
            "effects": effects, "flags": {}, "folder": None, "sort": sort, "ownership": {"default": 0}}


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


def key(name):
    words = re.sub(r"[^A-Za-z0-9 ]+", " ", name).split()
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def augmentations():
    docs = []
    for n, e in enumerate(entries(AUG_FIRST, AUG_LAST, AUG_SECTIONS, AUG_END, HEADED, SUBHEADINGS, AUG_SKIP)):
        desc, cost = split_cost(e["text"])
        system = {
            "key": key(e["name"]),
            "augType": e["category"],
            "cost": cost,
            "description": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: {SOURCE}, p. {e['page']}.</em></p>",
        }
        docs.append(doc("augmentations", e["name"], "augmentation", system, (n + 1) * 1000,
                        EFFECTS.get(e["name"]), SITUATIONAL.get(e["name"])))
    return docs




# ---------------------------------------------------------------- Substances (pp. 317-325)

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import core_substances as SUBST  # noqa: E402

SUB_FIRST, SUB_LAST = 318, 327
SUB_SECTIONS = [
    ("Cognitive Drugs", "drug"), ("Combat Drugs", "drug"), ("Health Drugs", "drug"), ("Recreational Drugs", "drug"),
    ("Social Drugs", "drug"), ("Nanodrugs", "nanodrug"), ("Narcoalgorithms", "narcoalgorithm"), ("Chemicals", "chemical"),
    ("Toxins", "toxin"), ("Nanotoxins", "nanotoxin"), ("Pathogens", "pathogen"), ("Psi Drugs", "psi"),
]
SUB_END = ("Everyday Technology", "Psi Drugs")
# Tables and sidebars printed among the entries: (start of the first line, start of the last line)
SUB_TABLES = {"drugs": ("Cognitive Drugs Drive", "Mental Physical Mental"),
              "nanodrugs": ("Nanodrugs Frequency", "Addiction Type"),
              "toxins": ("Chemical Toxins BTX", "6 hours 1 hour 1 hour")}
SUB_SKIP = list(SUB_TABLES.values()) + [("Other Nanodrugs", "Nanodrugs have the capability"),
                                        ("Sample Petals", "perhaps 40 hours.")]
SUB_HEADED = {"Petals"}

# Effects while under the influence (switched on when the substance is taken): constant bonuses from the text
SUB_EFFECTS = {
    "Drive": [(APT("cog"), 5)],
    "Klar": [(APT("int"), 5)],
    "Kick": [(APT("ref"), 10), ("system.mods.spd", 1)],
    "MRDR": [(APT("som"), 10), ("system.mods.spd", 1), ("system.mods.dur", 10), ("system.mods.woundsIgnored", 1)],
    "Grin": [("system.mods.woundsIgnored", 2), (SKILL("perception"), -10)],
    "Phlo": [(APT("coo"), 5), (SKILL("perception"), 10)],
    "Comfurt": [("system.mods.traumasIgnored", 1), ("system.mods.luc", 5)],
    "Orbital Hash": [("system.mods.traumasIgnored", 1)],
    "Mono No Aware": [(SKILL("art"), 10), (SKILL("sense"), 10)],
    "Psike-Out": [(SKILL("control"), 20), (SKILL("psiAssault"), 20), (SKILL("sense"), 20)],
    "Inhibitor": [(APT("cog"), -10)],
    "CR Gas": [("system.mods.actions", -20)],
}


def check_table(name, row, text):
    """Every cell of a transcribed row must appear in the extracted text of its table."""
    flat = re.sub(r"\s+", " ", text).replace("–", "-").replace("—", "-").lower()
    for cell in (SUBST.TABLE_NAMES.get(name, name),) + row[:4]:
        if cell and cell.replace("–", "-").lower() not in flat:
            raise SystemExit(f"Transcribed cell {cell!r} of {name} not found in its table text")


def substances():
    removed = {}
    found = entries(SUB_FIRST, SUB_LAST, SUB_SECTIONS, SUB_END, SUB_HEADED, frozenset(), SUB_SKIP, removed)
    tables = {k: removed.get(v[0], "") for k, v in SUB_TABLES.items()}
    stats = {**SUBST.DRUGS, **SUBST.NANODRUGS, **SUBST.TOXINS}
    for name, row in SUBST.DRUGS.items():
        check_table(name, row, tables["drugs"])
    for name, row in SUBST.NANODRUGS.items():
        check_table(name, row, tables["nanodrugs"])
    for name, row in SUBST.TOXINS.items():
        check_table(name, row, tables["toxins"])
    docs = []
    for n, e in enumerate(found):
        desc, cost = split_cost(e["text"])
        row = stats.get(e["name"], ("electronic" if e["category"] == "narcoalgorithm" else "", "", "", "", "", ""))
        system = {
            "key": key(e["name"]), "category": e["category"], "substanceType": row[0], "application": row[1],
            "onset": row[2], "duration": row[3], "addictionMod": row[4], "addictionType": row[5],
            "cost": cost, "quantity": 1,
            "description": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: {SOURCE}, p. {e['page']}.</em></p>",
        }
        d = doc("substances", e["name"], "substance", system, (n + 1) * 1000)
        if SUB_EFFECTS.get(e["name"]):
            d["effects"] = [effect("substances", e["name"], SUB_EFFECTS[e["name"]], disabled=True)]
        docs.append(d)
    missing = set(stats) - {d["name"] for d in docs}
    if missing:
        raise SystemExit(f"Table rows without a description: {sorted(missing)}")
    return docs




# ---------------------------------------------------------------- Other gear (pp. 313-342)

import core_ammo as AMMO_TABLE  # noqa: E402

# (first PDF page, last PDF page, sections, end, headed paragraphs, sub-headings, skipped blocks)
GEAR_SEGMENTS = [
    (315, 319, [("Armor Mods", "armorMod"), ("Communications", "comms"), ("Surveillance", "surveillance"),
                ("Covert and Espionage Technologies", "espionage")],
     ("Drugs, Chemicals, and Toxins", "Covert and Espionage Technologies"),
     {"Neutrino Communicators", "Quantum Farcasters", "Quantum Entangled Communication"}, {"Bugs and"}, []),
    (327, 333, [("Everyday Technology", "everyday"), ("Nanotechnology", "nanotech"), ("Pets", "pet"),
                ("Scavenger Tech", "scavenger"), ("Services", "service")],
     ("Software", "Services"),
     {"Healing Vats", "Nanodetectors", "Nanofabricators", "Ego Bridges", "Nanoswarms and Microswarms"},
     {"Basic Nanotechnology", "Advanced Nanotechnology", "Injury"}, []),
    (334, 335, [("Survival Gear", "survival")], ("Vacuum Suits", "Survival Gear"), set(), set(), []),
    (338, 340, [("Kinetic Ammunition", "ammo"), ("Smart Ammo", "ammo")], ("Beam Weapons", "Smart Ammo"), set(), set(),
     [("Ammo Armor-Piercing Bug", "Hollow-Point:", True), ("Firearms Light Pistol", "Ammo 10 12 16"), ("railguns Light Pistol", "Ammo 10 12 16")]),
    (344, 345, [("Weapon Accessories", "weaponAccessory")], ("Robots and Vehicles", "Weapon Accessories"), set(), set(), []),
]


def ammo_stats(name, table_text):
    """AP and DV modifiers of an ammunition type, from the transcribed table (checked against its text)."""
    row = AMMO_TABLE.AMMO.get(name)
    if not row:
        return None
    flat = re.sub(r"\s+", " ", table_text).replace("–", "-").replace("—", "-").lower()
    # Names hyphenated across lines ("Reactive Armor- Piercing")
    flat = re.sub(r"([a-z])- ([a-z])", r"\1-\2", flat)
    short = re.sub(r" \(.*\)$| Ammo$", "", name)
    # Names may lose their hyphen in the table ("Reactive ArmorPiercing"): compare them without dashes or spaces
    bare = lambda x: re.sub(r"[\s\-]", "", x.replace("–", "-").lower())
    if bare(short) not in bare(flat):
        raise SystemExit(f"Ammunition {name} not found in its table text")
    for cell in row:
        probe = cell.replace("–", "-").replace("—", "-").lower().replace(" (p. 204)", "")
        if probe not in flat:
            raise SystemExit(f"Transcribed ammo cell {cell!r} of {name} not found in its table text")
    ap_text, dv_text = row
    ap = int(ap_text.replace("–", "-")) if re.match(r"^[+–-]\d+$", ap_text) else 0
    dv = dv_text.replace("–", "-") if re.match(r"^[+–-]\d*d?\d+$", dv_text) else ""
    return {"ap": ap, "dv": dv, "half": "half" in dv_text, "noDamage": dv_text == "no damage",
            "armorDoubled": "AV doubled" in ap_text, "shock": "shock" in dv_text}


def gear():
    docs, seen = [], set()
    for first, last, sections, end, headed, subheadings, skip in GEAR_SEGMENTS:
        removed = {}
        found = entries(first, last, sections, end, frozenset(headed), frozenset(subheadings), skip, removed)
        table = " ".join(removed.values())
        for e in found:
            if e["name"] in seen:
                continue
            seen.add(e["name"])
            desc, cost = split_cost(e["text"])
            ammo = ammo_stats(e["name"], table) if e["category"] == "ammo" else None
            if e["category"] == "ammo" and not ammo:
                raise SystemExit(f"Ammunition {e['name']} missing from tools/data/core_ammo.py")
            system = {
                "key": key(e["name"]), "category": e["category"], "quantity": 1, "cost": cost,
                "ammo": ammo or {"ap": 0, "dv": "", "half": False, "noDamage": False, "armorDoubled": False, "shock": False},
                "description": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: {SOURCE}, p. {e['page']}.</em></p>",
            }
            docs.append(doc("gear", e["name"], "gear", system, (len(docs) + 1) * 1000))
    missing = set(AMMO_TABLE.AMMO) - {d["name"] for d in docs}
    if missing:
        raise SystemExit(f"Ammunition rows without a description: {sorted(missing)}")
    return docs


def main():
    augs = augmentations()
    write("augmentations", augs)
    if "--summary" in sys.argv:
        for d in augs:
            s = d["system"]
            fx = "; ".join(f"{c['key'].split('.')[-2] if c['key'].endswith('.mod') else c['key'].split('.')[-1]} {c['value']}"
                           for e in d["effects"] for c in e["changes"])
            print(f"{d['name'][:34]:34} {s['augType']:9} {s['cost'][:22]:22} {len(s['description']):5} {fx}")

    subs = substances()
    write("substances", subs)
    if "--summary" in sys.argv:
        for d in subs:
            s = d["system"]
            print(f"{d['name'][:22]:22} {s['category']:14} {s['substanceType']:10} {s['application']:15} {s['onset']:14} "
                  f"{s['duration']:20} {s['addictionMod']:10} {s['addictionType']:9} {s['cost'][:12]:12} {len(s['description'])}")

    gear_docs = gear()
    write("gear", gear_docs)
    if "--summary" in sys.argv:
        for d in gear_docs:
            s = d["system"]
            a = s["ammo"]
            extra = f"AP {a['ap']} DV {a['dv']} {'half ' if a['half'] else ''}{'none ' if a['noDamage'] else ''}{'AVx2 ' if a['armorDoubled'] else ''}{'shock' if a['shock'] else ''}" if s["category"] == "ammo" else ""
            print(f"{d['name'][:32]:32} {s['category']:15} {s['cost'][:18]:18} {len(s['description']):5} {extra}")


if __name__ == "__main__":
    main()
