"""Build the robot and vehicle actors of the supplements (Sunward, Rimward, Gatecrashing, Panopticon, Firewall, Transhuman,
The Stars Our Destination).

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_supplement_vehicles.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

Descriptions use the capitalized-heading reading of tools/parse_supplement_gear.py. Robot tables printed in order
(name, movement, velocity, armor, durability, wound threshold, mobility, enhancements) are read here; the other
tables come from tools/data/supplement_vehicles.py, checked cell by cell against their page.
"""
import hashlib, html, json, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import parse_supplement_gear as supp  # noqa: E402
import supplement_vehicles as DATA  # noqa: E402

FOLDER, OUT = sys.argv[1], sys.argv[2]
supp.FOLDER = FOLDER
supp.VEHICLE = re.compile(r"(?!)")  # vehicles are what we want here
PACK = "vehicles"
VEH = lambda c: ("vehicle", c)

BOOKS = [
    {"file": "ep sunward.pdf", "title": "Sunward", "offset": 3, "pages": [(171, 174)],
     "sections": {"ROBOTS AND VEHICLES": VEH("other"), "OTHER SECRETS AND NOTES": supp.SKIP},
     # The smart animal table printed among the vehicles
     "skip": [("SMART ANIMALS", None), ("SMART ANIMAL COG", "Combat 50")],
     "costless": set(), "tables": ["Sunward"]},
    {"file": "eclipse phase rimward.pdf", "title": "Rimward", "offset": 3, "pages": [(195, 198)],
     "sections": {"ROBOTS": VEH("robot"), "ROBOTS AND VEHICLES": VEH("other"), "SURVIVAL GEAR": supp.SKIP,
                  "OTHER SECRETS AND NOTES": supp.SKIP, "PETS": supp.SKIP},
     "costless": {"FAST TRANSPORT"}, "tables": ["Rimward", "Rimward vehicles"]},
    {"file": "Eclipse Phase gatecrashing.pdf", "title": "Gatecrashing", "offset": 3, "pages": [(163, 167)],
     "sections": {"ROBOTS": VEH("robot"), "VEHICLES": VEH("other"), "XENOARCHEOLOGY GEAR": supp.SKIP,
                  "ALIEN RELICS": supp.SKIP},
     "costless": set(), "tables": ["Gatecrashing"], "robots": [164]},
    {"file": "eclipse phase panopticon.pdf", "title": "Panopticon", "offset": 2, "pages": [(159, 161)],
     "sections": {"ROBOTS": VEH("robot"), "VEHICLES": VEH("other"), "SURVIVAL GEAR": supp.SKIP, "SENSOR RULES": supp.SKIP},
     "costless": set(), "tables": ["Panopticon"], "robots": [159]},
    {"file": "eclipse phase firewall.pdf", "title": "Firewall", "offset": 2, "pages": [(178, 178)],
     "sections": {"ROBOTS": VEH("robot"), "SENSORS": supp.SKIP}, "costless": set(), "robots": [178]},
    {"file": "eclipse phase transhuman.pdf", "title": "Transhuman", "offset": 3, "pages": [(149, 149)],
     "sections": {"LOCKBOXES": VEH("robot"), "HARDWARE DAMAGE": supp.SKIP, "DEVICES IN COMBAT": supp.SKIP},
     "costless": set(), "robots": [149]},
]

# Category given by the name ("GROUND CAR (GROUNDCRAFT)") or by the vehicle's description
SUFFIX = re.compile(r"\s*\((GROUNDCRAFT|AIRCRAFT|ROBOT|WATERCRAFT|SPACECRAFT|HOVERCRAFT|EXOSKELETON)(?:/[A-Z]+)?\)\s*$", re.I)
CATEGORIES = {"groundcraft": "groundcraft", "aircraft": "aircraft", "robot": "robot", "watercraft": "watercraft",
              "spacecraft": "spacecraft", "hovercraft": "groundcraft", "exoskeleton": "other"}
# Table names that differ from their description heading
ALIASES = {"Explorernaut": "Explorenaut"}
KEYWORDS = [("submarine|boat|skiff|sled", "watercraft"), ("jet|copter|helicopter|airship|balloon|wing|flyer|aerostat", "aircraft"),
            ("transport|lifeboat|skimmer|interceptor", "spacecraft"), ("car|truck|cycle|rover|hauler|base|train|frame|hover|trike|walker", "groundcraft")]
