#!/usr/bin/env python3
"""shop.csv + bounties.csv -> src/terminal_data.asm (DNA terminal text).

shop.csv      name, description, price           (no header)
bounties.csv  name, description, difficulty, map (no header; map is mapa..mapz)

Descriptions are word-wrapped here to <= DESC_LINES lines of DESC_COLS chars
and stored as NUL-terminated lines followed by an empty line, so the runtime
just prints lines at the bottom rows until it hits the empty one.
"""
import csv
import itertools
import json
import re
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / "editor" / "maps"
SHIPMAP = ROOT / "ship_map.csv"
SHOP = ROOT / "shop.csv"
BOUNTIES = ROOT / "bounties.csv"
GREETING = ROOT / "terminal.txt"
CRIMES = ROOT / "crimes.txt"
RIG_ITEM = "dna rig"  # shop.csv name that unlocks the scan gear
CRIME_MIN = 5  # the scan prints 1..3 distinct crimes; keep a pool to pick from
CRIME_MAX = 14
CRIME_PICK_MAX = 3
CRIME_COL0 = 9  # first crime starts after "crimes: " on row 4
CRIME_ROWS = 2  # scan screen rows 4..5 (bounty line is row 6)
OUT = ROOT / "src" / "terminal_data.asm"
# terminal_data.asm is assembled into segment E (sege.asm). The resident game only
# needs the constants below; nebula.asm sources this file instead.
CONSTS = ROOT / "src" / "terminal_consts.asm"
COUNTS = ROOT / "src" / "map_counts.asm"

TERM_COLS = 32
DESC_COLS = 30  # indented one column on screen
DESC_LINES = 5
NAME_MAX = 22
GREET_LINES = 4  # rows 4..7, above the menu
GREET_COLS = 30  # indented one column
MAX_ITEMS = 6  # rows 3..9 incl. the return row; the screen does not scroll yet
DIFFS = ["low", "medium", "high"]  # shown under the "danger" header
DIFF_ALIAS = {"easy": "low", "hard": "high"}
BITS_MAX = 9999  # keep equal to BITS_MAX in src/mem.asm
DIFF_W = 6
SHIP_ROW_MIN = 2  # chart rows; row 0 title, row 1 blank (cursor DLI row above), row 15 status
SHIP_ROW_MAX = 14
SHIP_MAX_NODES = 16  # ship_seen is a 16-bit mask
SHIP_NAME_MAX = 22


def die(msg):
    raise SystemExit(f"genterminal: {msg}")


def map_levels():
    try:
        m = re.search(r"^MAP_NLEVELS\s*=\s*(\d+)", COUNTS.read_text(), re.M)
        if m:
            return int(m.group(1))
    except OSError:
        pass
    return 1


def rows(path, ncols):
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for n, r in enumerate(csv.reader(f, skipinitialspace=True), 1):
            r = [c.strip() for c in r]
            if not any(r):
                continue
            if len(r) != ncols:
                die(f"{path.name} line {n}: expected {ncols} fields, got {len(r)}")
            out.append((n, r))
    if not out:
        die(f"{path.name} has no rows")
    if len(out) > MAX_ITEMS:
        die(f"{path.name} has {len(out)} rows (max {MAX_ITEMS}; the screen does not scroll yet)")
    return out


def text(path, n, what, s, limit=None):
    if not s:
        die(f"{path.name} line {n}: empty {what}")
    if any(not (32 <= ord(c) <= 126) or c in '"\\' for c in s):
        die(f"{path.name} line {n}: {what} has a character outside printable ASCII (no quote or backslash)")
    if limit and len(s) > limit:
        die(f"{path.name} line {n}: {what} is {len(s)} chars (max {limit})")
    return s


def asm_str(s):
    return f'\t!text "{s}"\n\t!byte 0\n'


def desc_block(path, n, s):
    text(path, n, "description", s)
    lines = textwrap.wrap(s, DESC_COLS)
    if len(lines) > DESC_LINES:
        die(f"{path.name} line {n}: description wraps to {len(lines)} lines (max {DESC_LINES} x {DESC_COLS})")
    return "".join(asm_str(l) for l in lines) + "\t!byte 0\n"


def table(label, lst):
    lo = ",".join(f"<{x}" for x in lst)
    hi = ",".join(f">{x}" for x in lst)
    return f"{label}_lo\n\t!byte {lo}\n{label}_hi\n\t!byte {hi}\n"


def greeting():
    raw = GREETING.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    lines = raw.split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        die(f"{GREETING.name} is empty")
    if len(lines) > GREET_LINES:
        die(f"{GREETING.name} has {len(lines)} lines (max {GREET_LINES})")
    for i, l in enumerate(lines, 1):
        if l and not l.strip():
            lines[i - 1] = ""
        text(GREETING, i, "greeting line", lines[i - 1] or " ", GREET_COLS)
    return [l.rstrip() for l in lines]


