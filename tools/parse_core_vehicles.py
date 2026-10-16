"""Build the robot and vehicle actors of the EP1e Core Rulebook (pp. 343-346).

Usage (requires xpdf/poppler pdftotext and your own copy of the PDF):
    python -I tools/parse_core_vehicles.py "<path>/Eclipse Phase - Core Rulebook.pdf" packs/_source [--summary]

Descriptions come from the Gear chapter entries ("Name: text [Cost]"); stats from tools/data/core_vehicles.py,
transcribed from the rendered tables and checked here cell by cell against each table page's text.
"""
import hashlib, html, json, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
import parse_core_equipment as equipment  # noqa: E402
import core_vehicles as TABLES  # noqa: E402

PDF, OUT = sys.argv[1], sys.argv[2]
equipment.PDF = PDF
PACK = "vehicles"
SOURCE = "Eclipse Phase Core Rulebook"

SECTIONS = [("Aircraft", "aircraft"), ("Exoskeletons", "exoskeleton"), ("Groundcraft", "groundcraft"),
            ("Personal Vehicles", "personal"), ("Robots", "robot")]
IMAGES = {"robot": "icons/svg/mystery-man-black.svg", "aircraft": "icons/svg/wing.svg", "groundcraft": "icons/svg/wheel.svg",
          "personal": "icons/svg/wingfoot.svg"}


def page_text(page):
    text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(page), "-l", str(page), PDF, "-"],
                          capture_output=True).stdout.decode("utf-8", "replace")
    return re.sub(r"\s+", " ", text).replace("−", "–")


def check(name, cells, text):
    for cell in (name,) + tuple(cells):
        if cell != "—" and cell not in text:
            raise SystemExit(f"Transcribed cell {cell!r} of {name} not found on its table page")


def number(cell):
    m = re.search(r"[+–-]?\d+", cell.replace(",", ""))
    return int(m.group(0).replace("–", "-")) if (m and cell != "—") else 0


def armor(cell):
    """'12/10' -> (12, 10); '+5/+5' -> (5, 5); '5' -> (5, 5); '—' -> (0, 0)."""
    values = [abs(int(x)) for x in re.findall(r"[+–-]?\d+", cell.replace("–", "-"))]
    if not values:
        return 0, 0
    return (values[0], values[1]) if len(values) > 1 else (values[0], values[0])


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def actor(name, system, category, folder, sort):
    _id = make_id(name)
    return {
        "_id": _id, "_key": f"!actors!{_id}", "name": name, "type": "vehicle", "img": IMAGES.get(category, "icons/svg/cowled.svg"),
        "system": system, "items": [], "effects": [], "folder": folder, "sort": sort, "flags": {},
        "ownership": {"default": 0},
        "prototypeToken": {"name": name, "actorLink": False, "bar1": {"attribute": "damage"}, "bar2": {"attribute": None},
                           "disposition": 0, "displayBars": 20, "texture": {"src": IMAGES.get(category, "icons/svg/cowled.svg")}},
    }


def build():
    found = equipment.entries(345, 349, SECTIONS, ("Spacecraft", "Robots"))
    descriptions = {e["name"]: e for e in found if e["category"] != "exoskeleton"}
    folder = make_id("folder", "Core")
    folders = [{"_id": folder, "_key": f"!folders!{folder}", "name": "Core", "type": "Actor", "folder": None,
                "sorting": "a", "sort": 1000, "color": None, "flags": {}, "description": ""}]
    docs = []
    rows = [(c, n, r) for c, table in TABLES.VEHICLES.items() for n, r in table.items()] + \
           [("robot", n, r) for n, r in TABLES.ROBOTS.items()]
    for category, name, row in rows:
        check(name, row[:-1] if category == "robot" else row, page_text(TABLES.PAGES[category]))
        e = descriptions.get(name)
        if not e:
            raise SystemExit(f"No description found for {name}")
        desc, cost = equipment.split_cost(e["text"])
        description = f"<p>{html.escape(desc, quote=False)}</p><p><em>Source: {SOURCE}, p. {e['page']}.</em></p>"
        if category == "robot":
            movement, velocity, av, dur, wt, mobility, enhancements = row
            passengers, handling = "", 0
        else:
            passengers, handling_cell, movement, velocity, av, dur, wt = row
            handling, mobility, enhancements = number(handling_cell), "", ""
        energy, kinetic = armor(av)
        system = {
            "category": category, "passengers": passengers, "handling": handling,
            "movement": "" if movement == "—" else movement, "maxVelocity": velocity, "mobility": mobility,
            "av": {"energy": energy, "kinetic": kinetic}, "durability": number(dur), "woundThreshold": number(wt),
            "damage": {"value": 0}, "wounds": {"value": 0}, "pilot": 40, "enhancements": enhancements, "cost": cost,
            "mods": {"dur": 0, "wt": 0, "energyArmor": 0, "kineticArmor": 0, "woundsIgnored": 0, "actions": 0, "defense": 0,
                     "spd": 0, "init": 0},
            "biography": description, "notes": "",
        }
        docs.append(actor(name, system, category, folder, (len(docs) + 1) * 1000))
    return folders, docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for x in folders:
        with open(os.path.join(d, f"_folder-{x['name'].lower()}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"core-{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs))


folders, docs = build()
write(folders, docs)
if "--summary" in sys.argv:
    sys.stdout.reconfigure(encoding="utf-8")
    for x in docs:
        s = x["system"]
        print(f"{x['name'][:16]:16} {s['category']:11} {s['handling']:>4} {s['movement']:6} {s['maxVelocity']:12} "
              f"{s['av']['energy']}/{s['av']['kinetic']:<3} {s['durability']:>4} {s['woundThreshold']:>3} {s['cost'][:10]:10} "
              f"{len(s['biography'])}")
