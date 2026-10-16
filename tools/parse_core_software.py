"""Parse the software of the EP1e Core Rulebook (Gear, pp. 331-332) into Foundry pack sources.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_software.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source [--summary]

Entries read "Name: description. [Cost]" under the headings Programs, AIs and Muses, Scorchers and Skillsofts.
AI skill lists ("Skills: Infosec 20, Hardware: Electronics 30...") become skill keys, fields and ratings.
"""
import hashlib, html, json, os, re, subprocess, sys

PDF, OUT = sys.argv[1], sys.argv[2]
FIRST, LAST, OFFSET = 333, 334, 2
SOURCE = "Eclipse Phase Core Rulebook"

JUNK = re.compile(r"^((\.?\d\.?)+|gear|Synopsis Welcome to Firewall|A Time of Eclipse.*|Skills Action and Combat|"
                  r"Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference)$")
SECTIONS = {"Programs": "program", "AIs and Muses": "ai", "Scorchers": "scorcher", "Skillsofts": "skillsoft"}
END = "Survival Gear"

# Skill names of the AI stat lines -> skill keys of module/config.mjs
SKILLS = {
    "academics": "academics", "hardware": "hardware", "infosec": "infosec", "interests": "interest", "interest": "interest",
    "interface": "interfacing", "interfacing": "interfacing", "research": "research", "perception": "perception",
    "pilot": "pilot", "programming": "programming", "professional": "profession", "profession": "profession",
}
APTITUDES = {"COG": "cog", "COO": "coo", "INT": "int", "REF": "ref", "SAV": "sav", "SOM": "som", "WIL": "wil"}

# Scorchers (p. 332): harm rolled on a hit, or a WIL x 2 Test with conditions (see module/dice/mesh.mjs)
SCORCH = {
    "Bedlam": {"damage": "1d10", "harm": "stress", "effect": ""},
    "Cauterizer": {"damage": "1d10 + 5", "harm": "damage", "effect": ""},
    "Nightmare": {"damage": "", "harm": "none", "effect": "nightmare"},
    "Shutter": {"damage": "", "harm": "none", "effect": "shutter"},
    "Spasm": {"damage": "", "harm": "none", "effect": "spasm"},
}
IMAGES = {"program": "icons/svg/hanging-sign.svg", "ai": "icons/svg/mystery-man.svg",
          "scorcher": "icons/svg/lightning.svg", "skillsoft": "icons/svg/book.svg"}


def lines():
    out = []
    for p in range(FIRST, LAST + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), PDF, "-"],
                              capture_output=True).stdout.decode("utf-8", errors="replace")
        for line in text.split("\n"):
            line = line.strip()
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
    return re.sub(r"\s+", " ", text)


def entries():
    """(category, name, text, page) for each software entry."""
    tagged = lines()
    start = next(i for i, (l, _) in enumerate(tagged) if l == "Software")
    end = next(i for i, (l, _) in enumerate(tagged) if l == END)
    category, current, out = None, None, []
    for line, page in tagged[start + 1:end]:
        if line in SECTIONS:
            category = SECTIONS[line]
            current = None
            continue
        if category is None:
            continue
        # Two entries can share a line ("... [Trivial] Next Entry: text"): split after each cost
        for chunk in re.split(r"(?<=\])\s+(?=[A-Z][\w/ -]+:)", line):
            m = re.match(r"^([A-Z][\w/ -]{1,40}?):\s+(.*)$", chunk)
            # The first entry of a section may follow its introduction on the same line
            if current is None and not m:
                m = re.search(r"\.\s+([A-Z][\w/ -]{1,40}?):\s+(.*)$", chunk)
            # A new entry starts once the previous one has its [Cost]
            if m and not (current and not current["text"][-1].rstrip().endswith("]")):
                current = {"category": category, "name": m.group(1), "text": [m.group(2)], "page": page}
                out.append(current)
            elif current:
                current["text"].append(chunk)
    for e in out:
        e["text"] = join(e["text"])
    return [e for e in out if e["text"]]


def ai_stats(text):
    """Aptitudes (10 unless noted) and skills of an AI stat line."""
    aptitudes = {k: 10 for k in APTITUDES.values()}
    for abbr, value in re.findall(r"\b(COG|COO|INT|REF|SAV|SOM|WIL) (\d+)\.", text):
        aptitudes[APTITUDES[abbr]] = int(value)
    skills, notes = [], []
    m = re.search(r"Skills: (.*?)\.(?:\s*\[|$)", text)
    for part in re.split(r",\s*|\s+(?=plus )", m.group(1) if m else ""):
        part = part.strip()
        if part.startswith("plus "):
            notes.append(part)
            continue
        sm = re.match(r"^([A-Za-z ]+?)(?::\s*(.+?))?\s+(\d+)(?:\s*\(([^)]*)\))?$", part)
        if not sm:
            notes.append(part)
            continue
        name, field, value, spec = sm.groups()
        skills.append({"key": SKILLS.get(name.strip().lower(), ""), "name": name.strip(), "field": (field or "").strip(),
                       "value": int(value), "specialization": re.sub(r"\s*Specialization$", "", spec or "")})
    return aptitudes, skills, notes


def make_id(name):
    return hashlib.sha1(f"software:{name}".encode()).hexdigest()[:16]


def build():
    docs = []
    for n, e in enumerate(entries()):
        cost = re.search(r"\[([^\]]+)\]\s*$", e["text"])
        desc = e["text"][:cost.start()].strip() if cost else e["text"]
        words = re.sub(r"[^A-Za-z0-9 ]+", " ", e["name"]).split()
        system = {
            "key": words[0].lower() + "".join(w.capitalize() for w in words[1:]),
            "category": e["category"], "quality": 0, "cost": cost.group(1) if cost else "",
            "damage": "", "harm": "none", "effect": "",
            "aptitudes": {k: 10 for k in APTITUDES.values()}, "skills": [],
            "description": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: {SOURCE}, p. {e['page']}.</em></p>",
        }
        if e["category"] == "scorcher":
            system.update(SCORCH.get(e["name"], {}))
        if e["category"] == "ai":
            system["aptitudes"], system["skills"], notes = ai_stats(desc)
            if notes:
                system["description"] = system["description"].replace(
                    "<p><em>Source", f"<p>Not created automatically: {html.escape('; '.join(notes))}.</p><p><em>Source")
        _id = make_id(e["name"])
        docs.append({"_id": _id, "_key": f"!items!{_id}", "name": e["name"], "type": "software", "img": IMAGES[e["category"]],
                     "system": system, "effects": [], "flags": {}, "folder": None, "sort": (n + 1) * 1000,
                     "ownership": {"default": 0}})
    return docs


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


docs = build()
write("software", docs)
if "--summary" in sys.argv:
    for d in docs:
        s = d["system"]
        skills = ", ".join(f"{k['key'] or '?' + k['name']}{':' + k['field'] if k['field'] else ''} {k['value']}" for k in s["skills"])
        apts = " ".join(f"{k}{v}" for k, v in s["aptitudes"].items() if v != 10)
        print(f"{d['name'][:28]:28} {s['category']:9} {s['cost']:15} {len(s['description']):4} {s['damage']} {s['harm']} {s['effect']} {apts} {skills}")
