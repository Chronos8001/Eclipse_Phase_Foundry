"""Build NPC actors from the Core-style stat blocks of the Eclipse Phase books (creatures and NPCs outside X-Risks).

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_npcs.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext (reading order mode) gives these stat blocks as:
    NAME / (subtitle, Morph:, Motivations:, description) / COG COO INT REF SAV SOM WIL MOX + values /
    INIT SPD LUC TT IR DUR WT DR + values (often one value per line) / fields: Movement Rate, Skills, Implants,
    Traits, Notes, Attacks, "melee"/"ranged" weapon lines, Armor, Appearance, Roleplaying...
A paragraph may hold several fields ("Reputation: ... Traits: ... Implants: ..."): fields are cut on known labels.
Aptitudes may be printed as "+5 (20)" (morph modifier, then the total).

The printed values include the morph's bonuses. When the block names a morph of the compendium ("Morph: Bouncer"),
the NPC sleeves a copy of it, and its ego aptitudes, skill ranks and stat modifiers are what is left once the morph is
taken away, so that the sheet shows the printed totals. Otherwise the NPC gets a "(body)" morph as in parse_threats.py.
Weapons named in the block are copied from the weapon compendiums when found, with the printed DV and AP.
Creatures already reprinted in X-Risks (packs/_source/threats) are skipped: the most recent version wins.
"""
import glob, hashlib, html, json, math, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_threats as threats  # noqa: E402

FOLDER, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = "npcs"

SOURCES = [
    {"file": "Eclipse Phase - Core Rulebook.pdf", "book": "Core Rulebook", "offset": 2, "pages": (362, 387)},
    # Read in content order: the reading order mode mixes the stat blocks of p. 176 with the column beside them
    {"file": "Eclipse Phase gatecrashing.pdf", "book": "Gatecrashing", "offset": 3, "pages": (174, 180), "raw": True},
    {"file": "ep sunward.pdf", "book": "Sunward", "offset": 3, "pages": (174, 181)},
    {"file": "eclipse phase rimward.pdf", "book": "Rimward", "offset": 3, "pages": (199, 202)},
    {"file": "eclipse phase firewall.pdf", "book": "Firewall", "offset": 2, "pages": (172, 174)},
    {"file": "eclipse phase zonestalkers.pdf", "book": "Zone Stalkers", "offset": 2, "pages": (13, 17)},
    {"file": "eclipse phase the devotees.pdf", "book": "The Devotees", "offset": 2, "pages": (15, 29)},
    {"file": "egohunter portrait.pdf", "book": "Ego Hunter", "offset": 0, "pages": (12, 15)},
    {"file": "ep-glory.pdf", "book": "Glory", "offset": 0, "pages": (20, 24)},
    {"file": "ps21806_thestarsourdestination_portrait.pdf", "book": "The Stars Our Destination", "offset": 1,
     "pages": (12, 19)},
]

APT = threats.APT
STAT_WORDS = ["INIT", "SPD", "LUC", "TT", "IR", "DUR", "WT", "DR"]
# The aptitude header, whole or cut by its values ("COG COO" / 15 / 20 / "INT REF SAV SOM WIL MOX", Stars p. 15)
HEADER = re.compile(r"^COG\s+COO(?:\s+INT\s+REF\s+SAV\s+SOM\s+WIL(?:\s+MOX)?)?\b")
APT_LINE = re.compile(r"^((?:(?:COG|COO|INT|REF|SAV|SOM|WIL|MOX)\s*)+)(.*)$")
STAT_HEADER = re.compile(r"^(?:(?:INIT|SPD|LUC|TT|IR|DUR|WT|DR)\s*)+$")
# A value: "20", "—", "+5 (20)" (morph modifier and total), "20 (40)" (with implants), "25 (30" (misprint)
VALUE = re.compile(r"[+–−-]?\s?\d+\s*\(\d+\)?|—\s*\(\d+\)|[+–−-]?\d+|—|--|NA")
VALUES_LINE = re.compile(r"^(?:(?:[+–−-]?\s?\d+\s*\(\d+\)?|—\s*\(\d+\)|[+–−-]?\d+|—|--|NA)\s*)+$")
STAT_LINE = re.compile(r"^((?:(?:INIT|SPD|LUC|TT|IR|DUR|WT|DR)\s*)+)(.*)$")
FIELDS = ["Movement Rate", "Movement", "Mobility System", "Skills", "Active Skills", "Knowledge Skills", "Implants",
          "Additional Implants", "Ware", "Enhancements", "Traits", "Common Traits", "Notes", "Attacks", "Armor", "Gear",
          "Reputation", "Rep", "Roleplaying", "Appearance", "Software", "Suggested Sleights", "Psi Sleights",
          "Sleights", "Morph", "Motivation", "Motivations", "Aptitude Maximum", "Speed Modifier", "Faction",
          "Background", "Stress Test", "Numbers", "Weapons", "Augmentations", "Psi-Chi", "Psi-Gamma", "Psi-Epsilon"]
