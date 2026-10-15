"""Parse every morph from the Eclipse Phase Morph Recognition Guide into Foundry pack sources.

Usage (requires poppler's pdftotext and your own copy of the PDF):
    python -I tools/parse_mrg.py "<path>/eclipse phase morph recognition guide.pdf" packs/_source

The guide has one morph per page (PDF pages 8-113), plus variant blocks that only list the fields
they change (e.g. "ARACHNIKOMA VARIANT"), which inherit everything else from their base morph.
"""
import hashlib, html, json, os, re, subprocess, sys

PDF, OUT = sys.argv[1], sys.argv[2]
FIRST_PAGE, LAST_PAGE = 8, 113
PAGE_OFFSET = 2  # PDF page - printed page
APTS = ["cog", "coo", "int", "ref", "sav", "som", "wil"]
PACK = "morphs"

LABELS = ["Implants", "Enhancements", "Modularized Gear", "Mobility System", "Movement Rate",
          "Aptitude Maximum", "Speed Modifier", "Durability", "Wound Threshold", "Advantages",
          "Disadvantages", "Notes", "CP Cost", "Credit Cost"]
LABEL_RE = re.compile(r"\b(" + "|".join(re.escape(l) for l in LABELS) + r"):")
TAG_LINES = re.compile(r"^(BIO|MORPH|MORPH \d+|PO|D|D \d+|POD|SY|NTHMORPH|NTHMORPH \d+|INFOMORPH|INFO|\d+)$")
HEADING = re.compile(r"^[A-Z][A-Z0-9'()\-]+(?: [A-Z0-9'()\-]+)*$")
INLINE_HEADING = re.compile(r"^([A-Z][A-Z0-9'\-]+(?: [A-Z][A-Z0-9'()\-]+)* VARIANTS?) (?=[A-Z][a-z])")
NOT_NAMES = {"MORPHS", "EYECHAT", "EIDOLONS", "FLEXBOT MODULES", "FLEXBOT MODULES (CONTINUED)",
             "INFOMORPH EIDOLONS", "SWARMANOID VARIANTS", "STEEL MORPH (VARIANTS)"}

# Built-in armor implants, used when the stat block does not state an Armor value
IMPLANT_ARMOR = {"Bioweave Armor (Light)": (2, 3), "Bioweave Armor (Heavy)": (3, 4), "Carapace Armor": (11, 11),
                 "Industrial Armor": (10, 10), "Light Combat Armor": (14, 12), "Heavy Combat Armor": (16, 16)}
SKILL_KEYS = {"climbing": "climbing", "swimming": "swimming", "flight": "flight", "free fall": "freeFall",
              "freerunning": "freerunning", "perception": "perception", "unarmed combat": "unarmedCombat",
              "infiltration": "infiltration", "fray": "fray", "kinesics": "kinesics", "intimidation": "intimidation",
              "navigation": "navigation", "persuasion": "persuasion"}
IMG = {"biomorph": "icons/svg/mystery-man.svg", "pod": "icons/svg/mystery-man-black.svg",
       "synthmorph": "icons/svg/cog.svg", "infomorph": "icons/svg/daze.svg"}


def page_text(p):
    out = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), PDF, "-"], capture_output=True)
    return out.stdout.decode("utf-8", errors="replace").replace("�", "-")


def page_type(lines, p):
    tags = set(lines)
    if "NTHMORPH" in tags or any(t.startswith("NTHMORPH ") for t in tags) or p in (35, 36):
        return "synthmorph"
    if "PO" in tags:
        return "pod"
    if "INFOMORPH" in tags or p == 53:
        return "infomorph"
    return "biomorph"


def title(name):
    name = re.sub(r" VARIANTS?$", "", name)
    words = []
    for w in name.split(" "):
        w = "-".join(part[:1] + part[1:].lower() for part in w.split("-"))
        words.append(w)
    return " ".join(words)


