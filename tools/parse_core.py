"""Parse morphs and traits from the EP1e core rulebook text extraction into Foundry pack sources."""
import hashlib, json, re, sys, os, html

TXT = sys.argv[1]     # dir with morphs_raw.txt / traits_raw.txt
OUT = sys.argv[2]     # packs/_source dir

APTS = ["cog", "coo", "int", "ref", "sav", "som", "wil"]

JUNK = re.compile(r"^(\.\d)+|^(Synopsis|A Time of Eclipse|Action and Combat|Accelerated Future|Running the Game|character creation|EXAMPLE|\d{3})\b")

def clean_lines(path):
    out = []
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.rstrip("\n").strip()
        if not line or JUNK.search(line):
            continue
        out.append(line)
    return out

def join(lines):
    text = ""
    for l in lines:
        if text.endswith("-") and not text.endswith(" -"):
            text = text[:-1] + l
        else:
            text = (text + " " + l).strip()
    return text.replace("�", "-").replace("--", "—")

def make_id(name, salt):
    return hashlib.sha1(f"{salt}:{name}".encode()).hexdigest()[:16]

def doc(name, type_, img, system, pack, sort):
    _id = make_id(name, pack)
    return {
        "_id": _id, "_key": f"!items!{_id}", "name": name, "type": type_, "img": img,
        "system": system, "effects": [], "flags": {}, "folder": None, "sort": sort,
        "ownership": {"default": 0},
    }

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

# ---------------------------------------------------------------- Morphs
MORPHS = [
    ("Flats", "biomorph"), ("Splicers", "biomorph"), ("Exalts", "biomorph"), ("Mentons", "biomorph"),
    ("Olympians", "biomorph"), ("Sylphs", "biomorph"), ("Bouncers", "biomorph"), ("Furies", "biomorph"),
    ("Futuras", "biomorph"), ("Ghosts", "biomorph"), ("Hibernoids", "biomorph"), ("Neotenics", "biomorph"),
    ("Remade", "biomorph"), ("Rusters", "biomorph"), ("Neo-Avians", "biomorph"), ("Neo-Hominids", "biomorph"),
    ("Octomorphs", "biomorph"), ("Pleasure Pods", "pod"), ("Worker Pods", "pod"), ("Novacrab", "pod"),
    ("Case", "synthmorph"), ("Synth", "synthmorph"), ("Arachnoids", "synthmorph"), ("Dragonfly", "synthmorph"),
    ("FlexBots", "synthmorph"), ("Reaper", "synthmorph"), ("Slitheroids", "synthmorph"), ("Swarmanoid", "synthmorph"),
    ("Infomorphs", "infomorph"),
]
SECTION_BREAKS = {"Pods", "Synthetic Morphs", "Traits", "Biomorphs"}
LABELS = ["Implants", "Enhancements", "Mobility System (Movement Rate)", "Mobility System", "Aptitude Maximum",
          "Speed Modifier", "Durability", "Wound Threshold", "Advantages", "Disadvantages", "CP Cost", "Credit Cost"]
SKILL_KEYS = {"climbing": "climbing", "swimming": "swimming", "flight": "flight"}
IMG = {"biomorph": "icons/svg/mystery-man.svg", "pod": "icons/svg/mystery-man-black.svg",
       "synthmorph": "icons/svg/cog.svg", "infomorph": "icons/svg/daze.svg"}

