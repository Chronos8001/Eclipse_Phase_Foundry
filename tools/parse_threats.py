"""Build NPC actors from the creature and threat stat blocks of the Eclipse Phase books.

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_threats.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext -raw gives these multi-column stat blocks in reading order:
    NAME / Threat Level / Numbers / (description) / COG COO INT REF SAV SOM / values / WIL INIT SPD DUR WT DR / values /
    attacks ("Bite: 50, DV 2d10 + 8, AP -4") / Fray/Armor / Perception / Move / Skills / Ware / Traits / Stress Test / ...
Each block becomes an NPC: aptitudes, an embedded morph (DUR, armor, movement, implants, traits), skills with their
ranks and specializations, and one weapon per attack, with the attack rating of the block.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = "threats"

SOURCES = [
    {"file": "eclipse phase x-risks.pdf", "book": "X-Risks", "offset": 2, "pages": (98, 157), "folder": "Threat Recognition Guide"},
    {"file": "eclipse phase x-risks.pdf", "book": "X-Risks", "offset": 2, "pages": (158, 165), "folder": "Critter Catalog",
     "flavor": False},
]

APT = ["cog", "coo", "int", "ref", "sav", "som", "wil"]
HEADER = re.compile(r"^COG COO INT REF SAV SOM")
STATS = re.compile(r"^WIL INIT SPD DUR WT DR")
NAME = re.compile(r"^[A-Z0-9][A-Z0-9 :'’/()&,.-]{2,50}$")
LABEL = re.compile(r"^([A-Z][A-Za-z’'/()& -]{1,40}):\s*(.*)$")
# EyeChat comments: "Pivo nThe Hidden Concern..."
COMMENT = re.compile(r"^[\w’'.-]+(?: [\w’'.-]+)? n[A-Z]")
JUNK = re.compile(r"^(\d{1,3}|(\.\d)+.*|GAME INFORMATION|Critter Catalog|TY.*E.*|FACINGTHE REAPER|ACTIVETHREAT REPORTS|THREAT RECOGNITION GUIDE|CRITTER CATALOG|The following creatures include .*)$")
NAME_FIXES = {"Self-Replicatingnanoswarm": "Self-Replicating Nanoswarm"}
KNOWN = {"Threat Level", "Numbers", "Niche", "Fray/Armor", "Perception", "Move", "Skills", "Ware", "Common Ware", "Traits",
         "Stress Test", "Notes", "Gear", "Common Psi Sleights", "Psi Sleights", "Sleights", "Duration"}


def skill_tables():
    names = json.load(open(os.path.join(ROOT, "lang", "en.json"), encoding="utf8"))["EP1E"]["Skill"]
    config = open(os.path.join(ROOT, "module", "config.mjs"), encoding="utf8").read()
    skills = {k: (a, c) for k, a, c in re.findall(r'(\w+): \{ aptitude: "(\w+)", category: "(\w+)"', config)}
    by_name = {names[k].lower(): k for k in skills if k in names}
    by_name.update({"exotic melee": "exoticMelee", "exotic ranged": "exoticRanged", "interests": "interest",
                    "free fall": "freeFall", "professional": "profession", "free-fall": "freeFall"})
    return skills, by_name


SKILLS, SKILL_NAMES = skill_tables()


def raw_pages(source):
    first, last = source["pages"]
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-raw", "-f", str(first), "-l", str(last),
                           os.path.join(FOLDER, source["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
    pages = []
    for n, page in enumerate(text.split("\f")):
        lines = [re.sub(r"[\x00-\x1f]", "", l).strip() for l in page.split("\n")]
        pages.append((first + n - source["offset"], [l for l in lines if l and not JUNK.match(l)]))
    return pages


def join(parts):
    text = ""
    for l in parts:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text)


def title(caps):
    small = {"and", "of", "the", "or", "to", "in", "for", "a", "an", "with"}
    words = caps.lower().split()
    name = " ".join(w if (i and w in small) else re.sub(r"^([^a-z]*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
                    for i, w in enumerate(words))
    name = re.sub(r"([-/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), name)
    return re.sub(r"\b(Titan|Ai|Agi|Ii|Iii)\b", lambda m: m.group(1).upper(), name).replace("Mark II", "Mark II")


def is_name(line):
    """A block name: a capitalized line ("GUARDIAN: BRUTE" too), not a label line."""
    return bool(NAME.match(line)) and (line.isupper() or not LABEL.match(line))


def is_caps(line):
    """A sidebar or heading line ("BARBED EEL", "TYPE", "NICHE", "DROPLET’S OCEANS")."""
    return len(re.findall(r"[A-Z]", line)) >= 2 and not re.search(r"[a-z]", line)


# Words of the rules text: prose without them, after the last field of a block, is the creature's description
GAME_TERMS = re.compile(r"\bDV\b|\bAP\b|Test\b|Action Turn|\b(?:SOM|COO|WIL|REF|INT|COG|SAV)\b|modifier|\d+%|\(p\.|\d*d10")


def split_prose(body):
    """(body, trailing prose) of a block whose last field runs into the description printed after it."""
    stats_at = next((i for i, l in enumerate(body) if STATS.match(l)), len(body))
    for i in range(stats_at + 3, len(body) - 2):
        rest = body[i:]
        if re.search(r"[.”)]$", body[i - 1]) and re.match(r"^[A-Z“]", body[i]) and \
                not any(LABEL.match(l) or GAME_TERMS.search(l) for l in rest):
            return body[:i], rest
    return body, []


def comment_ends(comment, line, following):
    """Whether a line after an EyeChat comment starts the description: a new paragraph after a sentence end, narrower
    than a full-width comment or after a short last line, and followed by more prose (else it ends the comment)."""
    if not comment or not re.search(r"[.!?”)]$", comment[-1]) or not re.match(r"^[A-Z“]", line):
        return False
    if not following or is_caps(following) or COMMENT.match(following) or HEADER.match(following):
        return False
    width = max(len(l) for l in comment)
    return (width >= 65 and len(line) < 60) or len(comment[-1]) < 0.75 * width


def blocks(source):
    """[{name, page, header lines, body lines, flavor}] of a source, in order.

    The pages are read as one stream of lines, cut into segments: stat blocks (from the name to the first EyeChat
    comment, sidebar or next block), EyeChat comments, sidebars and description paragraphs. A block's flavor is the
    description printed on its page, or on a neighboring page without stat blocks."""
    stream = [(page, l) for page, lines in raw_pages(source) for l in lines]
    lines = [l for _, l in stream]
    starts = [i for i, l in enumerate(lines) if HEADER.match(l)]
    names = {}
    for k, s in enumerate(starts):
        floor = starts[k - 1] if k else -1
        n = next((j for j in range(s - 1, floor, -1) if is_name(lines[j])), s)
        names[n] = k
    out, paragraphs, current, i = [], [], None, 0
    while i < len(lines):
        page, line = stream[i]
        if i in names:
            k = names[i]
            s = starts[k]
            nxt = next((n for n, m in names.items() if m == k + 1), len(lines))
            name = title(line) if i < s else "?"
            block = {"name": NAME_FIXES.get(name, name), "page": stream[s][0], "header": lines[i + 1:s], "body": [],
                     "folder": source["folder"], "book": source["book"]}
            j = s
            while j < nxt and not COMMENT.match(lines[j]) and not (j > s + 3 and is_caps(lines[j])):
                # A new page that opens with a new paragraph holds the description of the next creature
                if j > s and stream[j][0] != stream[j - 1][0] and re.search(r"[.)]$", lines[j - 1]) and \
                        re.match(r"^[A-Z“]", lines[j]) and not LABEL.match(lines[j]):
                    break
                block["body"].append(lines[j])
                j += 1
            out.append(block)
            current, i = None, j
            continue
        following = lines[i + 1] if i + 1 < len(lines) else ""
        if COMMENT.match(line):
            current = ("comment", [line])
        elif is_caps(line):
            current = None
        elif current and current[0] == "comment" and not comment_ends(current[1], line, following):
            current[1].append(line)
        elif current and current[0] == "prose":
            current[1][1].append(line)
        else:
            current = ("prose", [page, [line]])
            paragraphs.append(current[1])
        i += 1
    # Descriptions printed after the last field of a block
    for block in out:
        block["body"], rest = split_prose(block["body"])
        if rest:
            paragraphs.append([block["page"], rest])
    with_blocks = {b["page"] for b in out}
    for block in out:
        page, found = block["page"], []
        for p in (page, page - 1, page + 1):
            if p == page or p not in with_blocks:
                found = [x for x in paragraphs if x[0] == p]
            if found:
                break
        block["flavor"] = [join(x[1]) for x in found] if source.get("flavor", True) else []
    return out


def fields(lines):
    """[(label, text)] of label lines, each with its continuation lines."""
    out = []
    for l in lines:
        m = LABEL.match(l)
        if m and not re.match(r"^(EP|p)\b", m.group(1)):
            out.append([m.group(1).strip(), m.group(2)])
        elif out:
            out[-1][1] = join([out[-1][1], l])
        else:
            out.append(["", l])
    return [(k, v.strip()) for k, v in out]


def header_fields(lines):
    """[(label, text)] of the lines between a block's name and its aptitudes: an optional type line ("Xenofauna"),
    labels (a short line continues the one above: "Numbers: 1–4 / per victim") and the description ("", text)."""
    out, desc = [], []
    for l in lines:
        m = LABEL.match(l)
        short = len(l.split()) <= 4 and not l.endswith(".")
        if is_caps(l) and not m:
            continue
        if desc:
            desc.append(l)
        elif m:
            out.append([m.group(1).strip(), m.group(2)])
        elif short and not out:
            out.append(["Type", l])
        elif short:
            out[-1][1] = join([out[-1][1], l])
        else:
            desc.append(l)
    return [(k, v.strip()) for k, v in out] + ([("", join(desc))] if desc else [])


def skill_item(name, value, apt_values, specialization=""):
    """Skill item data from a stat block entry ("Unarmed Combat 40", field skills "Exotic Melee: Tentacles 50")."""
    field = ""
    m = re.match(r"^([^:]+):\s*(.+)$", name)
    if m:
        name, field = m.group(1).strip(), m.group(2).strip()
    key = SKILL_NAMES.get(name.lower(), "")
    aptitude, category = SKILLS.get(key, ("cog" if not key else "cog", "knowledge" if field else "active"))
    ranks = max(0, value - apt_values.get(aptitude, 0)) if key else value
    return {
        "name": name if not key else name, "type": "skill",
        "img": "icons/svg/book.svg" if category == "knowledge" else "icons/svg/d20-black.svg",
        "system": {"key": key, "aptitude": aptitude, "category": category, "field": field, "ranks": ranks, "mod": 0,
                   "specialization": specialization, "noDefault": False, "description": ""},
    }


def parse_skills(text, apt_values):
    items = []
    for part in re.split(r",\s*(?![^()]*\))", text):
        m = re.match(r"^(.+?)\s+(\d+)(?:\s*\(([^)]*?)\s*(\d+)?\))?\.?$", part.strip())
        if m:
            items.append(skill_item(m.group(1), int(m.group(2)), apt_values, (m.group(3) or "").strip()))
    return items


def parse_attack(name, text):
    """Weapon item data from an attack line ("Bite: 50, DV 2d10 + 8, AP −4; ..."), or None."""
    dv = re.search(r"DV\s*(\(?\d*d10[^,;.]*?(?:\)\s*[+−–-]\s*\d+)?)(?=[,;.]|$|\s+(?:AP|armor|per|and|\())", text) or \
        re.search(r"(\(?\d*d10[^,;]*?)\s+DV", text)
    if not dv:
        return None
    formula = dv.group(1).replace("÷", "/").replace("−", "-").replace("–", "-").strip()
    formula = re.sub(r"\(\s*(\d*d10)\s*/\s*2\s*\)", r"ceil(\1 / 2)", formula)
    if re.match(r"^\d*d10\s*/\s*2", formula):
        formula = re.sub(r"^(\d*d10)\s*/\s*2", r"ceil(\1 / 2)", formula)
    rating = re.match(r"^(\d+)", text)
    # Attack ratings are skill levels (10+); "Time: 1 Action Turn" and the like are not attacks
    if not (rating and int(rating.group(1)) >= 10) and not text.lower().startswith("no defense"):
        return None
    # Keep the dice expression only ("1d10 + 4 for 3 Action Turns" -> "1d10 + 4")
    clean = re.match(r"(ceil\(\d*d10 / 2\)|\d*d10)((?:\s*[+-]\s*\d+(?:d10)?)*)", formula)
    if not clean:
        return None
    formula = (clean.group(1) + clean.group(2)).strip()
    ap = re.search(r"AP\s*([+−–-]?\s*\d+)", text)
    ranged = bool(re.search(r"range|Range|spit|Spit|ranged|meters", text)) or name.lower() in {"acid spit", "stunner", "shredder"}
    label = re.sub(r"\s+Attack$", "", name)
    return {
        "name": label, "type": "weapon", "img": "icons/svg/claw.svg" if not ranged else "icons/svg/target.svg",
        "system": {"weaponType": "ranged" if ranged else "melee", "skill": "exoticRanged" if ranged else "unarmedCombat",
                   "rating": int(rating.group(1)) if rating else 0, "ap": int(ap.group(1).replace("−", "-").replace("–", "-").replace(" ", "")) if ap else 0,
                   "dv": formula, "damageType": "kinetic", "addDB": False, "modes": "", "range": "",
                   "ammo": {"value": 0, "max": 0, "loaded": "", "size": ""}, "equipped": True,
                   "shock": "shock" in text.lower(), "area": {"shape": "none", "radius": 0, "falloff": 2}, "twoHanded": False,
                   "cost": "", "quantity": 1, "munition": {"kind": "none", "size": "standard"}, "launcher": "",
                   "description": f"<p>{html.escape(name, quote=False)}: {html.escape(text, quote=False)}</p>"},
    }


def numbers(line):
    """Values of a stat row; a dash or NA (no value) counts as 0."""
    return [int(x) if x.isdigit() else 0 for x in re.findall(r"\d+|—|NA", line)]


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def actor(block, folder):
    body = block["body"]
    apts = numbers(body[1]) if len(body) > 1 else []
    stats_at = next((i for i, l in enumerate(body) if STATS.match(l)), None)
    if len(apts) < 6 or stats_at is None:
        raise SystemExit(f"{block['name']} (p. {block['page']}): unreadable aptitudes")
    derived = numbers(body[stats_at + 1])
    if len(derived) < 6:
        raise SystemExit(f"{block['name']} (p. {block['page']}): unreadable WIL/INIT/SPD/DUR/WT/DR")
    wil, init, spd, dur, wt, dr = derived[:6]
    values = dict(zip(APT, apts[:6] + [wil]))
    info = header_fields(block["header"])
    stat_fields = fields(body[stats_at + 2:])
    get = lambda label: next((v for k, v in stat_fields + info if k == label), "")

    items, attacks, specials = [], [], []
    for k, v in stat_fields:
        if k in KNOWN or not k:
            continue
        weapon = parse_attack(k, v)
        if weapon:
            attacks.append(weapon)
        else:
            specials.append((k, v))
    # Fray and armor ("30, 12/8"; "30, Frayed Vacsuit 5/5")
    fray_armor = get("Fray/Armor")
    fray = re.match(r"^(\d+)", fray_armor)
    # "20 (40)/20": the parenthesized value is against blasts (see the block's notes)
    armor = re.search(r"(\d+)(?:\s*\(\d+\))?\s*/\s*(\d+)", fray_armor)
    energy, kinetic = (int(armor.group(1)), int(armor.group(2))) if armor else (0, 0)
    skills = parse_skills(get("Skills"), values)
    if fray and not any(s["system"]["key"] == "fray" for s in skills):
        skills.append(skill_item("Fray", int(fray.group(1)), values))
    perception = re.match(r"^(\d+)(?:,\s*(\d+)\s+(.+))?", get("Perception"))
    if perception and not any(s["system"]["key"] == "perception" for s in skills):
        skills.append(skill_item("Perception", int(perception.group(1)), values, (perception.group(3) or "").strip()))
    synthetic = (dur > 0) and (dr == dur * 2)
    morph = {
        "name": f"{block['name']} (body)", "type": "morph", "img": "icons/svg/pawprint.svg",
        "system": {"morphType": "infomorph" if dur == 0 else ("synthmorph" if synthetic else "biomorph"),
                   "aptitudeMax": {k: 40 for k in APT}, "aptitudeBonus": {k: 0 for k in APT}, "durability": dur,
                   "speedMod": max(0, spd - 1), "initMod": 0, "armor": {"energy": energy, "kinetic": kinetic},
                   "movement": get("Move"), "implants": get("Ware") or get("Common Ware"), "advantages": get("Traits"),
                   "disadvantages": "", "skillBonuses": [], "cpCost": 0, "creditCost": "", "active": True, "description": ""},
    }
    items = [morph] + skills + attacks

    lines = [f"<p><strong>{html.escape(k)}:</strong> {html.escape(v)}</p>" for k, v in info if k]
    lines += [f"<p>{html.escape(join([l for k, l in info if not k]))}</p>"] if any(not k for k, _ in info) else []
    lines += [f"<p>{html.escape(t)}</p>" for t in block["flavor"]]
    # A description printed between the stats and the attacks
    lines += [f"<p>{html.escape(v)}</p>" for k, v in stat_fields if not k]
    for label in ("Stress Test", "Traits", "Ware", "Common Ware", "Gear", "Notes", "Common Psi Sleights", "Psi Sleights", "Sleights"):
        if get(label):
            lines.append(f"<p><strong>{label}:</strong> {html.escape(get(label))}</p>")
    lines += [f"<p><strong>{html.escape(k)}:</strong> {html.escape(v)}</p>" for k, v in specials]
    lines.append(f"<p><em>Initiative printed: {init} (X-Risks uses (INT + REF) ÷ 5); Wound Threshold {wt}, Death Rating {dr}.</em></p>")
    lines.append(f"<p><em>Source: Eclipse Phase {block['book']}, p. {block['page']}.</em></p>")

    _id = make_id(block["book"], block["folder"], block["name"])
    # Wound Threshold as printed: the morph gives DUR ÷ 5 (round up)
    wt_mod = wt - -(-dur // 5)
    system = {
        "aptitudes": {k: {"base": v, "mod": 0} for k, v in values.items()},
        "moxie": {"value": 0, "max": 0}, "damage": {"value": 0}, "wounds": {"value": 0}, "stress": {"value": 0},
        "trauma": {"value": 0}, "mods": {"wt": wt_mod}, "biography": "".join(lines), "notes": "",
    }
    for i, item in enumerate(items):
        item["_id"] = make_id(_id, item["type"], item["name"], str(i))
        item["_key"] = f"!actors.items!{_id}.{item['_id']}"
        item.update({"effects": [], "flags": {}, "folder": None, "sort": (i + 1) * 1000, "ownership": {"default": 0}})
    return {
        "_id": _id, "_key": f"!actors!{_id}", "name": block["name"], "type": "npc", "img": "icons/svg/pawprint.svg",
        "system": system, "items": items, "effects": [], "folder": folder, "sort": 0, "flags": {}, "ownership": {"default": 0},
        "prototypeToken": {"name": block["name"], "actorLink": False, "bar1": {"attribute": "damage"},
                           "bar2": {"attribute": "stress"}, "disposition": -1, "displayBars": 20,
                           "texture": {"src": "icons/svg/pawprint.svg"}},
    }


def build():
    folders, docs = {}, []
    for source in SOURCES:
        fid = make_id("folder", source["book"], source["folder"])
        folders[fid] = {"_id": fid, "_key": f"!folders!{fid}", "name": source["folder"], "type": "Actor", "folder": None,
                        "sorting": "a", "sort": (len(folders) + 1) * 1000, "color": None, "flags": {}, "description": ""}
        for block in blocks(source):
            doc = actor(block, fid)
            doc["sort"] = (len(docs) + 1) * 1000
            docs.append(doc)
    return list(folders.values()), docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for x in folders:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"_folder-{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"{slug}-{x['_id'][:6]}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs))


if __name__ == "__main__":
    folders, docs = build()
    write(folders, docs)
    if "--summary" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        for x in docs:
            morph = x["items"][0]["system"]
            skills = [i for i in x["items"] if i["type"] == "skill"]
            weapons = [f"{i['name']} {i['system']['rating']} {i['system']['dv']} AP{i['system']['ap']}" for i in x["items"] if i["type"] == "weapon"]
            apts = " ".join(str(x["system"]["aptitudes"][k]["base"]) for k in APT)
            print(f"{x['name'][:26]:26} {apts:22} DUR {morph['durability']:>3} {morph['armor']['energy']}/{morph['armor']['kinetic']} "
                  f"{morph['morphType'][:5]} sk{len(skills):>2} | {'; '.join(weapons)[:110]}")