def join(text):
    text = re.sub(r"-\n(?=[a-z])", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_fields(text):
    parts = LABEL_RE.split(text)
    fields = {}
    for i in range(1, len(parts), 2):
        fields.setdefault(parts[i], join(parts[i + 1]))
    return join(parts[0]), fields


def clean_credit(value):
    m = re.match(r"^((?:Trivial|Low|Moderate|High|Expensive|None|0)(?: \([^)]*\))?)", value)
    return m.group(1) if m else value.split(" ")[0]


def parse_stats(fields, base=None):
    """Build morph stats. With a base (variant blocks), only the listed fields change:
    "Add ..." implants are appended, aptitude bonuses stack, other values replace the base ones."""
    s = json.loads(json.dumps(base)) if base else {
        "morphType": "biomorph", "aptitudeMax": {a: 30 for a in APTS}, "aptitudeBonus": {a: 0 for a in APTS},
        "durability": 0, "speedMod": 0, "initMod": 0, "armor": {"energy": 0, "kinetic": 0}, "movement": "",
        "implants": "", "advantages": "", "disadvantages": "", "skillBonuses": [], "cpCost": 0,
        "creditCost": "", "active": False, "description": ""}
    if "Implants" in fields or "Enhancements" in fields:
        implants = fields.get("Implants") or fields.get("Enhancements")
        if base and implants.startswith("Add "):
            implants = f"{s['implants']}, {implants[4:]}"
        s["implants"] = implants
    if "Modularized Gear" in fields:
        s["implants"] += f" — Modularized Gear: {fields['Modularized Gear']}"
    if "Mobility System" in fields or "Movement Rate" in fields:
        s["movement"] = fields.get("Mobility System") or fields.get("Movement Rate")
    if "Aptitude Maximum" in fields:
        txt = fields["Aptitude Maximum"]
        nums = [int(n) for n in re.findall(r"\d+", txt)]
        amax = {a: nums[0] if nums else 30 for a in APTS}
        for val, apt in re.findall(r"(\d+) (COG|COO|INT|REF|SAV|SOM|WIL)\b", txt):
            amax[apt.lower()] = int(val)
        m = re.match(r"(\d+) \((COG|COO|INT|REF|SAV|SOM|WIL)\), (\d+)", txt)
        if m:
            amax = {a: int(m.group(3)) for a in APTS}
            amax[m.group(2).lower()] = int(m.group(1))
        s["aptitudeMax"] = amax
    if "Durability" in fields:
        m = re.match(r"\d+", fields["Durability"])
        s["durability"] = int(m.group()) if m else 0
    if "Speed Modifier" in fields:
        m = re.match(r"[+-]?\d+", fields["Speed Modifier"])
        s["speedMod"] = int(m.group()) if m else 0
    if "Advantages" in fields:
        adv = fields["Advantages"]
        s["advantages"] = f"{s['advantages']} — Variant: {adv}" if base else adv
        bonus = dict(s["aptitudeBonus"]) if base else {a: 0 for a in APTS}
        # Ignore conditional bonuses written in parentheses, e.g. "(+20 with Reflex Booster)"
        for val, apt in re.findall(r"(?<!\()([+-]\d+) (COG|COO|INT|REF|SAV|SOM|WIL)\b", re.sub(r"\([^)]*\)", "", adv)):
            bonus[apt.lower()] += int(val)
        s["aptitudeBonus"] = bonus
        skills = []
        for v, name in re.findall(r"\+(\d+) ([A-Z][a-z]+(?: [A-Z][a-z]+)?) skill", adv):
            key = SKILL_KEYS.get(name.lower())
            if key:
                skills.append({"key": key, "value": int(v)})
        s["skillBonuses"] = (s["skillBonuses"] + skills) if base else skills
        am = re.search(r"Armor \(?(\d+)/(\d+)\)?", adv)
        if am:
            s["armor"] = {"energy": int(am.group(1)), "kinetic": int(am.group(2))}
    if "Disadvantages" in fields:
        dis = fields["Disadvantages"]
        s["disadvantages"] = f"{s['disadvantages']} — Variant: {dis}".strip(" —") if base else dis
    if not re.search(r"Armor \(?\d+/\d+", s["advantages"]):
        for implant, (e, k) in IMPLANT_ARMOR.items():
            if implant in s["implants"]:
                s["armor"] = {"energy": e, "kinetic": k}
    if "CP Cost" in fields:
        m = re.match(r"\d+", fields["CP Cost"])
        s["cpCost"] = int(m.group()) if m else 0
    if "Credit Cost" in fields:
        s["creditCost"] = clean_credit(fields["Credit Cost"])
    return s


PAGE_NAMES = {52: "INFOMORPH"}
NAME_FIXES = {"Sl Av E": "Slave"}
PAGE_SUFFIX = {35: "Flexbot module", 36: "Flexbot module", 53: "Infomorph eidolon"}


def fallback_heading(text, page):
    """Some pages print the morph name below its stat block (or as a type tag)."""
    if page in PAGE_NAMES:
        return PAGE_NAMES[page]
    for line in text.split("\n"):
        line = line.strip()
        if HEADING.match(line) and len(line) > 2 and not TAG_LINES.match(line) and line not in NOT_NAMES:
            return line
    return None


def split_blocks(text, page):
    """Yield (heading, body, is_variant) for each stat block on a page."""
    ends = [m.end() for m in re.finditer(r"Credit Cost:[^\n]*", text)]
    start = 0
    for end in ends:
        chunk = text[start:end]
        start = end
        first_label = LABEL_RE.search(chunk)
        head_zone = chunk[: first_label.start()] if first_label else chunk
        lines = head_zone.split("\n")
        idx, heading, rest = None, None, ""
        for i, line in enumerate(lines):
            line = line.strip()
            if TAG_LINES.match(line) or line in NOT_NAMES:
                continue
            if HEADING.match(line) and len(line) > 2:
                idx, heading, rest = i, line, ""
            else:
                m = INLINE_HEADING.match(line)
                if m:
                    idx, heading, rest = i, m.group(1), line[m.end():]
        if heading is None:
            heading, idx = fallback_heading(text, page), -1
            if heading is None:
                continue
        desc_lines = [rest] + [l for l in lines[idx + 1:] if not TAG_LINES.match(l.strip())]
        body = "\n".join(desc_lines) + chunk[len(head_zone):]
        variant = heading.endswith("VARIANT") or bool(re.match(r"\s*VARIANT\b", body))
        body = re.sub(r"^\s*VARIANT\s+", "", body)
        yield heading, body, variant


def main():
    docs, last_full, seen = [], None, set()
    for p in range(FIRST_PAGE, LAST_PAGE + 1):
        text = page_text(p)
        lines = [l.strip() for l in text.split("\n")]
        mtype = page_type(lines, p)
        for heading, body, variant in split_blocks(text, p):
            desc, fields = parse_fields(body)
            is_variant = variant or not ("Implants" in fields or "Enhancements" in fields)
            if is_variant and last_full is None:
                continue
            base = last_full if is_variant else None
            stats = parse_stats(fields, base["system"] if base else None)
            stats["morphType"] = mtype
            name = NAME_FIXES.get(title(heading), title(heading))
            if is_variant and base:
                name = f"{name} ({base['name']} variant)"
            elif p in PAGE_SUFFIX:
                name = f"{name} ({PAGE_SUFFIX[p]})"
            if name in seen:
                continue
            seen.add(name)
            notes = fields.get("Notes")
            book_page = p - PAGE_OFFSET
            parts = [f"<p>{html.escape(desc, quote=False)}</p>"] if desc else []
            if notes:
                parts.append(f"<p><strong>Notes:</strong> {html.escape(notes, quote=False)}</p>")
            parts.append(f"<p><em>Source: Eclipse Phase Morph Recognition Guide, p. {book_page}.</em></p>")
            stats["description"] = "".join(parts)
            _id = hashlib.sha1(f"{PACK}:{name}".encode()).hexdigest()[:16]
            doc = {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": "morph", "img": IMG[mtype],
                   "system": stats, "effects": [], "flags": {}, "folder": None, "sort": (len(docs) + 1) * 1000,
                   "ownership": {"default": 0}}
            docs.append(doc)
            if not is_variant:
                last_full = doc

    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs))


main()
