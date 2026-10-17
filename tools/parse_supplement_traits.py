"""Build the traits of the supplements (Transhuman, Sunward, Rimward, Gatecrashing, Panopticon, Firewall) as items.

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_supplement_traits.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext (reading order mode) prints each trait as its name in capitals ("DRUG EXCEPTION (EGO OR MORPH TRAIT)"),
then a paragraph opening with its "Cost: 10 CP" (positive) or "Bonus: 10 CP" (negative), as in the Core Rulebook.
The scope comes from the name, as in tools/parse_core.py; the key, from the name without it, so that a trait of the
same name as a Core trait would share its key.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = "supplement-traits"
BOOKS = [
    {"file": "eclipse phase transhuman.pdf", "title": "Transhuman", "offset": 3, "pages": (85, 97)},
    {"file": "ep sunward.pdf", "title": "Sunward", "offset": 3, "pages": (167, 168)},
    # A sidebar: each cost is printed after its trait's description, and read in content order only
    {"file": "eclipse phase rimward.pdf", "title": "Rimward", "offset": 3, "pages": (191, 191), "raw": True, "cost_after": True},
    # A morph trait that counts as neither positive nor negative (p. 153)
    {"file": "Eclipse Phase gatecrashing.pdf", "title": "Gatecrashing", "offset": 3, "pages": (156, 156), "special": "SPECIAL TRAIT"},
    {"file": "Eclipse Phase panopticon.pdf", "title": "Panopticon", "offset": 2, "pages": (147, 150)},
    {"file": "eclipse phase firewall.pdf", "title": "Firewall", "offset": 2, "pages": (174, 175)},
]
COST = re.compile(r"^(Cost|Bonus): ((?:\d+ CP(?: \([^)]*\))?(?:,? (?:or )?)?)+)\s*")
# Running headers, chapter tabs ("RACTER CREATION: PACKAGES ..."), page references of sidebars ("SPHERE SYNTHMORPH n p. 196")
JUNK = re.compile(r"^(\d{1,3}|(\.\d)+.*|GAME INFORMATION|CHARACTER OPTIONS.*|PLAYING CHARACTERS|MORPHS|.*CREATION:.*|.* n p\. ?\d+|"
                  r"SURVEILLANCE|HABITATS|UPLIFTS|FIREWALL|OTHER GROUPS|SOL-MERCURY.*|EARTH ORBIT.*|THE PLANETARY CONSORTIUM.*|"
                  r"MAIN BELT.*|SATURN.*|.*GAME INFORMATION)$")
SECTIONS = {"POSITIVE TRAITS": "positive", "NEGATIVE TRAITS": "negative"}


def lines(book):
    out = []
    for p in range(book["pages"][0], book["pages"][1] + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8"] + (["-raw"] if book.get("raw") else []) +
                              ["-f", str(p), "-l", str(p), os.path.join(FOLDER, book["file"]), "-"],
                              capture_output=True).stdout.decode("utf-8", "replace")
        for l in text.split("\n"):
            l = re.sub(r"[\x00-\x1f]", "", l).strip()
            if l and not JUNK.match(l):
                out.append((l, p - book["offset"]))
    return out


def is_caps(line):
    line = line.replace("AGIs", "AGIS")  # "MACHINE INTUITION (AGIs ONLY)"
    return len(re.findall(r"[A-Z]", line)) >= 3 and not re.search(r"[a-z]", line) and len(line) <= 90


def join(parts):
    text = ""
    for l in parts:
        if re.search(r"[a-z]-$", text) and re.match(r"^[a-z]", l):
            text = text[:-1] + l
        else:
            text = f"{text} {l}".strip()
    return re.sub(r"\s+", " ", text)


def entries(book):
    """[{name, page, cost, polarity, lines}]: a capitalized name followed by its Cost/Bonus paragraph."""
    tagged = lines(book)
    out, current = [], None
    for i, (line, page) in enumerate(tagged):
        nxt = tagged[i + 1][0] if i + 1 < len(tagged) else ""
        # A trait name: followed by its cost, or (sidebars) a "(MORPH TRAIT)" heading whose cost comes last
        if is_caps(line) and (COST.match(nxt) or (book.get("cost_after") and line.endswith("TRAIT)")) or
                              (book.get("special") and i > 0 and any(book["special"] in l for l, _ in tagged[max(0, i - 3):i]))):
            current = {"name": line, "page": page, "lines": []}
            out.append(current)
            continue
        if current is None:
            continue
        if book.get("cost_after") and COST.match(line):
            # The cost closes the entry: put it first, as in the other books
            current["lines"].insert(0, line)
            current = None
            continue
        if is_caps(line) and line not in SECTIONS:
            # Another heading (a sidebar, a section): the trait is over
            current = None
            continue
        if line in SECTIONS:
            current = None
            continue
        current["lines"].append(line)
    return out


def title(caps):
    small = {"and", "of", "the", "or", "to", "in", "for", "a", "an", "with", "on", "by"}
    words = caps.lower().split()
    name = " ".join(w if (i and w in small) else re.sub(r"^([^a-z]*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
                    for i, w in enumerate(words))
    name = re.sub(r"([-/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), name)
    return re.sub(r"\b(Agi|Ai|Xp|Vr|Ar|Grm)\b", lambda m: m.group(1).upper(), name).replace("’S", "’s").replace("Agis", "AGIs")


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def build():
    core = {json.load(open(os.path.join(ROOT, "packs", "_source", "traits", f), encoding="utf8"))["name"].lower()
            for f in os.listdir(os.path.join(ROOT, "packs", "_source", "traits"))}
    folders, docs, skipped = {}, [], []
    for b, book in enumerate(BOOKS):
        folders[book["title"]] = make_id("folder", book["title"])
        for e in entries(book):
            text = join(e["lines"])
            m = COST.match(text)
            polarity = "positive" if (m and m.group(1) == "Cost") else ("negative" if m else "neutral")
            cost_text = f"{m.group(1)}: {m.group(2).strip()}" if m else "Neither positive nor negative (no CP)"
            desc = text[m.end():] if m else text
            name = title(e["name"])
            scope = "ego"
            sm = re.search(r"\s*\((Ego or Morph|Morph) Trait\)", name, re.I)
            if sm:
                scope = "both" if sm.group(1).lower().startswith("ego") else "morph"
                name = (name[:sm.start()] + name[sm.end():]).strip()
            # A restriction in the name ("Dominant Strain (Asyncs Only)") moves to the description
            rm = re.search(r"\s*\(([^)]*Only)\)$", name, re.I)
            if rm:
                if "only available" not in desc[:200]:
                    desc = f"{rm.group(1)}. {desc}"
                name = name[:rm.start()].strip()
            if book.get("special"):
                scope = "morph"
            if name.lower() in core:
                skipped.append(f"{book['title']}: {name} (Core)")
                continue
            costs = [int(x) for x in re.findall(r"(\d+) CP", cost_text)]
            words = re.sub(r"[^A-Za-z0-9 ]+", " ", name).split()
            _id = make_id(book["title"], name)
            docs.append({
                "_id": _id, "_key": f"!items!{_id}", "name": name, "type": "trait",
                "img": {"positive": "icons/svg/upgrade.svg", "negative": "icons/svg/downgrade.svg"}.get(polarity, "icons/svg/aura.svg"),
                "system": {"key": words[0].lower() + "".join(w.capitalize() for w in words[1:]),
                           "traitType": polarity, "scope": scope, "level": 1,
                           "cost": costs[0] if costs else 0, "costText": cost_text,
                           "description": f"<p>{html.escape(desc, quote=False)}</p>"
                                          f"<p><em>Source: Eclipse Phase {book['title']}, p. {e['page']}.</em></p>"},
                "effects": [], "flags": {}, "folder": folders[book["title"]], "sort": (len(docs) + 1) * 1000,
                "ownership": {"default": 0}})
    return folders, docs, skipped


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for n, (name, fid) in enumerate(folders.items()):
        doc = {"_id": fid, "_key": f"!folders!{fid}", "name": name, "type": "Item", "folder": None, "sorting": "a",
               "sort": (n + 1) * 1000, "color": None, "flags": {}, "description": ""}
        with open(os.path.join(d, f"_folder-{name.lower()}.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    by_folder = {v: k for k, v in folders.items()}
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", f"{by_folder[x['folder']]}-{x['name']}".lower()).strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs))


if __name__ == "__main__":
    folders, docs, skipped = build()
    write(folders, docs)
    sys.stdout.reconfigure(encoding="utf-8")
    print("skipped:", "; ".join(skipped))
    if "--summary" in sys.argv:
        by_folder = {v: k for k, v in folders.items()}
        for x in docs:
            s = x["system"]
            t = re.sub("<[^>]+>", " ", s["description"])
            print(f"{by_folder[x['folder']][:5]} {x['name'][:30]:30} {s['traitType'][:3]} {s['scope'][:4]} {s['costText'][:34]:34} {len(t):5} …{t[-90:-50]}")
