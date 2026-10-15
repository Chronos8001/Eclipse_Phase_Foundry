"""Parse traits from the EP1e core rulebook into Foundry pack sources.

Usage: pdftotext -f 144 -l 155 "Eclipse Phase - Core Rulebook.pdf" <dir>/traits_raw.txt
       python -I tools/parse_core.py <dir> packs/_source
(Morphs come from the Morph Recognition Guide: see tools/parse_mrg.py.)
"""
import hashlib, json, re, sys, os, html

TXT = sys.argv[1]     # dir with traits_raw.txt
OUT = sys.argv[2]     # packs/_source dir


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

parse_traits()