def parse_morphs():
    lines = clean_lines(os.path.join(TXT, "morphs_raw.txt"))
    names = [m[0] for m in MORPHS]
    blocks, cur = {}, None
    for l in lines:
        if l in names:
            cur = l; blocks[cur] = []; continue
        if l in SECTION_BREAKS or l.startswith("All synthmorphs have"):
            cur = None
            continue
        if cur:
            blocks[cur].append(l)
    docs = []
    label_re = "|".join(re.escape(x) for x in LABELS)
    for i, (name, mtype) in enumerate(MORPHS):
        text = join(blocks[name])
        # Strip the trailing general section intros that sneak into a block
        text = re.split(r" (?:Synthetic morphs are completely|Pods \(from|Positive traits provide|Unless otherwise noted)", text)[0]
        parts = re.split(rf"\b({label_re}):", text)
        desc = parts[0].strip()
        fields = {}
        for k in range(1, len(parts), 2):
            fields.setdefault(parts[k].replace(" (Movement Rate)", ""), parts[k + 1].strip())
        adv = fields.get("Advantages", "")
        bonus = {a: 0 for a in APTS}
        for val, apt in re.findall(r"([+-]\d+) (COG|COO|INT|REF|SAV|SOM|WIL)\b", adv):
            bonus[apt.lower()] += int(val)
        dis = fields.get("Disadvantages", "")
        amax_txt = fields.get("Aptitude Maximum", "30")
        nums = [int(n) for n in re.findall(r"\d+", amax_txt)]
        amax = {a: nums[0] if nums else 30 for a in APTS}
        m = re.search(r"(\d+) \(SOM\), (\d+)", amax_txt)
        if m:
            amax = {a: int(m.group(2)) for a in APTS}; amax["som"] = int(m.group(1))
        m = re.search(r"(\d+) \((\d+) SOM\)", amax_txt)
        if m:
            amax = {a: int(m.group(1)) for a in APTS}; amax["som"] = int(m.group(2))
        dur = re.match(r"\d+", fields.get("Durability", "0"))
        armor = {"energy": 0, "kinetic": 0}
        am = re.search(r"Armor \(?(\d+)/(\d+)\)?", adv)
        if am:
            armor = {"energy": int(am.group(1)), "kinetic": int(am.group(2))}
        if "Bioweave Armor (Light)" in fields.get("Implants", ""):
            armor = {"energy": 2, "kinetic": 3}
        spd = re.match(r"[+-]?\d+", fields.get("Speed Modifier", "0"))
        skills = [{"key": SKILL_KEYS[s.lower()], "value": int(v)}
                  for v, s in re.findall(r"\+(\d+) (Climbing|Swimming|Flight) skill", adv)]
        cp = re.match(r"\d+", fields.get("CP Cost", "0"))
        system = {
            "morphType": mtype,
            "aptitudeMax": amax,
            "aptitudeBonus": bonus,
            "durability": int(dur.group()) if dur else 0,
            "speedMod": int(spd.group()) if spd else 0,
            "initMod": 0,
            "armor": armor,
            "movement": fields.get("Mobility System", ""),
            "implants": fields.get("Implants") or fields.get("Enhancements", ""),
            "advantages": adv,
            "disadvantages": dis,
            "skillBonuses": skills,
            "cpCost": int(cp.group()) if cp else 0,
            "creditCost": fields.get("Credit Cost", ""),
            "active": False,
            "description": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: Eclipse Phase Core Rulebook.</em></p>",
        }
        docs.append(doc(name, "morph", IMG[mtype], system, "morphs", (i + 1) * 1000))
    write("morphs", docs)
    return docs

# ---------------------------------------------------------------- Traits
def parse_traits():
    lines = clean_lines(os.path.join(TXT, "traits_raw.txt"))
    start = lines.index("Positive Traits")
    end = lines.index("Character Advancement")
    lines = lines[start:end]
    entries, polarity = [], "positive"
    i = 0
    while i < len(lines):
        l = lines[i]
        if l == "Negative Traits":
            polarity = "negative"
        m = re.match(r"^(Cost|Bonus): (.*)$", l)
        if m:
            name = lines[i - 1]
            entries.append({"name": name, "polarity": polarity, "first": m.group(2), "body": [], "nameIdx": i - 1})
        elif entries:
            entries[-1]["body"].append(l)
        i += 1
    docs = []
    for n, e in enumerate(entries):
        # The next trait's name ended up in this body: drop it
        body = e["body"]
        if n + 1 < len(entries) and body and body[-1] == entries[n + 1]["name"]:
            body = body[:-1]
        if body and body[-1] == "Negative Traits":
            body = body[:-1]
        first = e["first"]
        cm = re.match(r"^(.*CP(?: \([^)]*\))?)\s+(.*)$", first) or re.match(r"^(\d+)\s+(.*)$", first)
        cost_txt, desc_start = (cm.group(1), cm.group(2)) if cm else (first, "")
        name = e["name"].replace(chr(0xfffd), "-")
        scope = "ego"
        sm = re.search(r"\s*\((Ego or Morph|Morph) Trait\)$", name)
        if sm:
            scope = "both" if sm.group(1) == "Ego or Morph" else "morph"
            name = name[: sm.start()]
        costs = [int(x) for x in re.findall(r"\d+", cost_txt)]
        system = {
            "traitType": e["polarity"],
            "scope": scope,
            "level": 1,
            "cost": costs[0] if costs else 0,
            "costText": f"{'Cost' if e['polarity'] == 'positive' else 'Bonus'}: {cost_txt}".replace("�", "-"),
            "description": f"<p>{html.escape(join([desc_start] + body), quote=False)}</p><p><em>Source: Eclipse Phase Core Rulebook.</em></p>",
        }
        img = "icons/svg/upgrade.svg" if e["polarity"] == "positive" else "icons/svg/downgrade.svg"
        docs.append(doc(name, "trait", img, system, "traits", (n + 1) * 1000))
    write("traits", docs)

parse_morphs()
parse_traits()
