"""Build the derangements and mental disorders (Core pp. 210-214, Transhuman pp. 92 and 154) as trait items.

Usage (requires xpdf/poppler pdftotext and your own copies of the PDFs):
    python -I tools/parse_mental.py "<folder with the Eclipse Phase PDFs>" packs/_source [--summary]

pdftotext (reading order mode) prints each entry as its name on its own line, then its paragraphs. A derangement's
name carries its severity ("Anxiety (Minor)"); a disorder ends with its "Suggested Game Effects". Derangements become
traits with the key "derangement" and a level for their severity (1 minor, 2 moderate, 3 major); disorders become
"Mental Disorder (...)" traits with the key of the Mental Disorder trait (p. 150), so that the rules that look for it
(the Psi trait) find them.
"""
import hashlib, html, json, os, re, subprocess, sys

FOLDER, OUT = sys.argv[1], sys.argv[2]
PACK = "mental-health"
SEVERITY = {"Minor": 1, "Moderate": 2, "Major": 3}
SOURCES = [
    {"file": "Eclipse Phase - Core Rulebook.pdf", "book": "Core Rulebook", "offset": 2, "pages": (212, 216),
     "derangements": ("Derangements", "Disorders"), "disorders": ("Disorders", "Stressful Situations")},
    {"file": "eclipse phase transhuman.pdf", "book": "Transhuman", "offset": 3, "pages": (157, 158),
     "disorders": ("WATTS-MACLEOD DISORDERS", "USER’S GUIDE TO FORKS"), "caps": True, "skip_intro": True},
    {"file": "eclipse phase transhuman.pdf", "book": "Transhuman", "offset": 3, "pages": (95, 95),
     "disorders": ("PHOBIA DISORDER", "COMMON PHOBIAS"), "caps": True, "keep_heading": True},
]
JUNK = re.compile(r"^(\d{1,3}|(\.\d)+.*|\.\d.*|actions and combat|Synopsis Welcome to Firewall|A Time of Eclipse.*|"
                  r"Skills Action and Combat|Mind Hacks The Mesh|Accelerated Future Gear|Running the Game Reference|"
                  r"Action and Combat.*|The Mesh Accelerated Future|Gear Running the Game|Reference|PLAYING CHARACTERS|"
                  r"MORPHS|CHARACTER OPTIONS|.*CREATION: (PACKAGES|LIFE PATH))$")


def lines(source):
    out = []
    for p in range(source["pages"][0], source["pages"][1] + 1):
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), os.path.join(FOLDER, source["file"]), "-"],
                              capture_output=True).stdout.decode("utf-8", "replace")
        for l in text.split("\n"):
            l = re.sub(r"[\x00-\x1f]", "", l).strip()
            if l and not JUNK.match(l):
                out.append((l, p - source["offset"]))
    return out


def join(parts):
    """Paragraphs of the lines: a line starting in lowercase continues the paragraph before it."""
    paragraphs = []
    for l in parts:
        if paragraphs and (re.match(r"^[a-z]", l) or re.search(r"[a-z,-]$", paragraphs[-1])):
            sep = "" if re.search(r"[a-z]-$", paragraphs[-1]) and re.match(r"^[a-z]", l) else " "
            paragraphs[-1] = (paragraphs[-1][:-1] if sep == "" else paragraphs[-1]) + sep + l
        else:
            paragraphs.append(l)
    return [re.sub(r"\s+", " ", p) for p in paragraphs]


def section(tagged, start, end):
    texts = [l for l, _ in tagged]
    a = next(i for i, l in enumerate(texts) if l == start or l.startswith(start))
    b = next((i for i in range(a + 1, len(texts)) if texts[i].startswith(end)), len(texts))
    return tagged[a:b]


def is_heading(line, caps):
    if caps:
        return len(re.findall(r"[A-Z]", line)) >= 3 and not re.search(r"[a-z]", line)
    return len(line.split()) <= 6 and bool(re.match(r"^[A-Z]", line)) and not re.search(r"[.,:;]$", line) and \
        not re.match(r"^(Suggested|Possible) Game Effects?:", line)