MOVE = re.compile(r"^(\d+/\d+|NA)$")


def page_text(book, page):
    return subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(page), "-l", str(page), os.path.join(FOLDER, book["file"]), "-"],
                          capture_output=True).stdout.decode("utf-8", "replace")


def robot_rows(book, page):
    """Rows of a robot table printed in order: name, movement, velocity, armor, durability, wound threshold,
    mobility, then its enhancements until the next row."""
    lines = [re.sub(r"[\x00-\x1f]", "", l).strip() for l in page_text(book, page).split("\n")]
    lines = [l for l in lines if l]
    start = next(i for i, l in enumerate(lines) if "MOBILITY" in l and i > 0) + 1
    if lines[start] == "SYSTEM":
        start += 1
    rows, i = {}, start
    while i < len(lines) - 6:
        if MOVE.match(lines[i + 1]):
            name, move, vel = lines[i:i + 3]
            # A velocity with notes may share its line with the armor ("200 (air)/NA (space) 10/10")
            shared = re.match(r"^(.*\)\S*)\s+(\d+/\d+|—)$", vel)
            if shared:
                vel, av = shared.groups()
                dur, wt, mobility = lines[i + 3:i + 6]
                j = i + 6
            else:
                av, dur, wt, mobility = lines[i + 3:i + 7]
                j = i + 7
            enhancements = []
            while j < len(lines) and not (j + 1 < len(lines) and MOVE.match(lines[j + 1])) \
                    and not supp.FURNITURE.match(lines[j]) and not re.match(r"^[A-Z][A-Z ]{3,}$", lines[j]):
                enhancements.append(lines[j])
                j += 1
            text = supp.join(enhancements)
            # Letters split from their words by the table layout ("A ccess", "3 60-Degree", "+ 10")
            text = re.sub(r"\bA ccess", "Access", re.sub(r"\b3 60", "360", re.sub(r"\+ (\d)", r"+\1", text)))
            rows[name] = ("", "", move, vel, av, dur, wt, "", mobility, re.sub(r"^Enhancements:\s*", "", text))
            i = j
            continue
        i += 1
    if not rows:
        raise SystemExit(f"{book['title']}: no robot rows found on page {page}")
    return rows


def check(name, cells, text):
    flat = re.sub(r"\s+", " ", text).replace("−", "–")
    flat_bare = re.sub(r"[\s\-–]", "", flat)
    if re.sub(r"[\s\-–]", "", name) not in flat_bare:
        raise SystemExit(f"{name} not found on its table page")
    for cell in cells:
        if cell and cell != "—" and cell.replace("−", "–") not in flat:
            raise SystemExit(f"Transcribed cell {cell!r} of {name} not found on its table page")


def number(cell):
    m = re.search(r"[+–-]?\d+", cell.replace(",", ""))
    return int(m.group(0).replace("–", "-")) if (m and cell != "—") else 0


def armor(cell):
    values = [abs(int(x)) for x in re.findall(r"[+–-]?\d+", cell.replace("–", "-"))]
    if not values:
        return 0, 0
    return (values[0], values[1]) if len(values) > 1 else (values[0], values[0])


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def category_of(raw_name, section_category, name):
    if "(ground)" in name.lower():
        return "groundcraft"
    m = SUFFIX.search(raw_name)
    if m:
        return CATEGORIES[m.group(1).lower()]
    if section_category != "other":
        return section_category
    for pattern, cat in KEYWORDS:
        if re.search(pattern, name, re.I):
            return cat
    return "other"


