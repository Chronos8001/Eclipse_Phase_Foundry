"""Kinetic Ammunition table of the Core Rulebook (p. 337): AP and DV modifiers of each ammunition type.

pdftotext prints this table's cells out of order (each column as a run of values, with blank cells dropped), so
the rows below were transcribed from the rendered page; tools/parse_core_equipment.py checks every cell against
the table text. "—" means no modifier.
"""

AMMO = {
    "Armor-Piercing": ("–5", "–2"),
    "Bug": ("+1", "–1d10"),
    "Capsule": ("+1", "–half"),
    "Flux": ("as ammo type", "as ammo type"),
    "Hollow-Point": ("+2", "+1d10"),
    "Jammer": ("—", "no damage"),
    "Plastic": ("(AV doubled)", "–half"),
    "Reactive": ("–2", "+2"),
    "Reactive Armor-Piercing (RAP)": ("–6", "–1"),
    "Regular Ammo": ("—", "—"),
    "Splash": ("—", "no damage"),
    "Zap": ("+2", "–half + shock (p. 204)"),
    # Smart ammo
    "Accushot": ("—", "—"),
    "Biter": ("—", "+1d10"),
    "Flayer": ("—", "+2"),
    "Homing": ("—", "—"),
    "Laser-Guided": ("—", "—"),
    "Proximity": ("–1", "+2"),
    "Zero": ("—", "—"),
}
