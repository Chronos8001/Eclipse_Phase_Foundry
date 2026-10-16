"""Parse the psi sleights of the EP1e books into Foundry pack sources.

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_sleights.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

Sources: Core Rulebook (psi-chi and psi-gamma, pp. 223-228; exsurgent psi-gamma and psi-epsilon, pp. 371-372),
Transhuman (p. 154) and X-Risks (exsurgent psi-gamma, pp. 177-180).
Each stat block reads "Psi Type / Action / Range / Duration / Strain Mod / Skill", then the description.
Psi-epsilon sleights have no stat block: the book leaves their mechanics to the gamemaster.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]

# (file, first PDF page, last PDF page, PDF page - printed page, source title, exsurgent-only)
SOURCES = {
    "core": ("Eclipse Phase - Core Rulebook.pdf", 223, 231, 2, "Eclipse Phase Core Rulebook", False),
    "core-exsurgent": ("Eclipse Phase - Core Rulebook.pdf", 373, 374, 2, "Eclipse Phase Core Rulebook", True),
    "transhuman": ("eclipse phase transhuman.pdf", 157, 157, 3, "Transhuman", False),
    "x-risks": ("eclipse phase x-risks.pdf", 179, 182, 2, "X-Risks", True),
}

# Page furniture: navigation bars, chapter tabs, decorative rules, page numbers
JUNK = re.compile(
    r"^((\.\d)+(\s+\d{1,3})?|\d{1,3}|MIND HACKS|GAME INFORMATION|game information|CHARACTER OPTIONS|Synopsis Welcome to Firewall|"
    r"A Time of Eclipse Game Mechanics.*|Skills Action and Combat.*|Mind Hacks The Mesh.*|Accelerated Future Gear.*|"
    r"Running the Game Reference|FACING THE REAPER.*|ACTIVE THREAT REPORTS.*|THREAT RECOGNITION GUIDE.*)$")

# Sections that end a source's sleight list
STOP = re.compile(r"^(Psychosurgery|PSYCHOSURGERY|The Factors|WATTS-MACLEOD DISORDERS|Watts-MacLeod Disorders|FACTOR TECHNOLOGY)$")

# Stat block fields, in any order (Implant Memory prints them in two columns)
FIELDS = {
    "activation": r"Psi Type:\s*(Active|Passive)",
    "action": r"Action:\s*(Automatic|Quick|Complex|Task)(?:\s*\([^)]*\))?",
    "range": r"Range:\s*(Self|Touch|Close)",
    "duration": r"Duration:\s*(Constant|Instant|Sustained|Temp\s*\((?:Action Turns|Minutes|Hours)\))",
    "strain": r"Strain Mod:\s*([+\-–−]?\s*\d+(?:\s*/\s*target after first|\s*per AP point)?)",
    "skill": r"Skill:(?:\s*(Control|Psi Assault|Sense)\b)?",
}


def read_header(body):
    """Fields of the stat block at the start of body, and where the description begins."""
    values, end = {}, 0
    for field, pattern in FIELDS.items():
        m = re.compile(pattern, re.I).search(body[:400])
        if m:
            values[field] = m.group(1)
            end = max(end, m.end())
    if not all(k in values for k in ("activation", "action", "range", "duration")):
        return None, 0
    return values, end

SKILLS = {"control": "control", "psi assault": "psiAssault", "sense": "sense"}
UNITS = {"action turns": "turns", "minutes": "minutes", "hours": "hours"}

# Sleights whose harm is automated (roll data: @wil is the WIL aptitude): physical damage or mental stress
DAMAGE = {
    "Psychic Stab": ("1d10 + ceil(@wil / 10)", "damage"),
    "Onslaught": ("1d10 + ceil(@wil / 10)", "stress"),
}

# Bonuses applied by active effects. Active sleights start disabled and are enabled while in use.
EFFECTS = {
    "Cognitive Boost": [("system.aptitudes.cog.mod", 5)],
    "Qualia": [("system.aptitudes.int.mod", 5)],
    "High Pain Threshold": [("system.mods.woundsIgnored", 1)],
    "Unconscious Lead": [("system.mods.spd", 1)],
    "Psi Shield": [("system.mods.psiShield", 1)],
}


def page_lines(file, first, last, offset):
    """Cleaned text lines of a page range, each with its printed page."""
    out = []
    for p in range(first, last + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), os.path.join(FOLDER, file), "-"],
                              capture_output=True).stdout.decode("utf-8", errors="replace")
        for line in text.split("\n"):
            line = line.strip()
            if line and not JUNK.match(line):
                out.append((line, p - offset))
    return out


def join(lines):
    """Join wrapped lines, mending words hyphenated at line ends."""
    text = ""
    for l in lines:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text)


def title(name):
    """X-Risks and Transhuman print names in capitals."""
    return name.title().replace("’S", "’s").replace("'S", "'s") if name.isupper() else name


def key(name):
    words = re.sub(r"[^A-Za-z0-9 ]+", " ", name).split()
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def strain_values(text):
    """Strain Mod text -> (base modifier, extra per additional target, per point of AP)."""
    if not text:
        return 0, 0, False
    t = text.replace("–", "-").replace("−", "-").replace(" ", "")
    n = int(re.match(r"[+-]?\d+", t).group(0))
    if "target" in t:
        return 0, n, False
    if "perAP" in t:
        return 0, 0, True
    return n, 0, False


def parse_blocks(source):
    """Sleight stat blocks of a source: name line, then 'Psi Type:' within the next two lines."""
    file, first, last, offset, book, exsurgent = SOURCES[source]
    lines = page_lines(file, first, last, offset)
    texts = [l for l, _ in lines]
    # A sleight starts with its name, on the line before "Psi Type:" or on the same line ("Name: Psi Type: ...")
    starts = [i for i in range(len(texts) - 1)
              if re.match(r"^Psi Type:", texts[i + 1], re.I) or re.match(r"^[^:]+:\s*Psi Type:", texts[i], re.I)]
    gamma_from = next((i for i, t in enumerate(texts) if re.match(r"^Psi-Gamma Sleights$", t, re.I)), None)
    blocks = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(texts)
        stop = next((i for i in range(start + 1, end) if STOP.match(texts[i])
                     or re.match(r"^(Psi-Gamma Sleights|Exsurgent Psi-Epsilon Sleights|PSI-GAMMA SLEIGHTS)$", texts[i])), end)
        raw = re.sub(r":\s*Psi Type:.*$", "", texts[start], flags=re.I)
        inline = texts[start][len(raw) + 1:].strip() if raw != texts[start] else ""
        m = re.match(r"^(.*?)\s*\((PSI-CHI|PSI-GAMMA)\)$", raw, re.I)
        name = title(m.group(1) if m else raw)
        if m:
            psi_type = "chi" if m.group(2).upper() == "PSI-CHI" else "gamma"
        elif source == "core":
            psi_type = "gamma" if (gamma_from is not None and start > gamma_from) else "chi"
        else:
            psi_type = "gamma"
        body = join(([inline] if inline else []) + texts[start + 1:stop])
        h, end = read_header(body)
        if not h:
            print(f"!! {source}: no stat block parsed for {name}: {body[:120]}", file=sys.stderr)
            continue
        blocks.append({"name": name, "psiType": psi_type, "header": h, "desc": body[end:].strip(),
                       "page": lines[start][1], "book": book, "exsurgent": exsurgent})
    return blocks


def parse_epsilon():
    """Psi-epsilon sleights (Core p. 372): a name line, then a paragraph."""
    file, first, last, offset, book, _ = SOURCES["core-exsurgent"]
    lines = page_lines(file, first, last, offset)
    texts = [l for l, _ in lines]
    start = next(i for i, t in enumerate(texts) if t.startswith("At the gamemaster’s discretion, simply observing"))
    end = next(i for i, t in enumerate(texts) if t == "The Factors")
    entries = []
    for i in range(start + 1, end):
        t = texts[i]
        # Names are short title-case lines without a final period
        if len(t) < 40 and not t.endswith(".") and t[0].isupper() and all(w[0].isupper() for w in t.split() if w[0].isalpha()):
            entries.append({"name": t, "body": [], "page": lines[i][1]})
        elif entries:
            entries[-1]["body"].append(t)
    return [{"name": e["name"], "desc": join(e["body"]), "page": e["page"], "book": book} for e in entries]


def effect(name, changes, disabled):
    _id = hashlib.sha1(f"sleights:{name}:effect".encode()).hexdigest()[:16]
    return {
        "_id": _id, "_key": f"!items.effects!{make_id(name)}.{_id}", "name": name, "img": "icons/svg/aura.svg",
        # v13 reads the numeric mode, v14 the string type
        "changes": [{"key": k, "mode": 2, "type": "add", "value": str(v), "priority": None} for k, v in changes],
        "disabled": disabled, "transfer": True, "duration": {}, "flags": {}, "description": "", "origin": None,
        "statuses": [], "tint": "#ffffff",
    }


def make_id(name):
    return hashlib.sha1(f"sleights:{name}".encode()).hexdigest()[:16]


def describe(desc, book, page, notes=""):
    parts = [f"<p>{html.escape(desc, quote=False)}</p>"] if desc else []
    if notes:
        parts.append(f"<p>{notes}</p>")
    parts.append(f"<p><em>Source: {book}, p. {page}.</em></p>")
    return "".join(parts)


def build():
    docs, seen = [], {}
    for source in ("core", "core-exsurgent", "transhuman", "x-risks"):
        for b in parse_blocks(source):
            h = b["header"]
            strain, per_target, per_ap = strain_values(h.get("strain"))
            activation = h["activation"].lower()
            duration = h["duration"].lower()
            unit = re.search(r"\((.*)\)", duration)
            system = {
                "key": key(b["name"]),
                "psiType": b["psiType"],
                "activation": activation,
                "action": h["action"].lower(),
                "range": h["range"].lower(),
                "duration": "temporary" if duration.startswith("temp") else duration,
                "durationUnit": UNITS.get(unit.group(1) if unit else "", "turns"),
                "strainMod": strain,
                "strainPerTarget": per_target,
                "strainPerAP": per_ap,
                "skill": SKILLS.get((h.get("skill") or "").lower(), ""),
                "damage": DAMAGE.get(b["name"], ("", "damage"))[0],
                "harm": DAMAGE.get(b["name"], ("", "damage"))[1],
                "exsurgent": b["exsurgent"],
                "active": False,
                "remaining": 0,
                "description": describe(b["desc"], b["book"], b["page"]),
            }
            d = doc(b["name"], system, "icons/svg/daze.svg" if b["psiType"] == "chi" else "icons/svg/terror.svg")
            if b["name"] in EFFECTS:
                d["effects"] = [effect(b["name"], EFFECTS[b["name"]], disabled=activation == "active")]
            if b["name"] in seen:
                print(f"!! duplicate {b['name']} ({seen[b['name']]} / {b['book']}): the later book wins", file=sys.stderr)
                docs = [x for x in docs if x["name"] != b["name"]]
            seen[b["name"]] = b["book"]
            docs.append(d)
    for e in parse_epsilon():
        system = {
            "key": key(e["name"]), "psiType": "epsilon", "activation": "active", "action": "complex", "range": "close",
            "duration": "instant", "durationUnit": "turns", "strainMod": 0, "strainPerTarget": 0, "strainPerAP": False,
            "skill": "", "damage": "", "harm": "damage", "exsurgent": True, "active": False, "remaining": 0,
            "description": describe(e["desc"], e["book"], e["page"],
                                    "Psi-epsilon: the book leaves action, range, duration and effects to the gamemaster."),
        }
        docs.append(doc(e["name"], system, "icons/svg/lightning.svg"))
    for n, d in enumerate(docs):
        d["sort"] = (n + 1) * 1000
    return docs


def doc(name, system, img):
    _id = make_id(name)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": "sleight", "img": img, "system": system,
            "effects": [], "flags": {}, "folder": None, "sort": 0, "ownership": {"default": 0}}


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
write("sleights", docs)
if "--summary" in sys.argv:
    for d in docs:
        s = d["system"]
        print(f"{d['name'][:26]:26} {s['psiType']:7} {s['activation']:7} {s['action']:9} {s['range']:5} "
              f"{s['duration']:9} {s['durationUnit']:7} {s['strainMod']:>3} {s['strainPerTarget']} {int(s['strainPerAP'])} "
              f"{s['skill']:10} {int(s['exsurgent'])} {len(s['description']):5} {d['effects'] and 'FX' or ''}")