def build():
    folders, docs = [], []
    for b, book in enumerate(BOOKS):
        folder = make_id("folder", book["title"])
        folders.append({"_id": folder, "_key": f"!folders!{folder}", "name": book["title"], "type": "Actor", "folder": None,
                        "sorting": "a", "sort": (b + 2) * 1000, "color": None, "flags": {}, "description": ""})
        # Stats: transcribed tables (checked) and robot tables read in order
        stats = {}
        for key in book.get("tables", []):
            table = DATA.TABLES[key]
            text = page_text(book, table["page"])
            for name, row in table["rows"].items():
                check(name, row, text)
                stats[norm(name)] = (name, row + ("",), table.get("notes", {}).get(name, ""))
        for page in book.get("robots", []):
            for name, row in robot_rows(book, page).items():
                stats[norm(name)] = (name, row, "")
        # Descriptions, by name; entries may carry their "Enhancements:" line after the cost
        described = {}
        for e in supp.parse(book):
            raw = e["name"]
            name = SUFFIX.sub("", raw).strip()
            described[norm(name)] = (name, e, raw)
        for key, (name, row, note) in stats.items():
            entry = described.get(norm(ALIASES.get(name, name)))
            if not entry:
                # A table variant described inside another entry (Flying Car (Security Model)), or a plural heading
                base = next((k for k in described if key.startswith(k) or k.startswith(key)), None)
                entry = described.get(base)
            if not entry:
                raise SystemExit(f"{book['title']}: no description for {name}")
            _, e, raw = entry
            passengers, handling, move, vel, av, dur, wt, dr, mobility, enhancements = row
            energy, kinetic = armor(av)
            desc = e["desc"]
            listed = re.sub(r"^Enhancements:\s*", "", e.get("stats", ""))
            # Variants described after the list ("Surveillance aerostats are equipped...") belong to the description
            variant = re.search(r"\s[A-Z][a-z]+ [a-z]+ (?:are|is) ", listed)
            if variant:
                desc += " " + listed[variant.start():].strip()
                listed = listed[:variant.start()].strip()
            if note:
                desc += f" {note}"
            category = category_of(raw.upper(), e["category"], name)
            if mobility and e["category"] == "robot":
                category = "robot"
            system = {
                "category": category, "passengers": "" if passengers == "—" else passengers, "handling": number(handling),
                "movement": "" if move == "—" else move, "maxVelocity": "" if vel == "—" else vel, "mobility": mobility,
                "av": {"energy": energy, "kinetic": kinetic}, "durability": number(dur), "woundThreshold": number(wt),
                "deathRating": number(dr) if dr else 0, "damage": {"value": 0}, "wounds": {"value": 0}, "pilot": 40,
                "enhancements": enhancements or listed, "cost": e["cost"],
                "mods": {"dur": 0, "wt": 0, "energyArmor": 0, "kineticArmor": 0, "woundsIgnored": 0, "actions": 0,
                         "defense": 0, "spd": 0, "init": 0},
                "biography": f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: Eclipse Phase {book['title']}, p. {e['page']}.</em></p>",
                "notes": "",
            }
            _id = make_id(book["title"], name)
            img = {"robot": "icons/svg/mystery-man-black.svg", "aircraft": "icons/svg/wing.svg"}.get(category, "icons/svg/wheel.svg")
            docs.append({"_id": _id, "_key": f"!actors!{_id}", "name": name, "type": "vehicle", "img": img, "system": system,
                         "items": [], "effects": [], "folder": folder, "sort": (len(docs) + 1) * 1000, "flags": {},
                         "ownership": {"default": 0},
                         "prototypeToken": {"name": name, "actorLink": False, "bar1": {"attribute": "damage"},
                                            "bar2": {"attribute": None}, "disposition": 0, "displayBars": 20, "texture": {"src": img}},
                         "_book": book["title"]})
    folder = make_id("folder", STARS["title"])
    folders.append({"_id": folder, "_key": f"!folders!{folder}", "name": STARS["title"], "type": "Actor", "folder": None,
                    "sorting": "a", "sort": (len(BOOKS) + 2) * 1000, "color": None, "flags": {}, "description": ""})
    docs += stars_docs(STARS, folder, len(docs))
    return folders, docs