def crimes():
    """crimes.txt (one crime per line) -> CRIME_N + crime_lo/hi table for the DNA rig scan.

    The scan picks 1..3 distinct crimes (rnd8 & 15, retried), so at most 16, and at
    least 5 in the pool. Each is printed comma separated and word-wrapped on a 30-column row.
    """
    out = []
    try:
        raw = CRIMES.read_text(encoding="utf-8")
    except OSError as e:
        die(f"{CRIMES.name}: {e}")
    lst = [l.strip().lower() for l in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n") if l.strip()]
    for i, c in enumerate(lst, 1):
        text(CRIMES, i, "crime", c, CRIME_MAX)
    if not CRIME_MIN <= len(lst) <= 16:
        die(f"{CRIMES.name} has {len(lst)} crimes (need {CRIME_MIN}..16)")
    if len(set(lst)) != len(lst):
        die(f"{CRIMES.name} has duplicate crimes")
    # Worst case rows: the three longest crimes in the worst order, same wrap rule as rig.asm
    # (item = name + comma unless last, items one space apart, columns 1..30; the first row
    # starts after the "crimes:" label, at column CRIME_COL0).
    longest = sorted(map(len, lst), reverse=True)[:CRIME_PICK_MAX]
    for perm in itertools.permutations(longest):
        rows_used, col = 1, CRIME_COL0
        for k, n in enumerate(perm):
            need = n + (1 if k < len(perm) - 1 else 0)
            if col + need > 31:
                rows_used += 1
                col = 1
            col += need + 1
        if rows_used > CRIME_ROWS:
            die(f"{CRIMES.name}: {CRIME_PICK_MAX} long crimes can wrap to {rows_used} rows (max {CRIME_ROWS}, screen rows 4..5)")
    out.append(f"CRIME_N\t= {len(lst)}\n")
    names = []
    for i, c in enumerate(lst):
        names.append(f"crm{i}")
        out.append(f"crm{i}\n" + asm_str(c))
    out.append(table("crime", names))
    return "".join(out)


def ship_map(nlev):
    """Nebula chart nodes for the ship screen: one per map (level_num 1..nlev).

    ship_map.csv: map, col, row (no header). The node name is the map's own
    "name" from its editor json. Cursor highlight is per row, so rows are unique.
    """
    if nlev > SHIP_MAX_NODES:
        die(f"{nlev} maps but the ship's seen-mask holds {SHIP_MAX_NODES}")
    if nlev > SHIP_ROW_MAX - SHIP_ROW_MIN + 1:
        die(f"{nlev} maps do not fit on chart rows {SHIP_ROW_MIN}..{SHIP_ROW_MAX}")
    pos = {}
    with open(SHIPMAP, newline="", encoding="utf-8") as f:
        for n, r in enumerate(csv.reader(f, skipinitialspace=True), 1):
            r = [c.strip() for c in r]
            if not any(r):
                continue
            if len(r) != 3:
                die(f"{SHIPMAP.name} line {n}: expected map, col, row")
            m = re.fullmatch(r"map([a-z])", r[0].lower())
            idx = ord(m.group(1)) - ord("a") + 1 if m else 0
            if not 1 <= idx <= nlev:
                die(f"{SHIPMAP.name} line {n}: map {r[0]!r} must be mapa..map{chr(ord('a') + nlev - 1)}")
            if idx in pos:
                die(f"{SHIPMAP.name} line {n}: {r[0]} listed twice")
            try:
                col, row = int(r[1]), int(r[2])
            except ValueError:
                die(f"{SHIPMAP.name} line {n}: col and row must be numbers")
            if not SHIP_ROW_MIN <= row <= SHIP_ROW_MAX:
                die(f"{SHIPMAP.name} line {n}: row {row} outside {SHIP_ROW_MIN}..{SHIP_ROW_MAX}")
            if any(p[1] == row for p in pos.values()):
                die(f"{SHIPMAP.name} line {n}: row {row} already has a node (the cursor lights whole rows)")
            pos[idx] = (col, row)
    out = [f"SHIP_N\t= {nlev}\n"]
    names = []
    for idx in range(1, nlev + 1):
        letter = chr(ord("a") + idx - 1)
        if idx not in pos:
            die(f"{SHIPMAP.name} has no row for map{letter}")
        col, row = pos[idx]
        try:
            name = json.loads((MAPS / f"map{letter}.json").read_text(encoding="utf-8")).get("name") or ""
        except (OSError, ValueError) as e:
            die(f"map{letter}.json: {e}")
        name = name.strip()
        text(SHIPMAP, idx, f"map{letter} name", name, SHIP_NAME_MAX)
        if col < 1 or col + 2 + len(name) > TERM_COLS:
            die(f"{SHIPMAP.name}: map{letter} at col {col} with name {name!r} does not fit in {TERM_COLS} columns "
                f"(needs 1 <= col and col + 2 + {len(name)} <= {TERM_COLS})")
        names.append(f"smn{idx - 1}")
        out.append(f"smn{idx - 1}\n" + asm_str(name))
    out.append("sm_col\n\t!byte " + ",".join(str(pos[i][0]) for i in range(1, nlev + 1)) + "\n")
    out.append("sm_row\n\t!byte " + ",".join(str(pos[i][1]) for i in range(1, nlev + 1)) + "\n")
    out.append(table("sm_name", names))
    return "".join(out)


def main():
    nlev = map_levels()
    p = ["; generated by tools/genterminal.py from terminal.txt, shop.csv, bounties.csv, crimes.txt and ship_map.csv. Do not edit.\n"]

    greet = greeting()
    p.append(f"GREET_N\t= {len(greet)}\n")
    for i, l in enumerate(greet):
        p.append(f"grt{i}\n" + (asm_str(l) if l else "\t!byte 0\n"))
    p.append(table("greet", [f"grt{i}" for i in range(len(greet))]))

    shop = rows(SHOP, 3)
    p.append(f"SHOP_N\t= {len(shop)}\nDIFF_W\t= {DIFF_W}\n")
    names, descs, prices = [], [], []
    body = []
    for i, (n, (name, desc, price)) in enumerate(shop):
        text(SHOP, n, "name", name, NAME_MAX)
        try:
            pr = int(price)
        except ValueError:
            die(f"shop.csv line {n}: price {price!r} is not a number")
        if not 0 <= pr <= BITS_MAX:
            die(f"shop.csv line {n}: price {pr} out of range 0..{BITS_MAX}")
        names.append(f"shn{i}")
        descs.append(f"shd{i}")
        prices.append(pr)
        body.append(f"shn{i}\n" + asm_str(name) + f"shd{i}\n" + desc_block(SHOP, n, desc))
    p.append("".join(body))
    p.append(table("shop_name", names))
    p.append(table("shop_desc", descs))
    p.append("shop_price_lo\n\t!byte " + ",".join(str(x & 255) for x in prices) + "\n")
    p.append("shop_price_hi\n\t!byte " + ",".join(str(x >> 8) for x in prices) + "\n")

    # The DNA rig item unlocks the scan gear; the engine tests this bit of shop_owned (low byte).
    rig = [i for i, (_, r) in enumerate(shop) if r[0].strip().lower() == RIG_ITEM]
    if len(rig) != 1:
        die(f"shop.csv needs exactly one {RIG_ITEM!r} row (the scan gear), found {len(rig)}")
    if rig[0] > 7:
        die(f"{RIG_ITEM!r} is shop row {rig[0] + 1}; the scan gear tests the low shop_owned byte (rows 1..8)")
    p.append(f"SHOP_RIG_MASK\t= {1 << rig[0]}\n")
    CONSTS.write_text(
        "; generated by tools/genterminal.py. Do not edit.\n"
        f"SHOP_RIG_MASK\t= {1 << rig[0]}\n",
        encoding="utf-8",
    )
    p.append(crimes())

    bty = rows(BOUNTIES, 4)
    p.append(f"BTY_N\t= {len(bty)}\n")
    names, descs, diffs, maps = [], [], [], []
    body = []
    for i, (n, (name, desc, diff, mp)) in enumerate(bty):
        text(BOUNTIES, n, "name", name, NAME_MAX)
        d = DIFF_ALIAS.get(diff.lower(), diff.lower())
        if d not in DIFFS:
            die(f"bounties.csv line {n}: difficulty {diff!r} must be one of {DIFFS}")
        m = re.fullmatch(r"map([a-z])", mp.lower())
        idx = ord(m.group(1)) - ord("a") + 1 if m else 0
        if not 1 <= idx <= nlev:
            die(f"bounties.csv line {n}: map {mp!r} must be mapa..map{chr(ord('a') + nlev - 1)}")
        names.append(f"btn{i}")
        descs.append(f"btd{i}")
        diffs.append(DIFFS.index(d) * DIFF_W)
        maps.append(idx)
        body.append(f"btn{i}\n" + asm_str(name) + f"btd{i}\n" + desc_block(BOUNTIES, n, desc))
    p.append("".join(body))
    p.append(table("bty_name", names))
    p.append(table("bty_desc", descs))
    p.append("bty_diff\t; offset into bty_diff_str\n\t!byte " + ",".join(map(str, diffs)) + "\n")
    p.append("bty_map\n\t!byte " + ",".join(map(str, maps)) + "\n")
    p.append("bty_diff_str\n" + "".join(f'\t!text "{d.ljust(DIFF_W)}"\n' for d in DIFFS))

    p.append(ship_map(nlev))

    OUT.write_text("".join(p), encoding="utf-8")
    print(f"genterminal: {len(shop)} shop items, {len(bty)} bounties, {nlev} chart nodes -> {OUT.name}")


if __name__ == "__main__":
    sys.exit(main())