SLEIGHT_FIELDS = ("Suggested Sleights", "Psi Sleights", "Sleights", "Psi-Chi", "Psi-Gamma", "Psi-Epsilon")
# A field label, outside parentheses ("Quantum Computer (Software: Exploit)" is not one)
FIELD = re.compile(r"(?<![\w(])(" + "|".join(sorted(map(re.escape, FIELDS), key=len, reverse=True)) + r"):\s*")
WEAPON = re.compile(r"(?<![\w-])(melee|ranged)\s+(?=[A-Z])")
VARIANT = re.compile(r"\b\d+ in \d+ have\b|\bVARIANT\b|instead:")
# A run of capitalized words (a section title) followed by running text, inside a line
SECTION = re.compile(r"(?:^|\s)(?:n\s)?(?=(?:[A-Z0-9][A-Z0-9’':&-]*\s+){2,}[A-Z][A-Z’'&-]+\s+[A-Z][a-z])")
# Running headers, page numbers and chapter tabs
JUNK = re.compile(r"^((\.\d+)+.*|GAME INFORMATION|glory|Synopsis Welcome to Firewall|A Time of Eclipse Game .*|"
                  r"Skills Action and Combat|Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference|"
                  r"Eclipse Phase.*|.*\bPage \d+.*|EP_.*|THE STARS OUR DESTINATION|THE DEVOTEES|\. 1\.1\.1.*)$")

# Blocks whose name pdftotext misplaces (columns read across): (book, n-th block) -> name. Checked against the page.
NAMES = {
    ("Gatecrashing", 4): "Zombie Crab",
    ("Core Rulebook", 2): "Exsurgent Virus (Digital)",
    ("Sunward", 0): "Venusian Exsurgent",
    ("The Stars Our Destination", 0): "Alice Chu",
    ("The Stars Our Destination", 4): "François Leclerc",
}
# Misprints: the Ungifted's derived stats line repeats its aptitudes (Gatecrashing p. 176); the natives share a
# transhuman body, so the Servants' line (minus their WIL-based LUC/TT/IR) is used.
STAT_FIXES = {
    ("Gatecrashing", "The Ungifted"): {"INIT": 50, "SPD": 1, "LUC": 20, "TT": 4, "IR": 40, "DUR": 35, "WT": 7, "DR": 53},
}
# Text run together by pdftotext: an end-of-section ornament ("n") glued to the next column (The Devotees p. 14)
TEXT_FIXES = [("The Devotees", r"(Tracking software)n$", r"\1."), ("The Devotees", r"^named Lindsey and on Cognite\..*$", "")]
# Creatures reprinted (and updated) in X-Risks: block name -> X-Risks name
IN_XRISKS = {"Wild Artificial": "Collector Wild Artificial", "Jellies": "Standard Jelly", "Wrappers": "Head Wrapper",
             "Ambassadors": "Factor Ambassador", "Guardians": "Factor Guardian", "Headhunters": "Mark I",
             "Headhunter Mark II": "Mark II", "Breeders": "Immolator Breeder", "Drones": "Immolator Drone"}