# The Stars Our Destination: two spacecraft tables (read with pdftotext -table) and descriptions without costs, read
# column by column. A box across the page bottom (EVA RIDERS, pdf p. 11) is a band read after the columns above it.
STARS = {"file": "ps21806_thestarsourdestination_portrait.pdf", "title": "The Stars Our Destination", "offset": 1,
         "tables": [10, 12], "pages": (9, 12), "bands": {11: "EVA RIDERS"},
         # Table names whose heading differs; the type sections describe every ship of their type
         "headings": {"Autonomous Kill Vehicles": "KILL VEHICLES", "Shuttles": "SHUTTLES (SLOTVs)", "EVA Rider": "EVA RIDERS",
                      "Húli Jīng": "HÚLI J−ING (FOX SPIRIT)", "The Stars Our Destination": "FLAGSHIP: THE STARS OUR DESTINATION",
                      "Thoughtcrime": "THE FACTORY SHIP: THOUGHTCRIME", "Eight Arms": "EIGHT ARMS TO FONDLE YOU WITH",
                      "Dayuejin": "DAYUEJIN (GREAT LEAP FORWARD)", "We Come to Probe You": "WE COME TO PROBE YOU!"},
         "types": {"Scum Barge": "THE BARGE SHIPS", "Cargo Hauler": "CARGO HAULERS", "Mining Tug": "MINING TUGS",
                   "Salvage Ship": "SALVAGE VESSELS"},
         "names": {"Húli Jı¯ng": "Húli Jīng"}}
STARS_FURNITURE = re.compile(r"\s{3,}(THE STARS OUR DESTINATION|[. 1]{6,}.*|\d{1,3})$|^(THE STARS OUR DESTINATION|[. 1]{6,}.*|\d{1,3})$")


def column_chunks(book, page, band_heading=None):
    """[(page, lines)] of a two-column page in reading order: left then right column, band by band."""
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-layout", "-f", str(page), "-l", str(page),
                           os.path.join(FOLDER, book["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
    rows = [l.rstrip() for l in text.split("\n")]
    width = max(len(l) for l in rows)
    # The gutter: the column of blanks that separates the most rows holding text on both sides
    gutter = max(range(width // 3, 2 * width // 3), key=lambda x: sum(
        1 for l in rows if len(l) > x + 1 and l[x - 1:x + 1] == "  " and l[:x].strip() and l[x:].strip()))
    cut = next((i for i, l in enumerate(rows) if band_heading and l[:gutter].strip() == band_heading), len(rows))
    chunks = []
    for band in (rows[:cut], rows[cut:]):
        for side in ([l[:gutter] for l in band], [l[gutter:] for l in band]):
            # Running headers, page numbers, and the end-of-section glyph that prints as a lone "n"
            lines = [re.sub(r"\s+n$", "", STARS_FURNITURE.sub("", re.sub(r"[\x00-\x1f]", "", l).strip())) for l in side]
            lines = [l for l in lines if l]
            if lines:
                chunks.append((page - book["offset"], lines))
    return chunks


def cut_off(entry):
    """Whether a paragraph stops mid-sentence (table cells, without lowercase text, are not paragraphs)."""
    return bool(entry and entry[0] and re.search(r"[a-z]", entry[0][-1]) and not re.search(r"[.!?”)]$", entry[0][-1]))


def column_descriptions(book):
    """{heading: (text, page)} of the capitalized headings of the pages. A paragraph cut mid-sentence (by a column,
    a box or a page) resumes at the next column that starts in lowercase; the latest cut paragraph resumes first."""
    entries, suspended, current = {}, [], None
    first, last = book["pages"]
    for page in range(first, last + 1):
        for printed, lines in column_chunks(book, page, book["bands"].get(page)):
            if cut_off(entries.get(current)):
                suspended.append(current)
            current = suspended.pop() if (suspended and re.match(r"^[a-z]", lines[0])) else None
            for line in lines:
                # A heading: capitals only ("FLAGSHIP: THE STARS OUR DESTINATION", "HÚLI J−ING (FOX SPIRIT)")
                if len(re.findall(r"[A-Z]", line)) >= 3 and not re.search(r"[a-z]", re.sub(r"\(.*?\)", "", line)) \
                        and len(line) <= 60:
                    if cut_off(entries.get(current)):
                        suspended.append(current)
                    current = line
                    entries.setdefault(current, ([], printed))
                    continue
                if current:
                    entries[current][0].append(line)
    return {k: (supp.join(v), p) for k, (v, p) in entries.items()}


def stars_rows(book):
    """Rows of the spacecraft tables: name, type, crew, capacity, handling, armor, durability, wound threshold, drive."""
    rows = []
    for page in book["tables"]:
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-table", "-f", str(page), "-l", str(page),
                               os.path.join(FOLDER, book["file"]), "-"], capture_output=True).stdout.decode("utf-8", "replace")
        lines = [l.rstrip() for l in text.split("\n")]
        start = next(i for i, l in enumerate(lines) if re.match(r"^SPACECRAFT\s+TYPE", l.strip()))
        for l in lines[start + 1:]:
            cells = [c for c in re.split(r"\s{2,}", l.strip()) if c and not re.match(r"^[. 1]{6,}$", c)]
            if len(cells) >= 9:
                rows.append(cells[:9])
            elif len(cells) == 1 and rows and re.match(r"^[A-Z][a-z]+$", cells[0]):
                rows[-1][8] += " " + cells[0]  # "Metallic-Hydrogen / Rockets"
    if not rows:
        raise SystemExit("The Stars Our Destination: no spacecraft rows")
    return rows