def entries(source, kind):
    tagged = section(lines(source), *source[kind])
    keep = source.get("keep_heading")
    if not keep:
        tagged = tagged[1:]  # the section title
    out = []
    for i, (line, page) in enumerate(tagged):
        nxt = tagged[i + 1][0] if i + 1 < len(tagged) else ""
        heading = is_heading(line, source.get("caps")) and (kind != "derangements" or re.search(r"\((Minor|Moderate|Major)\)$", line))
        # A disorder's name is followed by its description (a sentence), not by another short line
        if heading and kind == "disorders" and not source.get("caps") and (len(nxt) < 40 and not re.search(r"[.]$", nxt)):
            heading = False
        if heading:
            out.append({"name": line, "page": page, "lines": []})
        elif out:
            out[-1]["lines"].append(line)
    if source.get("skip_intro"):
        out = [e for e in out if e["lines"]]
    return out


def title(caps):
    small = {"and", "of", "the", "or", "to", "in", "for", "a", "an", "with"}
    words = caps.lower().split()
    return " ".join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))


def make_id(*parts):
    return hashlib.sha1(":".join((PACK,) + parts).encode()).hexdigest()[:16]


def trait(name, key, level, cost, cost_text, paragraphs, book, page, folder, sort):
    desc = "".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs) + \
        f"<p><em>Source: Eclipse Phase {book}, p. {page}.</em></p>"
    _id = make_id(book, name)
    return {"_id": _id, "_key": f"!items!{_id}", "name": name, "type": "trait", "img": "icons/svg/downgrade.svg",
            "system": {"description": desc, "key": key, "traitType": "negative", "scope": "ego", "level": level, "cost": cost,
                       "costText": cost_text},
            "effects": [], "flags": {}, "folder": folder, "sort": sort, "ownership": {"default": 0}}


def build():
    folders = {k: make_id("folder", k) for k in ("Derangements", "Disorders (Core)", "Disorders (Transhuman)")}
    docs = []
    for source in SOURCES:
        if "derangements" in source:
            for e in entries(source, "derangements"):
                m = re.match(r"^(.+) \((Minor|Moderate|Major)\)$", e["name"])
                name = f"Derangement: {m.group(1)} ({m.group(2)})"
                docs.append(trait(name, "derangement", SEVERITY[m.group(2)], 0, f"Derangement ({m.group(2)}), lasts 1d10 ÷ 2 hours",
                                  join(e["lines"]), source["book"], e["page"], folders["Derangements"], (len(docs) + 1) * 1000))
        for e in entries(source, "disorders"):
            base = title(e["name"]) if source.get("caps") else e["name"]
            base = re.sub(r" Disorder$", "", base) if base.startswith("Phobia") else base
            name = f"Mental Disorder ({base})"
            folder = folders["Disorders (Core)" if source["book"] == "Core Rulebook" else "Disorders (Transhuman)"]
            paragraphs = join(e["lines"])
            # Phobia Disorder is printed as a trait: its cost line opens the description
            paragraphs = [re.sub(r"^Bonus: 10 CP\s*", "", p) for p in paragraphs]
            docs.append(trait(name, "mentalDisorder", 1, 10, "Bonus: 10 CP", paragraphs, source["book"], e["page"], folder,
                              (len(docs) + 1) * 1000))
    return folders, docs


def write(folders, docs):
    d = os.path.join(OUT, PACK)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for n, (name, fid) in enumerate(folders.items()):
        doc = {"_id": fid, "_key": f"!folders!{fid}", "name": name, "type": "Item", "folder": None, "sorting": "a",
               "sort": (n + 1) * 1000, "color": None, "flags": {}, "description": ""}
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        with open(os.path.join(d, f"_folder-{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    for x in docs:
        slug = re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")
        with open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8") as fh:
            json.dump(x, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    print(PACK, len(docs))


if __name__ == "__main__":
    folders, docs = build()
    write(folders, docs)
    if "--summary" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        for x in docs:
            t = re.sub("<[^>]+>", " | ", x["system"]["description"])
            print(f"{x['name'][:44]:44} L{x['system']['level']} {len(t):5} {t[:70]} ... {t[-110:-60]}")
