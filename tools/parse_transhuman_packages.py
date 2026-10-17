"""Build the character creation packages of Transhuman (pp. 15-41) as items to drop on a character, one per level.

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_transhuman_packages.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext -raw gives each package as its name in capitals, its description, "Suggested Motivations: ...", then its
levels (1, 3 and 5 PP; 1 and 3 for factions; 1 for customizations) one after the other. In each level's column the
Moxie, aptitude and Rep bonuses come first, then the skills, then the traits, sleights and credit: so a leading bonus
after a skill list opens the next level, and a trailing one closes the current level.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = "backgrounds"
PDF = "eclipse phase transhuman.pdf"
PAGES, OFFSET = (18, 44), 3
SECTIONS = {"BACKGROUND PACKAGES": ("background", [1, 3, 5]), "FACTION PACKAGES": ("faction", [1, 3]),
            "FOCUS PACKAGES": ("focus", [1, 3, 5]), "CUSTOMIZATION PACKAGES": ("customization", [1])}
# Headings after the last customization package
END = {"FIELD SKILLS", "APTITUDES AND SKILLS", "MORPH APTITUDE BONUSES", "PURCHASE MORPH AND GEAR", "COMBINE EVERYTHING",
       "CUSTOMIZE"}
APT = {"COG": "cog", "COO": "coo", "INT": "int", "REF": "ref", "SAV": "sav", "SOM": "som", "WIL": "wil"}
REP = {"@": "at", "c": "c", "e": "e", "f": "f", "g": "g", "i": "i", "r": "r"}
JUNK = re.compile(r"^(pp|(\.\d)+.*|\d(\.\d)+.*|MORPHS|PLAYING CHARACTERS|CHARACTER CREATION:? ?PACKAGES|CHARACTER OPTIONS|"
                  r"(CHAR)?ACTER CREATION: LIFE PATH|TER CREATION:.*|CREATION: ?PACKAGES|PACKAGE LIST)$")


def skill_names():
    names = json.load(open(os.path.join(ROOT, "lang", "en.json"), encoding="utf8"))["EP1E"]["Skill"]
    config = open(os.path.join(ROOT, "module", "config.mjs"), encoding="utf8").read()
    out = {names[k].lower(): k for k in re.findall(r'(\w+): \{ aptitude: "', config) if k in names}
    out.update({"freefall": "freeFall", "free fall": "freeFall", "interests": "interest", "professional": "profession",
                "languages": "language", "academic": "academics"})
    return out


SKILLS = skill_names()


def lines():
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-raw", "-f", str(PAGES[0]), "-l", str(PAGES[1]),
                           os.path.join(FOLDER, PDF), "-"], capture_output=True).stdout.decode("utf-8", "replace")
    out = []
    for n, page in enumerate(text.split("\f")):
        for l in page.split("\n"):
            l = re.sub(r"[\x00-\x1f]", "", l).strip()
            if l and not JUNK.match(l):
                out.append((l, PAGES[0] + n - OFFSET))
    return out


def join(parts):
    text = ""
    for l in parts:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text)


def is_caps(line):
    return len(re.findall(r"[A-Z]", line)) >= 2 and not re.search(r"[a-z]", line)


LEAD = re.compile(r"^\+\d+ (Moxie|COG|COO|INT|REF|SAV|SOM|WIL|Rep|[@a-z]-rep)\b")
TRAIL = re.compile(r"^(Traits?:|\+[\d,]+ [Cc]redits?|\+\d+ (?:[Pp]si[- ]?\w*\s*)?[Ss]leights|.+ trait$)")
# A skill entry's rating ("Fray 20," "Protocol 40", "Free Fall 15*")
RATING = re.compile(r"[A-Za-z)*] \d+\*?(,|$)")


def packages():
    """[{group, levels, name, page, desc, motivations, blocks: [[lines]]}] in book order."""
    tagged = lines()
    texts = [l for l, _ in tagged]
    out, group, levels, current = [], None, None, None
    i = 0
    while i < len(texts):
        line = texts[i]
        if (line in END) and (group == "customization"):
            break
        if line in SECTIONS:
            group, levels = SECTIONS[line]
            current = None
            i += 1
            continue
        if group is None:
            i += 1
            continue
        # A package: its name in capitals (on one or two lines), then its description and motivations
        # (customizations have neither)
        if is_caps(line):
            name, j = line, i + 1
            while j < len(texts) and is_caps(texts[j]) and texts[j] not in SECTIONS:
                name, j = f"{name} {texts[j]}", j + 1
            ahead = texts[j:j + 5]
            if group == "customization" or any(l.startswith("Suggested Motivations:") for l in ahead):
                current = {"group": group, "levels": levels, "name": name, "page": tagged[i][1], "desc": [], "motivations": "",
                           "body": []}
                out.append(current)
                i = j
                continue
        if current is not None:
            if line.startswith("Suggested Motivations:"):
                current["motivations"] = line.split(":", 1)[1].strip()
                current["desc"], current["body"] = current["body"], []
            else:
                current["body"].append(line)
        i += 1
    for p in out:
        notes = [l for l in p["body"] if l.startswith("*")]
        p["desc"] = join(p["desc"] + notes)
        p["blocks"] = split_blocks(p["body"])
        if p["group"] == "customization":
            p["blocks"] = [[x for b in p["blocks"] for x in b]]
    out = [p for p in out if not p["name"].startswith("SKILLS OVER 60")]
    return out


def split_blocks(body):
    """Levels of a package: [[lines of bonuses, skills and traits]]."""
    blocks, current, state = [], [], "lead"
    for line in body:
        # A footnote, or a stray letter of the page layout ("V")
        if line.startswith("*") or re.fullmatch(r"[A-Z]", line):
            continue
        # Running text after a finished skill list belongs to another column (rules beside the last package)
        if (state != "lead") and current and current[-1][0] in ("skills", "trail") and re.search(r"\d\*?$", current[-1][1]) and                 len(line) > 25 and not RATING.search(line) and not LEAD.match(line) and not TRAIL.match(line):
            break
        # A lone number: the rating of a skill list cut after its name ("Research" / "40"); otherwise a page
        # number or a level marker (1, 3, 5)
        if re.fullmatch(r"\d{1,3}", line):
            if state == "skills" and current and current[-1][0] == "skills" and not re.search(r"\d\*?$", current[-1][1]):
                current[-1] = ("skills", f"{current[-1][1]} {line}")
            continue
        if LEAD.match(line):
            if state != "lead":
                blocks.append(current)
                current, state = [], "lead"
            current.append(("bonus", line))
        elif TRAIL.match(line):
            current.append(("trail", line))
            state = "trail"
        elif state == "trail" and not RATING.search(line) and current and current[-1][0] == "trail" and \
                current[-1][1].startswith("Traits"):
            # A trait list running over the next lines ("Traits: Psi (Level 2), Mental" / "Disorder (Choose Two)")
            current[-1] = ("trail", f"{current[-1][1]} {line}")
        else:
            if state == "trail":
                blocks.append(current)
                current = []
            # A skill list ends with its last entry's rating, without a comma ("Protocol 40")
            ended = lambda text: bool(re.search(r"\d\*?$", text))
            if state == "skills" and current and current[-1][0] == "skills" and ended(current[-1][1]):
                # This line starts another level's list
                blocks.append(current)
                current = []
            if current and current[-1][0] == "skills" and not ended(current[-1][1]):
                current[-1] = ("skills", join([current[-1][1], line]))
            else:
                current.append(("skills", line))
            state = "skills"
    if current:
        blocks.append(current)
    return blocks


def skill_entry(text):
    """{key, name, field, value} of "Networking: (Media) 40", "Free Fall* 35", or None for a choice."""
    # "Medicine; Nanomedicine 30" (misprint) is "Medicine: Nanomedicine"
    text = text.strip().replace("*", "").replace(";", ":")
    # A field comes after a colon ("Networking: Media 40", "Disguise: 25") or in parentheses ("Networking (Choose One) 40")
    m = re.match(r"^(?P<name>[A-Za-z][A-Za-z -]*?)\s*(?::\s*(?P<field>[^0-9]*?)|(?P<paren>\([^)]*\)))?\s*(?P<value>\d+)$", text)
    if not m:
        return None
    name, value = m.group("name").strip(), int(m.group("value"))
    field = (m.group("field") or m.group("paren") or "").strip()
    key = SKILLS.get(name.lower())
    if not key:
        return None
    # "(Media)" is a field; "(Choose One)", "(Astrophysics or Engineering)" are the player's choice, kept as printed
    single = re.match(r"^\(([^)]*)\)$", field)
    if single and not re.search(r"choose|\bor\b", single.group(1), re.I):
        field = single.group(1)
    return {"key": key, "name": name, "field": field, "value": value}


def level_data(block):
    data = {"skills": [], "aptitudes": {k: 0 for k in APT.values()}, "moxie": 0, "credit": 0, "rep": 0, "repNetwork": "",
            "traits": [], "choices": []}
    for kind, line in block:
        if kind == "bonus" or (kind == "trail" and not line.startswith("Traits")):
            for part in re.split(r",\s*(?![\d])(?![^()]*\))", line):
                part = part.strip()
                m = re.match(r"^\+(\d+) (COG|COO|INT|REF|SAV|SOM|WIL)$", part)
                # "+5 SAV, 50 Rep (Your Choice)": the plus sign is sometimes missing
                rep = re.match(r"^\+?(\d+) (?:Rep \(Your Choice\)|([@a-z])-rep)$", part)
                credit = re.match(r"^\+([\d,]+) [Cc]redits?$", part)
                if re.match(r"^\+\d+ Moxie$", part):
                    data["moxie"] += int(part.split()[0])
                elif m:
                    data["aptitudes"][APT[m.group(2)]] += int(m.group(1))
                elif rep:
                    data["rep"] += int(rep.group(1))
                    data["repNetwork"] = REP.get(rep.group(2) or "", "")
                elif credit:
                    data["credit"] += int(credit.group(1).replace(",", ""))
                else:
                    data["choices"].append(re.sub(r"\s+trait$", "", part))
        elif kind == "trail":
            sleights = re.search(r"\+\d+ (?:[Pp]si[- ]?\w*\s*)?[Ss]leights.*$", line)
            if sleights:
                data["choices"].append(sleights.group(0))
                line = line[:sleights.start()].strip()
            for t in re.split(r",\s*(?![^()]*\))", line.split(":", 1)[1]):
                t = re.sub(r"\s+trait$", "", t.strip().rstrip("."))
                t = re.sub(r":\s*\(", " (", t)  # "Social Stigma: (Uplift)", once
                lvl = re.match(r"^(.+?) \((?:Level )?(\d)\)$", t)
                detail = re.match(r"^([A-Z][\w ’'-]+?) \((.+)\)$", t)
                if re.search(r"\beither\b|\bor\b", t):
                    data["choices"].append(t)
                elif lvl:
                    data["traits"].append({"name": lvl.group(1), "level": int(lvl.group(2))})
                elif detail:
                    data["traits"].append({"name": detail.group(1), "level": 1})
                    data["choices"].append(f"{detail.group(1)}: {detail.group(2)}")
                elif t:
                    data["traits"].append({"name": t, "level": 1})
        else:
            for part in re.split(r",\s*(?![^()]*\))", line):
                entry = skill_entry(part)
                if entry:
                    data["skills"].append(entry)
                elif part.strip():
                    data["choices"].append(part.strip())
    return data


def title(caps):
    small = {"and", "of", "the", "or", "to", "in", "for", "a", "an", "with"}
    words = caps.lower().split()
    name = " ".join(w if (i and w in small) else re.sub(r"^([^a-z]*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
                    for i, w in enumerate(words))
    name = re.sub(r"([-/:])([a-z])", lambda m: m.group(1) + m.group(2).upper(), name)
    return re.sub(r"\b(Agi|Ai|Xp|Tqz|Pc)\b", lambda m: m.group(1).upper(), name).replace("J−Ing", "Jīng")


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


FOLDERS = {"background": "Background Packages (Transhuman)", "faction": "Faction Packages (Transhuman)",
           "focus": "Focus Packages (Transhuman)", "customization": "Customization Packages (Transhuman)"}
KINDS = {"background": "package", "faction": "package", "focus": "package", "customization": "package"}


def build():
    folders = {k: {"_id": make_id("folder", "transhuman", k), "name": n} for k, n in FOLDERS.items()}
    docs, problems = [], []
    for p in packages():
        name = title(p["name"])
        if len(p["blocks"]) != len(p["levels"]):
            problems.append(f"{name}: {len(p['blocks'])} levels read, {len(p['levels'])} expected")
            continue
        for pp, block in zip(p["levels"], p["blocks"]):
            d = level_data(block)
            text = " · ".join(join([l]) for _, l in block)
            body = (f"<p>{html.escape(p['desc'], quote=False)}</p>" if p["desc"] else "") + \
                (f"<p><strong>Suggested Motivations:</strong> {html.escape(p['motivations'], quote=False)}</p>" if p["motivations"] else "") + \
                f"<p><strong>{pp} PP:</strong> {html.escape(text, quote=False)}</p>" + \
                f"<p><em>Source: Eclipse Phase Transhuman, p. {p['page']}.</em></p>"
            full = f"{name} ({pp} PP)"
            _id = make_id("transhuman", p["group"], full)
            docs.append({
                "_id": _id, "_key": f"!items!{_id}", "name": full, "type": "background", "img": "icons/svg/book.svg",
                "system": {"description": body, "kind": "package", "group": p["group"], "pp": pp, "skills": d["skills"],
                           "aptitudes": d["aptitudes"], "moxie": d["moxie"], "credit": d["credit"], "rep": d["rep"],
                           "repNetwork": d["repNetwork"], "traits": d["traits"], "choices": "; ".join(d["choices"]),
                           "restrictions": "", "morphs": "", "motivations": p["motivations"]},
                "effects": [], "flags": {}, "folder": folders[p["group"]]["_id"], "sort": (len(docs) + 1) * 1000,
                "ownership": {"default": 0}})
    return folders, docs, problems


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.startswith(("transhuman-", "_folder-transhuman")):
            os.remove(os.path.join(d, f))
    for n, (k, f) in enumerate(folders.items()):
        doc = {"_id": f["_id"], "_key": f"!folders!{f['_id']}", "name": f["name"], "type": "Item", "folder": None,
               "sorting": "a", "sort": (n + 3) * 1000, "color": None, "flags": {}, "description": ""}
        with open(os.path.join(d, f"_folder-transhuman-{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", f"transhuman-{x['system']['group']}-{x['name'].lower()}").strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, "(Transhuman)", len(docs))


if __name__ == "__main__":
    folders, docs, problems = build()
    write(folders, docs)
    sys.stdout.reconfigure(encoding="utf-8")
    for p in problems:
        print("PROBLEM", p)
    if "--summary" in sys.argv:
        for x in docs:
            s = x["system"]
            skills = ", ".join(f"{k['name']}{(':' + k['field']) if k['field'] else ''} {k['value']}" for k in s["skills"])
            apt = " ".join(f"{k}+{v}" for k, v in s["aptitudes"].items() if v)
            extra = " ".join(x for x in (s["moxie"] and f"MOX+{s['moxie']}", apt, s["rep"] and f"REP+{s['rep']}{s['repNetwork']}",
                                         s["credit"] and f"CR+{s['credit']}") if x)
            print(f"{s['group'][:4]} {x['name'][:34]:34} {extra:28} {skills[:80]} | T {[t['name'] + str(t['level']) for t in s['traits']]} | C {s['choices'][:60]}")