def stars_docs(book, folder, start):
    texts = column_descriptions(book)
    docs = []
    for raw_name, kind, crew, capacity, handling, av, dur, wt, drive in stars_rows(book):
        name = book["names"].get(raw_name, raw_name)
        heading = book["headings"].get(name, name.upper())
        if heading not in texts:
            raise SystemExit(f"{book['title']}: no description for {name}")
        desc, page = texts[heading]
        # "Enhancements: ...", "Skills: ..." (the autonomous kill vehicles)
        listed = re.search(r"Enhancements:\s*(.*?)(?=\s(?:Weapons|Skills|Notes):|$)", desc)
        pilot = re.search(r"Pilot: Spacecraft (\d+)", desc)
        paragraphs = [desc] + ([texts[book["types"][kind]][0]] if kind in book["types"] else [])
        energy, kinetic = armor(av)
        system = {
            "category": "spacecraft", "passengers": f"Crew {crew}, capacity {capacity}".replace("—", "0"),
            "handling": number(handling), "movement": "", "maxVelocity": "", "mobility": "",
            "av": {"energy": energy, "kinetic": kinetic}, "durability": number(dur), "woundThreshold": number(wt),
            "deathRating": 0, "damage": {"value": 0}, "wounds": {"value": 0}, "pilot": int(pilot.group(1)) if pilot else 40,
            "enhancements": "; ".join(x for x in (listed.group(1) if listed else "", f"Drive: {drive}") if x), "cost": "",
            "mods": {"dur": 0, "wt": 0, "energyArmor": 0, "kineticArmor": 0, "woundsIgnored": 0, "actions": 0,
                     "defense": 0, "spd": 0, "init": 0},
            "biography": f"<p><strong>{html.escape(kind)}.</strong></p>" +
                         "".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs) +
                         f"<p><em>Source: Eclipse Phase {book['title']}, p. {page}.</em></p>",
            "notes": "",
        }
        _id = make_id(book["title"], name)
        img = "icons/svg/wheel.svg"
        docs.append({"_id": _id, "_key": f"!actors!{_id}", "name": name, "type": "vehicle", "img": img, "system": system,
                     "items": [], "effects": [], "folder": folder, "sort": (start + len(docs) + 1) * 1000, "flags": {},
                     "ownership": {"default": 0},
                     "prototypeToken": {"name": name, "actorLink": False, "bar1": {"attribute": "damage"},
                                        "bar2": {"attribute": None}, "disposition": 0, "displayBars": 20, "texture": {"src": img}},
                     "_book": book["title"]})
    return docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if not f.startswith(("core-", "_folder-core")):
            os.remove(os.path.join(d, f))
    for x in folders:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"_folder-{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        book = x.pop("_book").lower()
        slug = re.sub(r"[^a-z0-9]+", "-", f"{book}-{x['name'].lower()}").strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, "(supplements)", len(docs))


folders, docs = build()
summary = [(x["_book"], x["name"], x["system"]) for x in docs]
write(folders, docs)
if "--summary" in sys.argv:
    sys.stdout.reconfigure(encoding="utf-8")
    for book, name, s in summary:
        print(f"{book[:12]:12} {name[:26]:26} {s['category']:11} {s['handling']:>4} {s['movement']:14} {s['maxVelocity'][:14]:14} "
              f"{s['av']['energy']}/{s['av']['kinetic']:<3} {s['durability']:>4} {s['woundThreshold']:>3} {s['deathRating']:>4} "
              f"{s['mobility'][:12]:12} {s['cost'][:10]:10} {len(s['enhancements']):3} {len(s['biography'])}")