def pdf_lines(source):
    """[(printed page, line)] of a source in reading order, junk removed."""
    first, last = source["pages"]
    text = subprocess.run(["pdftotext", "-enc", "UTF-8"] + (["-raw"] if source.get("raw") else []) + ["-f", str(first), "-l", str(last),
                           os.path.join(FOLDER, source["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
    out = []
    for n, page in enumerate(text.split("\f")):
        for l in page.split("\n"):
            l = re.sub(r"[\x00-\x1f]", "", l).strip()
            for book, wrong, right in TEXT_FIXES:
                if book == source["book"]:
                    l = re.sub(wrong, right, l)
            if l and not JUNK.match(l):
                out.append((first + n - source["offset"], l))
    return out


def is_heading(line):
    """A short title line: "Whippers (Biomorph)", "NINE LIVES ENFORCER" (not a label, a list or a sentence end)."""
    return bool(re.match(r"^[A-Z“]", line)) and len(line.split()) <= 6 and not re.search(r"[.,;:—–-]$|,|:", line) and \
        not HEADER.match(line) and not STAT_HEADER.match(line) and not VALUES_LINE.match(line) and \
        not WEAPON.match(line)


def is_prose(line):
    """A paragraph of running text (pdftotext joins each paragraph on one line)."""
    return len(line) >= 120 and not FIELD.match(line) and not WEAPON.match(line)


def read_stats(lines, i):
    """(aptitude values, {stat: value}, index after the stats, lines of another column read in between) from the
    aptitude header at lines[i]."""
    apts, stats, words, values, between, apt_words = [], {}, [], [], [], []
    j = i
    while j < len(lines):
        l = lines[j]
        stat = STAT_LINE.match(l)
        head = APT_LINE.match(l)
        if head and not words and (not head.group(2) or VALUES_LINE.match(head.group(2))):
            apt_words += head.group(1).split()
            apts += VALUE.findall(head.group(2))
        elif stat and (not stat.group(2) or VALUES_LINE.match(stat.group(2))):
            words += stat.group(1).split()
            values += VALUE.findall(stat.group(2))
        elif VALUES_LINE.match(l):
            if not words and (len(apts) < len(apt_words) or len(apt_words) < 7):
                apts += VALUE.findall(l)
            elif len(values) < len(words):
                values += VALUE.findall(l)
            else:
                break
        elif not words and len(apts) >= 7:
            # Another column read between the aptitudes and the stats (The Devotees p. 26)
            ahead = next((x for x in range(j, min(j + 8, len(lines))) if STAT_LINE.match(lines[x])), None)
            if ahead is None:
                break
            between += lines[j:ahead]
            j = ahead
            continue
        else:
            break
        j += 1
    stats = dict(zip(words, values))
    return apts, stats, j, between


def value(token):
    """Number of a printed value: "+5 (20)" and "— (15)" -> the total in parentheses; "20 (40)" -> 20; "—" -> None."""
    m = re.search(r"\((\d+)\)?", token)
    if m and re.match(r"^[+–−—-]", token.strip()):
        return int(m.group(1))
    token = re.sub(r"\s*\(.*$", "", token)
    m = re.match(r"^[+–−-]?\s?(\d+)$", token.strip())
    return int(m.group(1)) * (-1 if re.match(r"^[–−-]", token.strip()) else 1) if m else None


def split_fields(text):
    """[(label, text)] of a run of field text; "melee"/"ranged" weapon entries get the labels melee and ranged."""
    marks = sorted([(m.start(), m.end(), m.group(1)) for m in FIELD.finditer(text)] +
                   [(m.start(), m.end(), m.group(1)) for m in WEAPON.finditer(text)])
    out = [("", text[:marks[0][0]].strip())] if marks and marks[0][0] > 0 else ([("", text)] if not marks else [])
    for k, (start, end, label) in enumerate(marks):
        stop = marks[k + 1][0] if k + 1 < len(marks) else len(text)
        out.append((label, text[end:stop].strip()))
    # An end-of-section ornament ("n") may close the last field
    return [(k, re.sub(r"\s+n$", "", v)) for k, v in out if v]


def join(parts):
    return threats.join(parts)


def blocks(source):
    """[{name, page, book, header lines, field text}] of a source, in order."""
    stream = pdf_lines(source)
    lines = [l for _, l in stream]
    starts = [i for i, l in enumerate(lines) if HEADER.match(l)]
    out, floor, carry = [], -1, []
    for k, s in enumerate(starts):
        apts, stats, j, between = read_stats(lines, s)
        if between and out:
            out[-1]["body"] += between
        nxt = starts[k + 1] if k + 1 < len(starts) else len(lines)
        # The next block's name and header start at its nearest heading
        nxt_name = next((x for x in range(nxt - 1, j - 1, -1) if is_heading(lines[x])), nxt) if nxt < len(lines) else nxt
        n = next((x for x in range(s - 1, floor, -1) if is_heading(lines[x])), None)
        body, end = [], j
        while end < nxt_name:
            l = lines[end]
            if re.match(r"^\d{1,3}$", l):
                end += 1
                continue
            open_text = body and not re.search(r"[.!?)”]$", body[-1])
            following = lines[end + 1] if end + 1 < len(lines) else ""
            # A section title ("PLOT HOOKS") always ends the block, even after an EyeChat marker (" n"), as do the
            # book credits
            if body and re.match(r"^(?:\d+\.\s*)?[A-Z][A-Z0-9’':& ]{3,}$", l) and not VARIANT.search(l):
                break
            if re.search(r"https?://|^credits:", l):
                break
            if body and not open_text and is_prose(l) and not re.match(r"^[a-z]", l):
                break
            if body and is_heading(l) and not VARIANT.search(l) and (not open_text or is_prose(following)):
                break
            # A section title run into the last field ("... Ammo 12) STAGE 4: AT WAR WITH MYSELF Ultimately...")
            title = SECTION.search(l)
            if title and not VARIANT.search(l[title.start():]):
                if l[:title.start()].strip():
                    body.append(l[:title.start()])
                break
            body.append(re.sub(r"\s+n$", "", l))
            end += 1
        name = NAMES.get((source["book"], len(out)), lines[n] if n is not None else "?")
        head = lines[n + 1:s] if n is not None else []
        # A "Morph:" line read after the stats introduces the next block (its name is printed elsewhere)
        if carry:
            head, carry = carry + head, []
        # A name set by hand: its header is printed under the name, elsewhere in the stream
        if (source["book"], len(out)) in NAMES:
            at = next((x for x, l in enumerate(lines) if l.upper() == name.upper()), None)
            if at is not None:
                # The header ends at the next title (except the end of the motivations) or sidebar
                # ("SPACECRAFT Autonomous Kill Vehicles...")
                stop = next((x for x in range(at + 1, len(lines)) if HEADER.match(lines[x]) or re.match(r"^[A-Z]{4,}\b", lines[x])
                             or (is_heading(lines[x]) and "Motivation" not in lines[x - 1])), at + 1)
                head = lines[at + 1:stop]
                # The Morph line may be printed at the end of a paragraph just above the stats (Alice Chu): that
                # paragraph ends the description
                tail = lines[floor + 1:s]
                last = next((x for x in range(len(tail) - 1, -1, -1) if "Morph:" in tail[x]), None)
                if not any("Morph:" in h for h in head) and last is not None:
                    head += tail[last:]
        cut = next((x for x, l in enumerate(body) if x and re.match(r"^(?:.*\s)?Morph:\s", l)), None)
        if cut is not None and k + 1 < len(starts):
            body, carry = body[:cut], body[cut:]
        out.append({"name": name, "page": stream[s][0], "book": source["book"], "apts": apts, "stats": stats,
                    "header": head, "body": body})
        floor = end - 1
    return rehome(out)


def rehome(out):
    """Give a second Roleplaying or Appearance paragraph of a block (another column read in between) to the block
    whose name it mentions (The Devotees p. 26: Omri's paragraph after Bertrand Theo's)."""
    for block in out:
        for label in ("Roleplaying:", "Appearance:"):
            # The block's own paragraph may be run into another line: count every occurrence
            if sum(l.count(label) for l in block["body"]) < 2:
                continue
            first = next(x for x, l in enumerate(block["body"]) if label in l)
            at = [x for x, l in enumerate(block["body"]) if l.startswith(label) and x != first]
            for x in reversed(at):
                text = block["body"][x]
                # The block whose name the paragraph mentions most
                mentions = lambda b: sum(len(re.findall(rf"\b{re.escape(w)}\b", text, re.I))
                                         for w in clean_name(b["name"]).split() if len(w) > 3)
                others = [b for b in out if b is not block and not any(label in l for l in b["body"])]
                owner = max(others, key=mentions, default=None)
                owner = owner if owner and mentions(owner) else None
                if owner:
                    owner["body"].append(text)
                    del block["body"][x]
    return out


# --- Compendium lookups -------------------------------------------------------------------------------------------

def load(pack, kind=None):
    items = {}
    for f in glob.glob(os.path.join(ROOT, "packs", "_source", pack, "**", "*.json"), recursive=True):
        d = json.load(open(f, encoding="utf8"))
        if d.get("type") and (kind is None or d["type"] == kind):
            items.setdefault(norm(d["name"]), d)
    return items


def trait_effects(items):
    """DUR, LUC and skill bonuses of the traits among the actor's items, as module/rules/traits.mjs gives them."""
    fx = {"dur": 0, "luc": 0, "skills": {}}
    for i in items:
        if i["type"] != "trait":
            continue
        key, level = i["system"].get("key"), max(1, i["system"].get("level", 1))
        fx["dur"] += {"tough": 5 * level, "frail": -5 * level}.get(key, 0)
        fx["luc"] += {"frailSanity": -5 * level}.get(key, 0)
        for skill, value in {"socialButterfly": {"networking": 10}, "shutIn": {"networking": -10},
                             "animalEmpathy": {"animalHandling": 10}, "impairedProprioception": {"fray": -10},
                             "impairedBalance": {"climbing": -10 * level, "freerunning": -10 * level}}.get(key, {}).items():
            fx["skills"][skill] = fx["skills"].get(skill, 0) + value
    return fx


def norm(name):
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("’", "'")).strip()


MORPHS = load("morphs")
TRAITS = {**load("mental-health"), **load("supplement-traits"), **load("traits")}
SLEIGHTS = load("sleights")
SOFTWARE = load("software")
WEAPONS = {**load("supplement-gear", "weapon"), **load("weapons")}
ARMORS = {**load("supplement-gear", "armor"), **load("armor")}
XRISKS = {norm(d["name"]) for d in load("threats").values()}


def find(table, name):
    """A compendium entry by name, trying the usual variants ("Medium Rail Pistol" = "Medium Pistol (Railgun)")."""
    n = re.sub(r"^smg$|submachinegun", "submachine gun", norm(name))
    # "Track" is the Tracking program
    tries = [n, re.sub(r"\s*\(.*\)$", "", name), n.rstrip("s"), re.sub(r"\bmorph$", "", n).strip(), f"{n}ing"]
    m = re.match(r"^(.*)\brail\s+(\w+)$", n)
    if m:
        tries.append(f"{m.group(1)}{m.group(2)} railgun")
    tries += [f"{n} firearm", f"{n} railgun", f"{n} standard"]
    m = re.match(r"^(light|standard|heavy|medium)\s+(.+)$", n)
    if m:
        tries.append(f"{m.group(2)} {m.group(1)}")
    for t in tries:
        if norm(t) in table:
            return table[norm(t)]
    return None


def clone(doc, _id, sort, **system):
    item = json.loads(json.dumps(doc))
    for k in ("_key", "folder", "_stats"):
        item.pop(k, None)
    item["system"].update(system)
    item.update({"_id": _id, "sort": sort, "flags": {}, "ownership": {"default": 0}, "folder": None})
    return item


# --- Parsing of the fields ------------------------------------------------------------------------------------------

SKILL_ALIASES = {"freefall": "freeFall", "exotic ranged attack": "exoticRanged", "exotic melee attack": "exoticMelee",
                 "interest": "interest", "interests": "interest", "language native": "language", "networking": "networking",
                 "protocol": "protocol", "psi assault": "psiAssault", "unarmed": "unarmedCombat",
                 "thrown weapons": "throwingWeapons", "academic": "academics", "professional": "profession",
                 "free running": "freerunning", "infiltrate": "infiltration"}


def skill_key(name):
    n = norm(name)
    if n in SKILL_ALIASES:
        return SKILL_ALIASES[n]
    return threats.SKILL_NAMES.get(n, threats.SKILL_NAMES.get(name.lower(), ""))


def parse_skills(text):
    """[(key, name, field, value, specialization)] of a skills field."""
    out = []
    for part in re.split(r",\s*(?![^()]*\))", text):
        part = part.strip().rstrip(".")
        # "Infosec 70 (Spoof 80)": a specialization and its rating; "Perception 50 (60)": the rating with implants
        m = re.match(r"^(.+?)\s+(\d+)(?:\s*\(([^)\d]*?)\s*(\d+)?\))?$", part)
        if not m:
            continue
        name, val = m.group(1).strip().rstrip(":"), int(m.group(2))
        spec, field = (m.group(3) or "").strip(), ""
        p = re.match(r"^(.+?)\s*\(([^)]*)\)$", name)
        if p and not spec:
            name, spec = p.group(1).strip(), p.group(2).strip()
        # A remark, not a specialization: "Investigation 100 (used instead of Perception)"
        if len(spec.split()) > 3:
            spec = ""
        # "Language Russian: 65" (misprint) is "Language: Russian"
        f = re.match(r"^([^:]+):\s*(.*)$", name) or re.match(r"^(Language)\s+(\w+)$", name)
        if f:
            name, field = f.group(1).strip(), f.group(2).strip().rstrip(":")
        key = skill_key(name)
        if key and threats.SKILLS[key][1] == "knowledge" or key in ("exoticMelee", "exoticRanged", "hardware", "networking", "pilot", "medicine"):
            # Field skills: "Exotic Ranged Attack (Spit)" names the field in parentheses
            if not field and spec:
                field, spec = spec, ""
        out.append((key, name, field, val, spec))
    return out


def attack_entries(text, dice_only=False):
    """[(name, details)] of "Name (DV 1d10 + 3, AP –1)" entries (the creature attacks in Notes and Attacks); in an
    Attacks field, "Tentacles (1d10+3, AP 0)" too."""
    out = []
    marker = r"\bDV\b" if not dice_only else r"\bDV\b|\d*d10"
    for m in re.finditer(r"([A-Z][\w’' -]*?(?:\s*\([^()]*\))?)\s*\(((?:[^()]|\([^()]*\))*?(?:" + marker +
                         r")(?:[^()]|\([^()]*\))*)\)", text):
        out.append((m.group(1).strip(), m.group(2) if re.search(r"\bDV\b", m.group(2)) else f"DV {m.group(2)}"))
    return out


def weapon_line(text):
    """(name, rating, note, details, extra) of a "melee"/"ranged" entry: "Vibroblade 50 (AP −2, DV 2d10 + 1)",
    "Submachinegun 75 (85) (AP −2, ...) with ammo Overload", "Medium Pistol 50 with hollow point ammo (DV ...)",
    "Cyberclaws (AP −2, DV 1d10 + 5)", "Shock Baton 60"; None for an entry without rating nor details."""
    text = text.strip()
    m = re.match(r"^(?P<name>[^(\d]+?)\s+(?P<rating>\d+)(?:\s*\((?P<alt>\d+)\))?\s*(?P<note>[^()]*?)\s*"
                 r"(?:\((?P<details>.*)\))?\s*(?P<extra>[^()]*)$", text)
    if m:
        return (m.group("name").strip(), int(m.group("rating")), m.group("note").strip(), m.group("details") or "",
                m.group("extra").strip())
    m = re.match(r"^(?P<name>[^(\d]+?)\s*\((?P<details>.*)\)\s*(?P<extra>[^()]*)$", text)
    return (m.group("name").strip(), 0, "", m.group("details"), m.group("extra").strip()) if m else None


def dv_ap(details):
    """(formula, AP, shock) of "DV 2d10 + 3, AP –3" or "1d10 + 3 DV, AP -1"."""
    t = details.replace("−", "-").replace("–", "-").replace("÷", "/")
    m = re.search(r"DV\s*(\(?\d*d10[^,;)]*\)?(?:\s*[+-]\s*\d+)?)", t) or re.search(r"(\d*d10(?:\s*[+-]\s*\d+)?)\s*DV", t)
    formula = ""
    if m:
        f = re.match(r"\(?(\d*d10)\s*(?:/\s*2\))?((?:\s*[+-]\s*\d+(?!d))*)", m.group(1).strip())
        if f:
            halved = re.match(r"\(?\d*d10\s*/\s*2", m.group(1).strip())
            formula = (f"ceil({f.group(1)} / 2)" if halved else f.group(1)) + re.sub(r"\s+", " ", f.group(2)).replace("+", " + ").replace("  ", " ")
            formula = re.sub(r"\s+", " ", formula).strip()
    ap = re.search(r"AP\s*([+-]?\s*\d+)", t)
    return formula, int(ap.group(1).replace(" ", "")) if ap else 0, "shock" in t.lower()


WEAPON_SKILLS = [(r"blade|knife|sword|ax\b|axe|cutter|claw|bite|pincer|mandible|tentacle|unarmed|punch|kick|fist|tongue|stinger|horn|whip|strike|grapple|talon|spur|tail|slam",
                  "unarmedCombat"),
                 (r"baton|club|staff|hammer|mace", "clubs"),
                 (r"pistol|rifle|smg|submachine|machine gun|shotgun|firearm|railgun|sniper", "kineticWeapons"),
                 (r"laser|agonizer|stunner|plasma|particle|beam|bolter|pulser|microwave", "beamWeapons"),
                 (r"shard|needle|sprayer|spray|freezer|torch|shredder|buzzer", "sprayWeapons"),
                 (r"seeker|grenade launcher|launcher", "seekerWeapons"),
                 (r"grenade|throw", "throwingWeapons")]


def guess_skill(name):
    n = name.lower()
    if re.search(r"vibroblade|knife|sword|blade|monofilament|wasp", n):
        return "blades"
    return next((k for pattern, k in WEAPON_SKILLS if re.search(pattern, n)), "unarmedCombat")


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def plain(text):
    return html.escape(re.sub(r"\s+", " ", text).strip(), quote=False)


def clean_name(name):
    name = re.sub(r"\s*\((?:Bio|Synth|Info)morphs?\)$|\s*\(Pod\)$", "", name.strip())
    return threats.title(name) if name.isupper() else name


def actor(block, folder, sort):
    name = clean_name(block["name"])
    _id = make_id(block["book"], name)
    header = split_fields(join(block["header"]))
    fields = split_fields(join(block["body"]))
    # Fields after a variant title belong to the variant (kept in the description)
    main, variant = [], []
    for k, v in fields:
        target = variant if variant else main
        if VARIANT.search(v) and not variant:
            cut = VARIANT.search(v).start()
            if v[:cut].strip():
                main.append((k, v[:cut].strip()))
            variant.append(("", v[cut:]))
            continue
        target.append((k, v))
    get = lambda label: join([v for k, v in header + main if k == label])

    apts = [value(t) for t in block["apts"]]
    printed = dict(zip(APT, [a or 0 for a in apts[:7]]))
    mox = apts[7] if len(apts) > 7 and apts[7] is not None else 0
    stats = {k: value(v) for k, v in block["stats"].items()}
    stats.update(STAT_FIXES.get((block["book"], name), {}))
    wil = printed["wil"]

    items, sort_i = [], [0]

    def add(item):
        sort_i[0] += 1
        item["_id"] = make_id(_id, item["type"], item["name"], str(sort_i[0]))
        item["_key"] = f"!actors.items!{_id}.{item['_id']}"
        item.update({"effects": item.get("effects", []), "flags": {}, "folder": None, "sort": sort_i[0] * 1000,
                     "ownership": {"default": 0}})
        for e in item["effects"]:
            e["_key"] = f"!actors.items.effects!{_id}.{item['_id']}.{e['_id']}"
        items.append(item)

    # Morph: a compendium morph, else the creature's own body
    morph_name = re.sub(r"\s*\((?!.*eidolon).*\)$", "", get("Morph"), flags=re.I).strip()
    # "Infomorph (Slave Eidolon)" is the "Slave (Infomorph eidolon)" of the Morph Recognition Guide
    eidolon = re.match(r"^Infomorph \((\w+) Eidolon\)", get("Morph"), re.I)
    morph_doc = (find(MORPHS, f"{eidolon.group(1)} (Infomorph eidolon)") if eidolon else None) or \
        find(MORPHS, get("Morph")) or (find(MORPHS, morph_name) if morph_name else None)
    if not morph_doc and re.search(r"\((.*)\)", get("Morph")):
        morph_doc = find(MORPHS, re.search(r"\((.*)\)", get("Morph")).group(1))
    notes_text = " ".join(v for k, v in main if k in ("Notes", "Implants", "Ware", "Enhancements"))
    natural = re.search(r"Armor\s*(?:\([^)/]*\))?\s*\((\d+)\s*/\s*(\d+)\)", notes_text)
    dur = stats.get("DUR")
    mods = {}
    if morph_doc:
        m = clone(morph_doc, "", 0, active=True)["system"]
        bonus, cap = m["aptitudeBonus"], m["aptitudeMax"]
        base, apt_mod = {}, {}
        for k in APT:
            # Printed totals above the morph maximum (augmentations) go to the aptitude modifier
            base[k] = max(0, min(printed[k], cap[k]) - bonus[k])
            apt_mod[k] = max(0, printed[k] - cap[k])
        if dur is not None:
            mods["dur"] = dur - m["durability"]
        morph_spd = 1 + m["speedMod"]
        morph_armor = m["armor"]
        morph = clone(morph_doc, "", 0, active=True)
        morph["name"] = morph_doc["name"]
    else:
        base, apt_mod = dict(printed), {k: 0 for k in APT}
        kind = "infomorph" if not dur else ("synthmorph" if re.search(r"synth|bot\b|robot|machine", block["name"], re.I) or
                                            (stats.get("DR") == dur * 2 and not re.search(r"biomorph", block["name"], re.I))
                                            else "biomorph")
        if re.search(r"\(Biomorph\)", block["name"]):
            kind = "biomorph"
        morph = {"name": f"{name} (body)", "type": "morph", "img": "icons/svg/pawprint.svg",
                 "system": {"morphType": kind, "aptitudeMax": {k: 40 for k in APT}, "aptitudeBonus": {k: 0 for k in APT},
                            "durability": dur or 0, "initMod": 0,
                            # Infomorphs without stats line print a "Speed Modifier: +3"
                            "speedMod": max(0, (stats.get("SPD") or 1) - 1) if stats.get("SPD") else
                            int((re.match(r"^\+?(\d+)", get("Speed Modifier")) or [0, 0])[1]),
                            "armor": {"energy": int(natural.group(1)) if natural else 0, "kinetic": int(natural.group(2)) if natural else 0},
                            "movement": get("Movement Rate") or get("Mobility System") or get("Movement"),
                            "implants": get("Implants") or get("Ware") or get("Enhancements"), "advantages": get("Traits"),
                            "disadvantages": "", "skillBonuses": [], "cpCost": 0, "creditCost": "", "active": True,
                            "description": ""}}
        morph_spd, morph_armor = 1 + morph["system"]["speedMod"], morph["system"]["armor"]
    add(morph)
    total = {k: min(base[k] + (morph["system"]["aptitudeBonus"][k]), morph["system"]["aptitudeMax"][k]) + apt_mod[k] for k in APT}
    if stats.get("SPD"):
        mods["spd"] = stats["SPD"] - morph_spd
    if stats.get("WT") is not None and dur is not None:
        mods["wt"] = stats["WT"] - math.ceil(dur / 5)

    # Traits, sleights and software of the compendiums
    psi = False
    trait_text = ", ".join(x for x in (get("Traits"), get("Common Traits"), get("Notes")) if x)
    for entry in re.split(r",\s*(?![^()]*\))", trait_text):
        entry = re.sub(r"\s+trait\b.*$", "", entry.strip().rstrip("."))
        lvl = re.search(r"\((?:Level\s*)?(\d)\)$|\s(\d)$", entry)
        t = find(TRAITS, re.sub(r"\s*\(.*\)$|\s\d$", "", entry)) if entry else None
        if t:
            level = int(lvl.group(1) or lvl.group(2)) if lvl else t["system"].get("level", 1)
            psi = psi or t["system"].get("key") == "psi"
            add(clone(t, "", 0, level=level))
    for entry in re.split(r",\s*", re.sub(r"\(.*?\)", "", ", ".join(get(f) for f in SLEIGHT_FIELDS if get(f)))):
        s = find(SLEIGHTS, entry.strip().rstrip(".")) if entry.strip() else None
        if s:
            add(clone(s, "", 0))
    # Programs: the Software field, and "Quantum Computer (Software: Exploit, Sniffer)" in the gear or implants
    programs = [get("Software")] + re.findall(r"\(Software:\s*([^)]*)\)", get("Gear") + " " + get("Implants"))
    for entry in re.split(r",\s*", ", ".join(p for p in programs if p)):
        s = find(SOFTWARE, entry.strip().rstrip(".")) if entry.strip() else None
        if s and not any(i["name"] == s["name"] for i in items):
            add(clone(s, "", 0))

    # The printed stats include the traits' fixed effects, which the system adds itself (module/rules/traits.mjs)
    fx = trait_effects(items)
    if "dur" in mods:
        mods["dur"] -= fx["dur"]

    # Derived stats: what the rules do not give goes to the modifiers
    if stats.get("LUC") is not None:
        mods["luc"] = stats["LUC"] - 2 * total["wil"] - fx["luc"]
        if stats.get("TT") is not None:
            mods["tt"] = stats["TT"] - math.ceil(stats["LUC"] / 5) + (1 if psi else 0)

    # Skills: ranks are what the printed value leaves once the aptitude and the morph bonus are taken away
    morph_skill = {b["key"]: b["value"] for b in morph["system"].get("skillBonuses", []) if b.get("key")}
    skill_values = {}
    for label in ("Skills", "Active Skills", "Knowledge Skills"):
        for key, sname, field, val, spec in parse_skills(get(label)):
            aptitude, category = threats.SKILLS.get(key, ("cog", "knowledge"))
            ranks = max(0, val - total[aptitude] - morph_skill.get(key, 0) - fx["skills"].get(key, 0)) if key else val
            skill_values.setdefault(key, val)
            add({"name": sname, "type": "skill",
                 "img": "icons/svg/book.svg" if category == "knowledge" else "icons/svg/d20-black.svg",
                 "system": {"key": key, "aptitude": aptitude, "category": category, "field": field, "ranks": ranks,
                            "mod": 0, "specialization": spec, "noDefault": False, "description": ""}})

    # Weapons: "melee/ranged Name 50 (AP, DV, Mode, Ammo)" lines, then the "Name (DV ...)" attacks of a creature
    for k, v in main:
        if k not in ("melee", "ranged"):
            continue
        w = weapon_line(v)
        if not w:
            continue
        wname, rating, note, details, extra = w
        formula, ap, shock = dv_ap(details)
        doc = find(WEAPONS, wname)
        modes = re.search(r"Mode\s+([A-Z/ ]+)", details)
        ammo = re.search(r"Ammo\s+(\d+)", details, re.I)
        if not doc and not formula:
            continue
        if doc:
            item = clone(doc, "", 0, equipped=True)
            item["name"] = doc["name"]
            if formula:
                item["system"].update({"dv": formula, "ap": ap, "addDB": False})
        else:
            skill = guess_skill(wname)
            item = {"name": wname, "type": "weapon", "img": "icons/svg/sword.svg" if k == "melee" else "icons/svg/target.svg",
                    "system": {"weaponType": k, "skill": skill, "ap": ap, "dv": formula or "1d10", "damageType": "kinetic",
                               "addDB": False, "modes": re.sub(r"\s*/\s*", ", ", modes.group(1).strip()) if modes else "",
                               "ammo": {"value": int(ammo.group(1)) if ammo else 0, "max": int(ammo.group(1)) if ammo else 0,
                                        "loaded": "", "size": ""},
                               "range": "", "equipped": True, "shock": shock, "area": {"shape": "none", "radius": 0, "falloff": 2},
                               "twoHanded": False, "cost": "", "quantity": 1, "munition": {"kind": "none", "size": "standard"},
                               "launcher": "", "rating": 0, "description": ""}}
        if shock:
            item["system"]["shock"] = True
        # No rating printed (Cyberclaws): the skill is used
        item["system"]["rating"] = 0 if (not rating or skill_values.get(item["system"]["skill"]) == rating) else rating
        item["system"]["description"] = f"<p>{plain(f'{k} {v}')}</p>" + (item["system"].get("description") or "")
        add(item)
    entries = attack_entries(get("Attacks"), dice_only=True) + \
        attack_entries(", ".join(v for k, v in main if k in ("Notes", "Implants", "Ware", "Gear")))
    for wname, details in entries:
        formula, ap, shock = dv_ap(details)
        if not formula or re.match(r"^(Toxin|Effect)", wname) or any(i["name"] == wname for i in items):
            continue
        doc = find(WEAPONS, wname)
        if doc:
            item = clone(doc, "", 0, equipped=True, dv=formula, ap=ap, addDB=False, rating=0)
            item["name"] = doc["name"]
            item["system"]["description"] = f"<p>{plain(f'{wname} ({details})')}</p>" + item["system"]["description"]
            add(item)
            continue
        ranged = bool(re.search(r"spit|spray|ranged|gun|laser|rifle|pistol", wname, re.I))
        skill = "exoticRanged" if ranged and not re.search(r"gun|laser|rifle|pistol", wname, re.I) else guess_skill(wname)
        add({"name": re.sub(r"\s+Attack$", "", wname), "type": "weapon",
             "img": "icons/svg/claw.svg" if not ranged else "icons/svg/target.svg",
             "system": {"weaponType": "ranged" if ranged else "melee", "skill": skill, "ap": ap, "dv": formula,
                        "damageType": "kinetic", "addDB": False, "modes": "", "range": "",
                        "ammo": {"value": 0, "max": 0, "loaded": "", "size": ""}, "equipped": True, "shock": shock,
                        "area": {"shape": "none", "radius": 0, "falloff": 2}, "twoHanded": False, "cost": "",
                        "quantity": 1, "munition": {"kind": "none", "size": "standard"}, "launcher": "", "rating": 0,
                        "description": f"<p>{plain(f'{wname} ({details})')}</p>"}})

    # Worn armor: "7/7 (Standard Vacsuit)", "11/12 Armor Clothing with Armor Vest" (the total, the morph's own armor
    # included) or "Light Vacsuit (5/5), Yazidi Ghillie Suit (7/6)" (one value per piece)
    worn = re.match(r"^(\d+)\s*/\s*(\d+)\s*(?:\((.*)\)|(.*))", get("Armor"))
    pieces = []
    if worn:
        pieces.append(((worn.group(3) or worn.group(4) or "").strip() or "Armor",
                       int(worn.group(1)) - morph_armor["energy"], int(worn.group(2)) - morph_armor["kinetic"]))
    else:
        pieces = [(n.strip(), int(e), int(k)) for n, e, k in
                  re.findall(r"([A-Z][^,()]*?)\s*\((\d+)\s*/\s*(\d+)\)", get("Armor"))]
    for label, energy, kinetic in pieces:
        if energy > 0 or kinetic > 0:
            doc = find(ARMORS, label)
            item = clone(doc, "", 0) if doc else {"name": label, "type": "armor", "img": "icons/svg/shield.svg",
                                                  "system": {"energy": 0, "kinetic": 0, "accessory": False, "cost": "",
                                                             "description": ""}}
            item["name"] = label
            item["system"].update({"energy": energy, "kinetic": kinetic, "equipped": True})
            add(item)

    # Description: subtitle, header text and every field, as printed
    lines = []
    lead = [v for k, v in header if not k]
    if lead:
        lines.append(f"<p>{plain(' '.join(lead))}</p>")
    for k, v in header + main + variant:
        if k:
            lines.append(f"<p><strong>{plain(k)}:</strong> {plain(v)}</p>")
        elif (k, v) not in header:
            lines.append(f"<p>{plain(v)}</p>")
    printed_stats = ", ".join(f"{w} {block['stats'].get(w, '—')}" for w in STAT_WORDS if w in block["stats"])
    lines.append(f"<p><em>Printed: {plain(printed_stats)}.</em></p>")
    if (block["book"], name) in STAT_FIXES:
        lines.append("<p><em>The book misprints this derived stats line; the stats of a standard native are used.</em></p>")
    lines.append(f"<p><em>Source: Eclipse Phase {block['book']}, p. {block['page']}.</em></p>")

    person = bool(morph_doc) or mox > 0
    system = {
        "aptitudes": {k: {"base": base[k], "mod": apt_mod[k]} for k in APT},
        "moxie": {"value": mox, "max": mox}, "damage": {"value": 0}, "wounds": {"value": 0}, "stress": {"value": 0},
        "trauma": {"value": 0}, "mods": {k: v for k, v in mods.items() if v}, "biography": "".join(lines), "notes": "",
        "details": {"motivations": get("Motivations") or get("Motivation")},
    }
    img = "icons/svg/mystery-man.svg" if person else "icons/svg/pawprint.svg"
    return {
        "_id": _id, "_key": f"!actors!{_id}", "name": name, "type": "npc", "img": img,
        "system": system, "items": items, "effects": [], "folder": folder, "sort": sort, "flags": {},
        "ownership": {"default": 0},
        "prototypeToken": {"name": name, "actorLink": False, "bar1": {"attribute": "damage"},
                           "bar2": {"attribute": "stress"}, "disposition": 0 if person else -1, "displayBars": 20,
                           "texture": {"src": img}},
    }


def build():
    folders, docs, skipped = {}, [], []
    for source in SOURCES:
        fid = make_id("folder", source["book"])
        for block in blocks(source):
            name = clean_name(block["name"])
            # "Whippers" (Core) is "Whipper" in X-Risks
            if {norm(name), norm(name)[:-1] if norm(name).endswith("s") else ""} & XRISKS or name in IN_XRISKS:
                skipped.append(f"{source['book']}: {name}")
                continue
            folders.setdefault(fid, {"_id": fid, "_key": f"!folders!{fid}", "name": source["book"], "type": "Actor",
                                     "folder": None, "sorting": "a", "sort": (len(folders) + 1) * 1000, "color": None,
                                     "flags": {}, "description": ""})
            docs.append(actor(block, fid, (len(docs) + 1) * 1000))
    return list(folders.values()), docs, skipped


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
    sys.stdout.reconfigure(encoding="utf-8")
    if "--blocks" in sys.argv:
        for source in SOURCES:
            print("==", source["book"])
            for i, b in enumerate(blocks(source)):
                print(f"  {i:>2} p{b['page']:>3} {b['name'][:34]:34} apt{len(b['apts'])} st{len(b['stats'])} "
                      f"h{len(b['header'])} b{len(b['body'])} | {(b['body'][-1] if b['body'] else '')[-70:]}")
        sys.exit()
    folders, docs, skipped = build()
    write(folders, docs)
    print("skipped (in X-Risks):", "; ".join(skipped))
    if "--summary" in sys.argv:
        for x in docs:
            s = x["system"]
            morph = x["items"][0]
            skills = [i for i in x["items"] if i["type"] == "skill"]
            weapons = [f"{i['name']} {i['system']['rating'] or i['system']['skill']} {i['system']['dv']} AP{i['system']['ap']}"
                       for i in x["items"] if i["type"] == "weapon"]
            other = [i["name"] for i in x["items"] if i["type"] in ("trait", "sleight", "software", "armor")]
            apts = " ".join(str(s["aptitudes"][k]["base"]) for k in APT)
            print(f"{x['name'][:24]:24} {apts:20} {morph['name'][:16]:16} DUR {morph['system']['durability']:>3} "
                  f"mods {s['mods']} sk{len(skills):>2} | {'; '.join(weapons)[:90]} | {', '.join(other)[:60]}")
