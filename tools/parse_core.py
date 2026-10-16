"""Parse traits from the EP1e core rulebook into Foundry pack sources.

Usage: python -I tools/parse_core.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source
(Morphs come from the Morph Recognition Guide: see tools/parse_mrg.py.)
"""
import hashlib, json, re, subprocess, sys, os, html

PDF = sys.argv[1]     # Core Rulebook PDF
OUT = sys.argv[2]     # packs/_source dir
FIRST_PAGE, LAST_PAGE = 144, 155  # PDF pages of the Traits section
OFFSET = 2            # PDF page - printed page


JUNK = re.compile(r"^(\.\d)+|^(Synopsis|A Time of Eclipse|Action and Combat|Accelerated Future|Running the Game|character creation|EXAMPLE|\d{3})\b")

def clean_lines():
    """Text lines of the Traits section, each with the printed page it comes from."""
    out = []
    for p in range(FIRST_PAGE, LAST_PAGE + 1):
        text = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), PDF, "-"], capture_output=True).stdout
        for line in text.decode("utf-8", errors="replace").split("\n"):
            line = line.strip()
            if line and not JUNK.search(line):
                out.append((line, p - OFFSET))
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
    tagged = clean_lines()
    lines = [l for l, _ in tagged]
    pages = [p for _, p in tagged]
    start = lines.index("Positive Traits")
    end = lines.index("Character Advancement")
    lines, pages = lines[start:end], pages[start:end]
    entries, polarity = [], "positive"
    i = 0
    while i < len(lines):
        l = lines[i]
        if l == "Negative Traits":
            polarity = "negative"
        m = re.match(r"^(Cost|Bonus): (.*)$", l)
        if m:
            name = lines[i - 1]
            entries.append({"name": name, "polarity": polarity, "first": m.group(2), "body": [], "page": pages[i - 1]})
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
        words = re.sub(r"[^A-Za-z0-9 ]+", " ", name).split()
        system = {
            # Rules find traits by key (psi, psiDefense...) rather than by their displayed name
            "key": words[0].lower() + "".join(w.capitalize() for w in words[1:]),
            "traitType": e["polarity"],
            "scope": scope,
            "level": 1,
            "cost": costs[0] if costs else 0,
            "costText": f"{'Cost' if e['polarity'] == 'positive' else 'Bonus'}: {cost_txt}".replace("�", "-"),
            "description": f"<p>{html.escape(join([desc_start] + body), quote=False)}</p>"
                           f"<p><em>Source: Eclipse Phase Core Rulebook, p. {e['page']}.</em></p>",
        }
        img = "icons/svg/upgrade.svg" if e["polarity"] == "positive" else "icons/svg/downgrade.svg"
        docs.append(doc(name, "trait", img, system, "traits", (n + 1) * 1000))
    write("traits", docs)

parse_traits()
