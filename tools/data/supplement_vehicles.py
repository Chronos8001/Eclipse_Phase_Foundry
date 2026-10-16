"""Robot and vehicle tables of the supplements that pdftotext cannot read in order.

The vehicle tables (and the robot tables laid out like them) print their cells column by column or interleaved,
so the rows below were transcribed from the rendered pages; tools/parse_supplement_vehicles.py checks every cell
against the text of the table's page. The robot tables of Gatecrashing, Panopticon, Firewall and Transhuman are
read in order by the script and are not listed here.

Columns: passengers, handling, movement rate, max velocity, armor, durability, wound threshold, death rating
("" when the table has no such column), mobility system ("" for vehicles). "—" is a blank cell.
"""

TABLES = {
    "Sunward": {
        "page": 173,
        "rows": {
            "Interceptor": ("", "", "12/200", "NA", "20/20", "150", "50", "300", "Thrust Vector"),
            "Scorcher": ("", "", "2/4", "12", "25/20", "200", "40", "400", "Walker"),
            "Cargo Hauler": ("2 (more as cargo)", "0", "4/32", "120", "20/15", "250", "50", "500", ""),
            "Flying Car": ("4", "0", "8/40 (ground)", "30/180 (ground)", "20/10", "150", "30", "300", ""),
            "Flying Car (Security Model)": ("4", "+10", "8/60 (ground)", "40/200 (ground)", "20/20", "200", "40", "400", ""),
            "Ground Car": ("2", "+10", "8/40", "180", "20/10", "150", "30", "300", ""),
            "Martian Maglev Train": ("30–60", "0", "4/40", "500", "20/15", "150", "30", "300", ""),
            "Martian Rover": ("6", "0", "8/32", "100", "20/15", "200", "40", "400", ""),
            "Martian Trike": ("3", "0", "4/40", "100", "15/10", "60", "12", "120", ""),
            "Passenger Airship": ("100", "–20", "—", "100", "5/5", "300", "10", "350", ""),
            "Passenger Balloon": ("10", "–30", "—", "100", "—/—", "20", "5", "30", ""),
            "Siftrunner": ("6", "0", "8/32", "80", "30/15", "200", "40", "400", ""),
            "Venusian Hauler": ("—", "–10", "2/16", "80", "30/20", "200", "40", "400", ""),
        },
        # Flying cars move on the ground and fly: the table gives both
        "notes": {"Flying Car": "Air: movement —, max velocity 200.", "Flying Car (Security Model)": "Air: movement —, max velocity 220."},
    },
    "Rimward": {
        "page": 195,
        "rows": {
            "Aerostat": ("0–4", "–0", "4/20", "100", "—", "20", "5", "40", "Microlight"),
            "Defense Platform": ("—", "–20", "8/40", "NA", "16/16", "250", "50", "500", "Thrust Vector"),
        },
    },
    "Rimward vehicles": {
        "book": "Rimward",
        "page": 196,
        "rows": {
            "Deep Sea Submarine": ("4", "–20", "4/20", "30", "30/30", "250", "50", "500", ""),
            "Diving Exoskeleton": ("1", "—", "4/20", "30", "15/15", "60", "12", "120", ""),
            "Diving Sled": ("2", "–20", "4/16", "20", "5", "40", "8", "80", ""),
            "Fast Transport": ("120/200", "—", "NA", "NA", "20", "750", "150", "1,500", ""),
            "Methane Skiff": ("6", "–10", "4/40", "60", "5/5", "125", "25", "250", ""),
            "Outsystem Hover": ("6", "+10", "8/32", "150", "30/20", "150", "30", "300", ""),
            "Outsystem Skimmer": ("8", "+20", "12/200", "NA", "20", "320", "80", "640", ""),
            "Titanian Cargo Copter": ("32", "—", "4/40", "150", "20/20", "250", "50", "500", ""),
            "Utility Helicopter": ("8", "+10", "8/40", "200", "20/10", "150", "30", "300", ""),
        },
    },
    "Gatecrashing": {
        "page": 166,
        "rows": {
            "Back Wing": ("1", "—", "8/40", "250", "—", "30", "6", "", ""),
            "Crasher Truck": ("6", "–10", "8/40", "200", "16/16", "200", "40", "", ""),
            "Go Cycle": ("2", "+20", "8/40", "140", "14/12", "60", "12", "", ""),
            "Inflatable Boat": ("5", "+10", "4/16", "40", "8/5", "30", "6", "", ""),
            "Large Jet": ("21", "+20", "—", "800-1,200", "30/20", "200", "40", "", ""),
            "Mobile Base": ("2", "–10", "4/20", "15–35", "30/20", "150", "30", "", ""),
            "Mobility Frame": ("1", "+10", "8/32", "32", "—", "25", "5", "", ""),
            "Powersuit": ("1", "—", "8/32", "32", "10/10", "45", "9", "", ""),
        },
    },
    "Panopticon": {
        "page": 161,
        "rows": {
            "Flux Car (Flying)": ("4", "0", "8/60", "180", "20/10", "150", "30", "300", ""),
            "Flux Car (Ground)": ("2", "+10", "8/40", "180", "20/10", "150", "30", "300", ""),
            # The table gives the flux cycle a death rating of 300 for a durability of 50 (DUR x 2 would be 100)
            "Flux Cycle": ("1–3", "+20", "4/40", "110", "12/10", "50", "10", "300", ""),
            "Lifeboat": ("100", "–20", "4/100", "NA", "20/20", "200", "20", "400", ""),
            "Neo-Cetacean Walker": ("1", "0", "4/20", "40", "2/4", "40", "8", "80", ""),
        },
    },
}
