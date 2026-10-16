"""Parse the equipment entries of the EP1e Core Rulebook Gear chapter into Foundry pack sources.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_equipment.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source [--summary]

Gear entries read "Name: description. [Cost]". An entry ends at its [Cost]; text between a cost and the next
entry (sidebars, headings, section introductions) is skipped. The standard augmentations are headed paragraphs.
Numeric bonuses that the rules can apply (aptitudes, armor, speed, initiative, wounds ignored, skills) are added
as active effects from the EFFECTS table, which follows the text of each description.
"""
import hashlib, html, json, os, re, subprocess, sys

PDF, OUT = sys.argv[1], sys.argv[2]
OFFSET = 2
SOURCE = "Eclipse Phase Core Rulebook"

JUNK = re.compile(r"^((\d?\.\d+)+\.?\d*|\d{1,3}|gear|Synopsis Welcome to Firewall|A Time of Eclipse.*|Skills Action and Combat|"
                  r"Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference|Skills|Action and Combat|"
                  r"Skills Action and Combat.*)$")
ENTRY = re.compile(r"^([A-Z][\w’'/&()+-]*(?: [\w’'/&()+-]+){0,5}):\s+(.*)$")

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

PACK_IMG = {"augmentation": "icons/svg/upgrade.svg"}


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


def skip_blocks(tagged, blocks):
    """Drop the lines of each block, from its first line to the line starting with its end text."""
    out, skipping = [], None
    for line, page in tagged:
        if skipping is None:
            block = next((b for b in blocks if line == b[0]), None)
            if block:
                skipping = block[1]
                continue
            out.append((line, page))
        elif line.startswith(skipping):
            skipping = None
    return out


def entries(first, last, sections, end, headed=frozenset(), subheadings=frozenset(), skip=()):
    """[{category, name, text, page}] of the entries between the first section heading and the end.
    end: (heading, previous heading): the first such heading found after the previous one."""
    tagged = skip_blocks(page_lines(first, last), skip)
    heads = dict(sections)
    start = next(i for i, (l, _) in enumerate(tagged) if l == sections[0][0])
    after = next(i for i, (l, _) in enumerate(tagged) if (i > start) and (l == end[1]))
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
                m = re.search(r"[.)]\s+([A-Z][\w’'/&()+-]*(?: [\w’'/&()+-]+){0,5}):\s+(.*)$", chunk)
            if m and complete():
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


augs = augmentations()
write("augmentations", augs)
if "--summary" in sys.argv:
    for d in augs:
        s = d["system"]
        fx = "; ".join(f"{c['key'].split('.')[-2] if c['key'].endswith('.mod') else c['key'].split('.')[-1]} {c['value']}"
                       for e in d["effects"] for c in e["changes"])
        print(f"{d['name'][:34]:34} {s['augType']:9} {s['cost'][:22]:22} {len(s['description']):5} {fx}")
