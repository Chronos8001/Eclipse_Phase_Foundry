"""Build the backgrounds and factions of the Core Rulebook (pp. 131-134) as items to drop on a character.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_backgrounds.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext (reading order mode) prints each entry as its name, then one paragraph with the description and its
"Advantages: ... Disadvantages: ... Common Morphs: ..." fields. Fixed bonuses ("+20 Networking: Hypercorps skill",
"+1 Moxie", "+10,000 Credit", "Psi trait (Level 1)") become item data; choices ("+10 to two skills of your choice")
and restrictions stay as text.
"""
import hashlib, html, json, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FOLDER, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = "backgrounds"
PDF = "Eclipse Phase - Core Rulebook.pdf"
PAGES, OFFSET = (133, 136), 2
STARTING_CREDIT = 5000

JUNK = re.compile(r"^(\d{1,3}|(\.\d)+.*|character creation|Synopsis Welcome to Firewall|A Time of Eclipse Game .*|"
                  r"Action and Combat Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference)$")


def skill_names():
    names = json.load(open(os.path.join(ROOT, "lang", "en.json"), encoding="utf8"))["EP1E"]["Skill"]
    config = open(os.path.join(ROOT, "module", "config.mjs"), encoding="utf8").read()
    keys = re.findall(r'(\w+): \{ aptitude: "(\w+)"', config)
    out = {names[k].lower(): k for k, _ in keys if k in names}
    out.update({"freefall": "freeFall", "free fall": "freeFall"})
    return out


SKILLS = skill_names()


def lines():
    out = []
    for p in range(PAGES[0], PAGES[1] + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), os.path.join(FOLDER, PDF), "-"],
                              capture_output=True).stdout.decode("utf-8", "replace")
        for l in text.split("\n"):
            l = l.strip()
            if l and not JUNK.match(l):
                out.append((l, p - OFFSET))
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
    """[{kind, name, page, text}] from "Choose Background" to "Spend Free Points"."""
    tagged = lines()
    texts = [l for l, _ in tagged]
    start = texts.index("Choose Background")
    end = texts.index("Spend Free Points")
    kind, out = "background", []
    for i in range(start, end):
        line = texts[i]
        if line == "Choose Faction":
            kind = "faction"
        # An entry: a short name line followed by its paragraph, whose Advantages come within the next lines
        following = texts[i + 1:min(i + 4, end)]
        upto = next((k for k, l in enumerate(following) if "Advantages:" in l), None)
        if len(line.split()) <= 3 and re.match(r"^[A-Z][\w-]+(?: [A-Z][\w-]+)*$", line) and upto is not None and                 not any("Common Morphs:" in l for l in following[:upto]) and                 not re.search(r"(,| and| or)$", texts[i - 1]):
            out.append({"kind": kind, "name": line, "page": tagged[i][1], "lines": []})
        elif out and line not in ("Choose Faction", "Spend Free Points"):
            out[-1]["lines"].append(line)
    for e in out:
        e["text"] = join(e["lines"])
        # The paragraph of the next section's introduction ends the last background
        e["text"] = re.split(r"\s(?=Choose Faction|After choosing your background)", e["text"])[0]
    return out


def parts(text):
    """Items of a list, split on commas and semicolons outside parentheses."""
    # Not inside parentheses, nor in a number ("2,500")
    return [p.strip(" .") for p in re.split(r"(?:,(?!\d{3})|;)\s*(?![^()]*\))", text) if p.strip(" .")]


def skill(text):
    """(key, name, field) of a skill name ("Networking: Hypercorps", "Pilot: Spacecraft", "Fray"), or None."""
    m = re.match(r"^([^:]+?)(?::\s*(.+))?$", text.strip())
    name, field = m.group(1).strip(), (m.group(2) or "").strip()
    key = SKILLS.get(name.lower())
    if not key or "[" in field or " or " in text:
        return None
    return key, name, field


