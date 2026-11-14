#!/usr/bin/env python3
"""Frame-time tour of a map in Altirra.

    python tools/perftour.py c            # MAPC, every doorway, both sides
    python tools/perftour.py c --room "Deep Cut"
    python tools/perftour.py c --parse    # re-print the report from the last log

Boots nebula.atr under the Altirra debugger, skips the menu, loads the map, turns god mode on,
then for each side of each doorway puts the player 3 units inside the room and turns through
8 headings. Each heading runs three game frames; the last two are logged (dt_ms, the same
number the HUD shows: VBI ticks x 17 ms on NTSC).

Budgets: rooms without enemies ("nav") NAV_MS, rooms with enemies ("combat") COMBAT_MS.
Enemies are alive and awake during the tour, so combat rooms include AI and figure draw.

Addresses come from game.lbl, so build first. An Altirra window opens; leave it alone.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mapnames
from roomgeom import room_geometry

ROOT = Path(__file__).resolve().parents[1]
ALTIRRA = Path(r"C:\app\altirra\Altirra64.exe")
OUT = ROOT / "tmp" / "perftour"
NAV_MS = 130
COMBAT_MS = 200
BOOT_JSR = 0x04C6  # boot's `jsr $0900` (menu); offset 198 in src/a8boot.bin, loaded at $0400
STAND_IN = 3  # units inside the room from the door slab
YAWS = range(0, 256, 32)
EYE_HEIGHT = 3
EYE_FRAC = 0xC0
PORTB_PLAY = 0xE2
# Game display list the menu would have staged (see memory note altirra-smoke-test).
GAME_DL = bytes.fromhex("70420002827002028270020280" "4E0040") + b"\x0e" * 127 + bytes.fromhex("410000")


def labels() -> dict[str, int]:
    out = {}
    for line in (ROOT / "game.lbl").read_text().splitlines():
        m = re.match(r"al C:([0-9a-f]+) \.(\S+)", line)
        if m:
            out.setdefault(m.group(2), int(m.group(1), 16))
    return out


def stops(level: dict, only: str | None) -> list[dict]:
    """One stop per (doorway, room it touches): where to stand and which room that is."""
    objs = level["objects"]
    rooms = [o for o in objs if o["kind"] == "room"]
    idx = {r["id"]: i for i, r in enumerate(rooms)}
    cols = {r["id"]: room_geometry(r)["colliders"] for r in rooms}
    out = []
    for d in objs:
        if d["kind"] != "doorway":
            continue
        thin = "x" if d["sx"] < d["sz"] else "z"
        cx = d["x"] + d["sx"] / 2
        cz = d["z"] + d["sz"] / 2
        for rid in (d.get("roomId"), d.get("otherRoomId")):
            if rid not in idx:
                continue
            r = rooms[idx[rid]]
            if only and only.lower() not in (r.get("name") or "").lower():
                continue
            for sign in (-1, 1):
                x = cx + (sign * (STAND_IN + 0.5) if thin == "x" else 0)
                z = cz + (sign * (STAND_IN + 0.5) if thin == "z" else 0)
                if any(c["x"] < x < c["x"] + c["sx"] and c["z"] < z < c["z"] + c["sz"]
                       and c["y"] <= d["y"] < c["y"] + c["sy"] for c in cols[rid]):
                    out.append({"room": idx[rid], "name": r.get("name") or f"room {idx[rid]}",
                                "x": x, "y": d["y"], "z": z,
                                "combat": any(o["kind"] == "enemy" and o.get("roomId") == rid for o in objs)})
                    break
    return out


def script(letter: str, pts: list[dict], lab: dict[str, int], log: Path, done: Path) -> str:
    level = ord(letter.upper()) - ord("A") + 1
    L = [f".logopen {log.as_posix()}",
         f"bp ${BOOT_JSR:04x}", "g", f"e ${BOOT_JSR:04x} ea ea ea",
         "e r:$ef40 " + " ".join(f"{b:02x}" for b in GAME_DL),
         "bc *",
         f"bp ${lab['LoadLevel']:04x}", "g",
         f"e ${lab['level_num']:04x} {level:02x}",
         "bc *",
         f'bx "pc=${lab["main"]:04x} and db(${lab["portb_cur"]:04x})=${PORTB_PLAY:02x}"', "g",
         "bc *",
         f"e ${lab['god_mode']:04x} 01",
         f"bp ${lab['main']:04x}",
         "g", "g"]
    for i, p in enumerate(pts):
        xi, zi = int(p["x"]), int(p["z"])
        L += [f"e ${lab['room_idx']:04x} {p['room']:02x}",
              f"e ${lab['cam_xh']:04x} {xi:02x}", f"e ${lab['cam_xl']:04x} {int((p['x'] - xi) * 256):02x}",
              f"e ${lab['cam_zh']:04x} {zi:02x}", f"e ${lab['cam_zl']:04x} {int((p['z'] - zi) * 256):02x}",
              f"e ${lab['cam_yh']:04x} {p['y'] + EYE_HEIGHT:02x}", f"e ${lab['cam_yl']:04x} {EYE_FRAC:02x}",
              f"e ${lab['pl_falling']:04x} 00", f"e ${lab['trig_inside']:04x} 00",
              f"e ${lab['palette_room']:04x} ff",
              "g", "g"]  # settle: floor sync, palette, room stream
        for yaw in YAWS:
            L += [f"e ${lab['yaw']:04x} {yaw:02x}", "g", "g"]
            for _ in range(2):
                L.append(f'.printf "T {i} {yaw} %d %d %d" db(${lab["dt_ms"]:04x}) '
                         f'db(${lab["dt_msh"]:04x}) db(${lab["room_idx"]:04x})')
                L.append("g")
    L += [".printf \"END\"", ".logclose", f".writemem {done.as_posix()} $0000 L1"]
    return "\n".join(L) + "\n"


def report(pts: list[dict], log: Path) -> int:
    samples: dict[int, list[tuple[int, int]]] = {}
    moved = set()
    for line in log.read_text(errors="replace").splitlines():
        m = re.match(r"T (\d+) (\d+) (\d+) (\d+) (\d+)", line.strip())
        if not m:
            continue
        i, yaw, lo, hi, room = map(int, m.groups())
        samples.setdefault(i, []).append((yaw, lo + 256 * hi))
        if room != pts[i]["room"]:
            moved.add(i)
    if not samples:
        print(f"no samples in {log}")
        return 1
    by_room: dict[str, list] = {}
    for i, p in enumerate(pts):
        if i in samples:
            by_room.setdefault(p["name"], []).append((p, samples[i], i in moved))
    print(f"{'room':18} {'kind':6} {'stops':>5} {'avg':>4} {'max':>4}  worst stop (x,z @ yaw)")
    over = 0
    for name, lst in by_room.items():
        allv = [v for _, s, _ in lst for _, v in s]
        worst = max(((v, p, yaw) for p, s, _ in lst for yaw, v in s), key=lambda t: t[0])
        combat = lst[0][0]["combat"]
        budget = COMBAT_MS if combat else NAV_MS
        mx = max(allv)
        flag = "  OVER" if mx > budget else ""
        over += mx > budget
        note = "  (left the room during the stop)" if any(m for _, _, m in lst) else ""
        print(f"{name:18} {'combat' if combat else 'nav':6} {len(lst):5} {sum(allv) / len(allv):4.0f} {mx:4}"
              f"  {worst[1]['x']:.0f},{worst[1]['z']:.0f} @ {worst[2]}{flag}{note}")
    print(f"{over} room(s) over budget (nav {NAV_MS} ms, combat {COMBAT_MS} ms)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map", help="map letter, e.g. c")
    ap.add_argument("--room", help="only rooms whose name contains this")
    ap.add_argument("--parse", action="store_true", help="report from the existing log, no run")
    ap.add_argument("--timeout", type=int, default=1800)
    a = ap.parse_args()

    level = json.loads(mapnames.json_path(a.map).read_text(encoding="utf-8"))
    pts = stops(level, a.room)
    if not pts:
        raise SystemExit("no doorway stops")
    OUT.mkdir(parents=True, exist_ok=True)
    log, done, bat = OUT / "tour.log", OUT / "done.bin", OUT / "tour.at"
    if a.parse:
        return report(pts, log)
    if a.map.upper() not in mapnames.map_letters():
        raise SystemExit(f"MAP{a.map.upper()} is not in the playable run {mapnames.map_letters()}")
    for f in (log, done):
        f.unlink(missing_ok=True)
    bat.write_text(script(a.map, pts, labels(), log, done), encoding="ascii")
    cmd = (f'"{ALTIRRA}" /hardware:130XE /ntsc /nobasic /memsize:128K /w /debug'
           f' /debugcmd:".batch {bat}" /diskemu:1050 /disk "{ROOT / "nebula.atr"}"')
    print(f"{len(pts)} stops x {len(list(YAWS))} headings; Altirra window opening, leave it alone")
    proc = subprocess.Popen(cmd)
    t0 = time.time()
    try:
        while not done.exists():
            if proc.poll() is not None:
                raise SystemExit("Altirra exited before the tour finished")
            if time.time() - t0 > a.timeout:
                raise SystemExit(f"timed out after {a.timeout}s (log so far: {log})")
            time.sleep(1)
        time.sleep(1)
    finally:
        proc.kill()
    print(f"tour took {time.time() - t0:.0f}s")
    return report(pts, log)


if __name__ == "__main__":
    sys.exit(main())
