"""Stats of the Core Rulebook substance tables (Drugs p. 320, Nanodrugs p. 321, Toxins p. 325).

pdftotext cannot read these tables reliably: with -layout the shaded rows lose their cells or shift to the
neighbouring row, and the plain text stream lists the toxin columns interleaved. The rows below were
transcribed from the rendered pages; tools/parse_core_equipment.py checks every cell against the table's
text before using them.

Columns: type (chem, bio, nano), application (D dermal, Inh inhaled, Inj injected, O oral), onset time,
duration, addiction modifier ("" when the table shows a dash), addiction type ("" when none).
"""

DRUGS = {
    # Cognitive drugs
    "Drive": ("chem", "O", "20 minutes", "8 hours", "", "mental"),
    "Klar": ("chem", "O", "20 minutes", "8 hours", "", "mental"),
    "Neem": ("chem", "O", "20 minutes", "12 hours", "", "mental"),
    # Combat drugs
    "BringIt": ("bio", "Inh, Inj, O", "1 minute", "15 minutes", "+10", "physical"),
    "Grin": ("chem", "Inh, Inj, O", "3 Action Turns", "3 hours", "–10", "physical"),
    "Kick": ("chem", "Inh, Inj, O", "3 Action Turns", "2 hours", "–10", "physical"),
    "MRDR": ("chem", "O", "20 minutes", "1 hour", "–10", "physical"),
    "Phlo": ("chem", "O", "20 minutes", "1 hour", "–10", "physical"),
    # Health drugs
    "Bananas Furiosas": ("chem", "O", "20 minutes", "1 day", "", ""),
    "Comfurt": ("bio", "O", "20 minutes", "12 hours", "–10", "mental"),
    # Recreational drugs
    "Buzz": ("chem", "Inh, O", "1 hour", "36 hours", "", "mental"),
    "Mono No Aware": ("chem", "O", "20 minutes", "8 hours", "–10", "mental"),
    "Orbital Hash": ("chem", "Inh", "3 minutes", "3 hours", "", "mental"),
    # Social drugs
    "Alpha": ("bio", "Inh", "1 minute", "2 hours", "–10", "mental"),
    "Hither": ("bio", "D", "1 minute", "6 hours", "–10", "physical"),
    "Juice": ("chem", "O, Inh", "20 minutes", "8 hours", "", "mental"),
}

# The nanodrug table has no onset column
NANODRUGS = {
    "Frequency": ("nano", "Inj, O", "", "8 hours", "–10", "mental"),
    "Gravy": ("nano", "Inj, O", "", "special", "", ""),
    "Petals": ("nano", "O", "", "2 hours–1 day", "+10 to –20", "mental"),
    "Schizo": ("nano", "Inj", "", "1 day", "", "mental"),
}

# The toxin table has no addiction columns. Psike-Out's addiction modifier (–10, mental) is given in its text.
TOXINS = {
    # Chemical toxins (the text names BTX² "BTX")
    "BTX": ("chem", "D, Inj, O", "1 Action Turn", "3 Action Turns/1 hour", "", ""),
    "CR Gas": ("chem", "D, Inh", "1 Action Turn", "20 minutes", "", ""),
    "Flight": ("bio", "Inh", "3 Action Turns", "1 hour", "", ""),
    "Nervex": ("chem", "D, Inh, Inj, O", "1 minute", "death", "", ""),
    "Oxytocin-A": ("bio", "Inh, Inj", "3 minutes", "2 hours", "", ""),
    "Twitch": ("chem", "D, Inh, Inj, O", "3 Action Turns", "10 minutes", "", ""),
    # Nanotoxins (the table calls Disruption "Degeneration")
    "Disruption": ("nano", "Inj, O", "Immediate", "8 hours", "", ""),
    "Necrosis": ("nano", "Inj, O", "3 Action Turns", "1 minute", "", ""),
    "Neuropath": ("nano", "D, Inj, O", "3 Action Turns", "8 hours", "", ""),
    "Nutcracker": ("nano", "Inj, O", "Immediate", "6 hours", "", ""),
    # Psi drugs
    "Inhibitor": ("chem", "Inj, O", "3 Action Turns", "6 hours", "", ""),
    "Psi-Opener": ("bio", "Inj, O", "20 minutes", "1 hour", "", ""),
    "Psike-Out": ("chem", "Inj, O", "1 minute", "1 hour", "–10", "mental"),
}

# Table names that differ from the description headings
TABLE_NAMES = {"BTX": "BTX2", "Disruption": "Degeneration"}