def parse_fields(text):
    adv = re.search(r"Advantages:\s*(.*?)(?=\s*Disadvantages:|$)", text)
    dis = re.search(r"Disadvantages:\s*(.*?)(?=\s*Common Morphs:|$)", text)
    morphs = re.search(r"Common Morphs:\s*(.*)$", text)
    desc = text[:adv.start()].strip() if adv else text
    data = {"skills": [], "traits": [], "moxie": 0, "credit": 0, "rep": 0, "choices": [], "restrictions": []}
    for p in parts(adv.group(1) if adv else ""):
        m = re.match(r"^\+(\d+) (.+?)(?: skill)?$", p)
        if re.match(r"^\+\d+ Moxie$", p):
            data["moxie"] += int(p.split()[0])
        elif re.match(r"^\+[\d,]+ Credit$", p):
            data["credit"] += int(p.split()[0].replace(",", "").replace("+", ""))
        elif re.match(r"^([A-Z].+?) trait(?: \(Level (\d)\))?$", p):
            t = re.match(r"^([A-Z].+?) trait(?: \(Level (\d)\))?$", p)
            data["traits"].append({"name": t.group(1), "level": int(t.group(2) or 1)})
        elif m and skill(m.group(2)) and "your choice" not in p:
            key, name, field = skill(m.group(2))
            data["skills"].append({"key": key, "name": name, "field": field, "value": int(m.group(1))})
        else:
            data["choices"].append(p)
    for p in parts(dis.group(1) if dis else ""):
        credit = re.match(r"^(?:Only )?([\d,]+) Starting Credit", p, re.I)
        rep = re.match(r"^[–−-](\d+) starting Rep$", p, re.I)
        trait = re.match(r"^([A-Z].+?) trait$", p)
        if p == "None":
            continue
        if credit:
            data["credit"] += int(credit.group(1).replace(",", "")) - STARTING_CREDIT
            data["restrictions"].append(p)
        elif rep:
            data["rep"] -= int(rep.group(1))
        elif trait and "(" not in trait.group(1):
            data["traits"].append({"name": trait.group(1), "level": 1})
        else:
            # "Social Stigma (AGI) trait", "Mental Disorder (choose two...) trait": the detail is the player's
            t = re.match(r"^([A-Z].+?) \((.*)\) trait$", p)
            if t:
                data["traits"].append({"name": t.group(1), "level": 1})
                data["choices"].append(f"{t.group(1)}: {t.group(2)}")
            else:
                data["restrictions"].append(p)
    return desc, data, (morphs.group(1).strip() if morphs else "")


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def build():
    folders = {k: {"_id": make_id("folder", k), "name": n} for k, n in (("background", "Backgrounds (Core)"), ("faction", "Factions (Core)"))}
    docs = []
    for n, e in enumerate(entries()):
        desc, d, morphs = parse_fields(e["text"])
        fields = re.search(r"Advantages:.*$", e["text"])
        body = (f"<p>{html.escape(desc, quote=False)}</p>" +
                (f"<p>{html.escape(fields.group(0), quote=False)}</p>" if fields else "") +
                f"<p><em>Source: Eclipse Phase Core Rulebook, p. {e['page']}.</em></p>")
        _id = make_id(e["kind"], e["name"])
        docs.append({
            "_id": _id, "_key": f"!items!{_id}", "name": e["name"], "type": "background",
            "img": "icons/svg/village.svg" if e["kind"] == "background" else "icons/svg/banner.svg",
            "system": {"description": body, "kind": e["kind"], "group": "", "pp": 0, "skills": d["skills"],
                       "aptitudes": {k: 0 for k in ("cog", "coo", "int", "ref", "sav", "som", "wil")},
                       "moxie": d["moxie"], "credit": d["credit"], "rep": d["rep"], "repNetwork": "", "traits": d["traits"],
                       "choices": "; ".join(d["choices"]), "restrictions": "; ".join(d["restrictions"]),
                       "morphs": morphs, "motivations": ""},
            "effects": [], "flags": {}, "folder": folders[e["kind"]]["_id"], "sort": (n + 1) * 1000, "ownership": {"default": 0}})
    return folders, docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.startswith(("core-", "_folder-core")):
            os.remove(os.path.join(d, f))
    for k, f in folders.items():
        doc = {"_id": f["_id"], "_key": f"!folders!{f['_id']}", "name": f["name"], "type": "Item", "folder": None,
               "sorting": "a", "sort": (list(folders).index(k) + 1) * 1000, "color": None, "flags": {}, "description": ""}
        with open(os.path.join(d, f"_folder-core-{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", f"core-{x['system']['kind']}-{x['name'].lower()}").strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, "(Core)", len(docs))


if __name__ == "__main__":
    folders, docs = build()
    write(folders, docs)
    if "--summary" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        for x in docs:
            s = x["system"]
            skills = ", ".join(f"{k['name']}{(': ' + k['field']) if k['field'] else ''} +{k['value']}" for k in s["skills"])
            extra = " ".join(x for x in (s["moxie"] and f"MOX{s['moxie']:+}", s["credit"] and f"CR{s['credit']:+}",
                                         s["rep"] and f"REP{s['rep']:+}") if x)
            print(f"{s['kind'][:3]} {x['name'][:22]:22} {skills[:70]:70} {extra} | T: {[t['name'] for t in s['traits']]}")
            print(f"      choices: {s['choices'][:120]} | restr: {s['restrictions'][:90]} | morphs: {s['morphs'][:40]}")
