"""Robot and vehicle tables of the Core Rulebook (pp. 343-346).

pdftotext prints these tables with their cells out of order (rows interleaved, blank cells dropped), so the rows
below were transcribed from the rendered pages; tools/parse_core_vehicles.py checks every cell against the text
of the table's page. Exoskeletons (p. 344) are already armor items and are left out.

Vehicles: passengers, handling, movement rate, max velocity, armor (energy/kinetic), durability, wound threshold.
"—" is a blank cell. The rocket and thruster packs list an armor bonus for their wearer (+5/+5, +4/+4);
the EVA sled lists a single armor value (5).
"""

VEHICLES = {
    "aircraft": {
        "Microlight": ("1", "+20", "8/40", "100", "—", "30", "10"),
        "Portable Plane": ("2", "+10", "—", "200–250", "10/6", "50", "10"),
        "Rocket Buggy": ("4", "–10", "8/32", "2,500–3,000", "24/16", "100", "20"),
        "Small Jet": ("6", "+20", "—", "650-900", "30/20", "200", "30"),
    },
    "groundcraft": {
        "Cycle": ("1–3", "+20", "4/40", "120", "12/10", "50", "10"),
        "Mars Buggy": ("2–6", "+10", "8/32", "40/90/110", "30/20", "150", "30"),
    },
    "personal": {
        "EVA Sled": ("1", "–30", "4/16", "16", "5", "40", "8"),
        "Rocket Pack": ("1", "–20", "—", "700", "+5/+5", "40", "8"),
        "Thruster Pack": ("1", "–10", "4/20", "40", "+4/+4", "30", "6"),
    },
}

# Robots: movement rate, max velocity, armor, durability, wound threshold, mobility system, enhancements
ROBOTS = {
    "Automech": ("4/8", "8", "4/4", "30", "6", "Wheeled/Vector-Thrust",
                 "Access Jacks, Electrical Sense, Extra Limbs (4), Headlights, Magnetic System, Radiation sense, Utilitool, misc. tools"),
    "Creepy": ("4/12", "12", "2/2", "25", "5", "Walker or Hopper",
               "+5 COO, Access Jacks, Chameleon Skin, Extra Limbs (2-8), Grip Pads"),
    "Dr. Bot": ("4/16", "16", "—", "40", "8", "Wheeled",
                "Access Jacks, Enhanced Smell, Fabber, Fractal Digits, Healing Vat, Nanoscopic Vision"),
    "Dwarf": ("4/12", "20", "16/12", "150", "30", "Walker",
              "+10 SOM, Access Jacks, Extra Limbs (4), Industrial Armor, Radar, Sonar, misc. tools"),
    "Gnat": ("8/40", "60", "2/2", "25", "5", "Rotor",
             "360-Degree Vision, Access Jacks, Enhanced Hearing, Enhanced Vision, Radar"),
    "Guardian Angel": ("8/40", "80", "14/12", "40", "8", "Rotor",
                       "+5 REF, 360-Degree Vision, Access Jacks, Chameleon Skin, Eelware, Enhanced Hearing, Enhanced Smell, "
                       "Enhanced Vision, Lidar, Light Combat Armor, Neurachem, T-Ray Emitter"),
    "Saucer": ("8/40", "200", "2/2", "25", "5", "Ionic",
               "360-Degree Vision, Access Jacks, Chameleon Skin, Enhanced Hearing, Enhanced Vision, Radar"),
    "Servitor": ("4/20", "20", "4/4", "30", "6", "Walker or Wheeled", "Access Jacks, Extra Limbs (2-6)"),
    "Speck": ("1/5", "5", "—", "5", "1", "Winged/Hopper",
              "+5 REF, +5 COO, –10 SOM, Access Jacks, Grip Pads, Enhanced Hearing, Enhanced Vision, Synthetic Mask"),
}

# PDF page of each table (for the cell check)
PAGES = {"aircraft": 345, "groundcraft": 347, "personal": 347, "robot": 348}
