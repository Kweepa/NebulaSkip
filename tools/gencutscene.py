#!/usr/bin/env python3
"""Cook the map-level `cutscene` block (editor/maps/map<x>.json) for the game.

  gencutscene.py --flags          write src/cut_maps.asm (cut_has: one byte per playable map)
  gencutscene.py --pack           write maps/cut<x>.prg = cutscene overlay code + baked data,
                                  for every map with a cutscene (needs cutscn.prg / cutscn.lbl)
  gencutscene.py --dump MAP.json  print the baked samples as JSON (same shape as tools/cut_bake_js.js)
  gencutscene.py --compare MAP.json   bake with this file and with the editor's JS, diff them

The bake is the one specified in the header comment of editor/js/cutsceneModel.js; the editor
previews with its JS version and the game plays what this writes. Same operations in the same
order, so doubles agree; positions are rounded to 1/256 and yaw to a byte, the cross-check
tolerance is 1/256 and 1.

Overlay file layout (loaded to CUT_BASE by cut_arrive in loader.asm; the load address word is
ignored by LoadPrg, the directory length is what counts):
    <code assembled by a8cutscene.asm, ends at label cut_data> <data>
Data (offsets are the CD_* equates in a8cutscene.asm), actor 0 is always the camera:
    0 room index   1 nact   2..3 duration ms (lo, hi)
    4  kind[6]     $FF camera, else th_type (item mesh slot)
    10 scale[6]    shift 0..3
    16 ns[6]       samples
    22 offl[6] 28 offh[6]   offset of the actor's sample block from the start of the data
    34 star count (0 = no starfield; the editor's starfield toggle writes 128)
    35 sample blocks, per actor: xl[ns] xh[ns] yl[ns] yh[ns] zl[ns] zh[ns] yaw[ns]
Positions are 8.8 world units, camera = eye, items as the editor places them (the game adds
ITEM_WORLD_BIAS on X/Z). Yaw is the game byte, 0 = +Z, 64 = +X.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mapnames

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
MAP_DIR = ROOT / "maps"
ITEM_DOC = ROOT / "editor" / "nebula.json"
FLAGS_OUT = SRC / "cut_maps.asm"
OVERLAY_PRG = ROOT / "cutscn.prg"
OVERLAY_LBL = ROOT / "cutscn.lbl"

# Keep in step with editor/js/cutsceneModel.js.
CUT_STEP_MS = 128
CUT_ARC_SUB = 32
CUT_DUR_MIN = 0.5
CUT_DUR_MAX = 16.0
CUT_ACTOR_MAX = 6
CUT_PATH_MAX = 16
WORLD_MAX = 255
POS_MAX = WORLD_MAX + 255 / 256
ITEM_SCALES = (1, 2, 4, 8)

# Data layout (a8cutscene.asm CD_*).
CD_ROOM, CD_NACT, CD_DUR = 0, 1, 2
CD_KIND, CD_SCALE, CD_NS, CD_OFFL, CD_OFFH = 4, 10, 16, 22, 28
CD_STARS = 34
CD_SAMPLES = 35
CUT_STAR_COUNT = 128
KIND_CAMERA = 0xFF
MAX_STEP_UNITS = 127  # the engine lerps a signed 8.8 delta per 128 ms sample

# Same as genmap.py: TH_* names (0..14, fixed by the asm), editor items follow at 15...
BUILTIN_ITEMS = [
    "small health", "large health", "green armor", "blue armor", "ammo box",
    "backpack", "red keycard", "yellow keycard", "blue keycard", "soulsphere",
    "radsuit", "bit wallet", "bit safe", "lightpost", "barrel",
]
DOOR_ITEM_NAMES = ["tech", "arch", "tri", "crack"]


class CutError(Exception):
    pass


def jsround(v: float) -> int:
    """Math.round: halves go up."""
    return math.floor(v + 0.5)


def mem_const(name: str) -> int:
    text = (SRC / "mem.asm").read_text(encoding="utf-8", errors="replace")
    m = re.search(rf"^{name}\s*=\s*(\$[0-9a-fA-F]+|\d+)", text, re.M)
    if not m:
        raise SystemExit(f"src/mem.asm: {name} not found")
    t = m.group(1)
    return int(t[1:], 16) if t.startswith("$") else int(t)


def read_labels(path: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0] == "al" and parts[2].startswith("."):
            out[parts[2][1:]] = int(parts[1].split(":")[1], 16)
    return out


def custom_item_names() -> list[str]:
    """Mirrors genmap.custom_item_names: editor items not in BUILTIN_ITEMS, TH 15.. in order."""
    if not ITEM_DOC.is_file():
        return []
    doc = json.loads(ITEM_DOC.read_text(encoding="utf-8"))
    taken = {k.lower() for k in BUILTIN_ITEMS} | set(DOOR_ITEM_NAMES)
    out: list[str] = []
    for src in doc.get("customItems") or []:
        if not isinstance(src, str):
            continue
        name = src.strip()
        if not name or name.lower() in taken:
            continue
        taken.add(name.lower())
        out.append(name)
    return out


def item_type(name: str) -> int:
    if name in BUILTIN_ITEMS:
        return BUILTIN_ITEMS.index(name)
    custom = custom_item_names()
    if name in custom:
        return len(BUILTIN_ITEMS) + custom.index(name)
    raise CutError(f"cutscene item {name!r} is not a placeable item")


# ---- normalisation: the same clamps as normalizeCutscene in cutsceneModel.js ----


def clamp_coord(n) -> int:
    try:
        v = jsround(float(n))
    except (TypeError, ValueError):
        return 0
    return max(0, min(WORLD_MAX, v))


def clamp_duration(n) -> float:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return 3.0
    return min(CUT_DUR_MAX, max(CUT_DUR_MIN, jsround(v * 8) / 8))


def clamp_yaw(n) -> int:
    try:
        v = jsround(float(n))
    except (TypeError, ValueError):
        return 0
    return v % 256


def norm_actor(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in ("camera", "item"):
        return None
    a = {
        "id": raw.get("id") if isinstance(raw.get("id"), str) and raw.get("id") else f"a{id(raw)}",
        "kind": kind,
        "x": clamp_coord(raw.get("x")),
        "y": clamp_coord(raw.get("y")),
        "z": clamp_coord(raw.get("z")),
    }
    allowed = ("fixed", "path", "target") if kind == "camera" else ("fixed", "path")
    a["facing"] = raw.get("facing") if raw.get("facing") in allowed else "fixed"
    a["ease"] = raw.get("ease") if raw.get("ease") in ("linear", "out", "in", "inout") else "linear"
    path = raw.get("path")
    a["path"] = (
        [{"x": clamp_coord(p.get("x")), "y": clamp_coord(p.get("y")), "z": clamp_coord(p.get("z"))} for p in path[:CUT_PATH_MAX] if isinstance(p, dict)]
        if isinstance(path, list)
        else []
    )
    # Items used to carry an octant `rot`; it reads as yaw = rot * 32.
    yaw_raw = raw.get("yaw")
    if yaw_raw is None and kind == "item":
        try:
            yaw_raw = (int(raw.get("rot") or 0) % 8) * 32
        except (TypeError, ValueError):
            yaw_raw = 0
    a["yaw"] = clamp_yaw(yaw_raw)
    if kind == "camera":
        t = raw.get("target")
        a["target"] = t if isinstance(t, str) and t else None
    else:
        a["item"] = raw.get("item")
        try:
            scale = int(raw.get("scale"))
        except (TypeError, ValueError):
            scale = 1
        a["scale"] = scale if scale in ITEM_SCALES else 1
    return a


def normalize(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    actors = [a for a in (norm_actor(x) for x in (raw.get("actors") or [])) if a][:CUT_ACTOR_MAX]
    room_id = raw.get("roomId") if isinstance(raw.get("roomId"), str) and raw.get("roomId") else None
    if not room_id and not actors:
        return None
    return {
        "roomId": room_id,
        "duration": clamp_duration(raw.get("duration")),
        "starfield": raw.get("starfield") is True,
        "actors": actors,
    }


# ---- bake (cutsceneModel.js is the spec) ----


def cr_point(P, k, t):
    n = len(P)

    def at(i):
        if i < 0:
            return {c: 2 * P[0][c] - P[1][c] for c in "xyz"}
        if i >= n:
            return {c: 2 * P[n - 1][c] - P[n - 2][c] for c in "xyz"}
        return P[i]

    p0, p1, p2, p3 = at(k - 1), at(k), at(k + 1), at(k + 2)
    t2 = t * t
    t3 = t2 * t

    def f(a, b, c, d):
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)

    def g(a, b, c, d):
        return 0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2)

    return (
        {c: f(p0[c], p1[c], p2[c], p3[c]) for c in "xyz"},
        {c: g(p0[c], p1[c], p2[c], p3[c]) for c in "xyz"},
    )


def cr_at(P, s):
    n = len(P)
    k = math.floor(s)
    if k >= n - 1:
        k = n - 2
    if k < 0:
        k = 0
    return cr_point(P, k, s - k)


def arc_table(P):
    n = len(P)
    steps = (n - 1) * CUT_ARC_SUB
    lens = []
    prev = None
    acc = 0.0
    for j in range(steps + 1):
        pos = cr_at(P, j / CUT_ARC_SUB)[0]
        if prev is not None:
            acc += math.hypot(pos["x"] - prev["x"], pos["y"] - prev["y"], pos["z"] - prev["z"])
        lens.append(acc)
        prev = pos
    return lens, acc


def s_at_u(lens, total, u):
    d = u * total
    j = 0
    while j < len(lens) - 2 and lens[j + 1] < d:
        j += 1
    span = lens[j + 1] - lens[j]
    f = min(1.0, max(0.0, (d - lens[j]) / span)) if span > 0 else 0.0
    return (j + f) / CUT_ARC_SUB


def q256(v: float) -> int:
    c = max(0.0, min(POS_MAX, v))
    return math.floor(c * 256 + 0.5)


def yaw_byte_of(dx: float, dz: float) -> int:
    a = math.atan2(dx, dz)
    return math.floor(a / (math.pi * 2) * 256 + 0.5) % 256


def moves(a) -> bool:
    return len(a["path"]) >= 2


def fixed_yaw(a) -> int:
    return a["yaw"] % 256


def ease_u(ease, u):
    if ease == "out":
        return 1 - (1 - u) * (1 - u)
    if ease == "in":
        return u * u
    if ease == "inout":
        return u * u * (3 - 2 * u)
    return u


def raw_samples(a, ns, dur_ms):
    out = []
    if not moves(a):
        src = a["path"][0] if a["path"] else a
        p = {"x": src["x"], "y": src["y"], "z": src["z"]}
        return [(p, None)] * ns
    lens, total = arc_table(a["path"])
    for i in range(ns):
        u = ease_u(a["ease"], min(i * CUT_STEP_MS / dur_ms, 1.0))
        out.append(cr_at(a["path"], s_at_u(lens, total, u)))
    return out


def derived_yaws(a, raws, target_raws):
    yaws = []
    prev = fixed_yaw(a)
    for i, (pos, tan) in enumerate(raws):
        dx = dz = 0.0
        use = False
        if a["facing"] == "path" and tan is not None:
            dx, dz, use = tan["x"], tan["z"], True
        elif a["facing"] == "target" and target_raws:
            tpos = target_raws[min(i, len(target_raws) - 1)][0]
            dx, dz, use = tpos["x"] - pos["x"], tpos["z"] - pos["z"], True
        if use and (abs(dx) > 1e-9 or abs(dz) > 1e-9):
            prev = yaw_byte_of(dx, dz)
        elif not use:
            prev = fixed_yaw(a)
        yaws.append(prev)
    return yaws


def bake(cut: dict) -> dict:
    """Returns {durMs, step, ns, actors:[{id,kind,item,scale,ns,x[],y[],z[],yaw[]}]}, x/y/z in 8.8 ints."""
    dur_ms = jsround(cut["duration"] * 1000)
    ns = math.ceil(dur_ms / CUT_STEP_MS) + 1
    actors = cut["actors"]
    by_id = {a["id"]: a for a in actors}
    cache: dict[str, list] = {}

    def raw_for(a):
        if a["id"] not in cache:
            cache[a["id"]] = raw_samples(a, ns, dur_ms)
        return cache[a["id"]]

    out = []
    for a in actors:
        own = raw_for(a)
        target = None
        target_raws = None
        if a["kind"] == "camera" and a["facing"] == "target":
            target = by_id.get(a.get("target"))
            if target is not None and target is not a and target["kind"] == "item":
                target_raws = raw_for(target)
        full = moves(a) or (target_raws is not None and moves(target))
        cnt = ns if full else 1
        use = own[:cnt]
        yaws = derived_yaws(a, use, target_raws)
        out.append(
            {
                "id": a["id"],
                "kind": a["kind"],
                "item": a["item"] if a["kind"] == "item" else None,
                "scale": a["scale"] if a["kind"] == "item" else 1,
                "ns": cnt,
                "x": [q256(r[0]["x"]) for r in use],
                "y": [q256(r[0]["y"]) for r in use],
                "z": [q256(r[0]["z"]) for r in use],
                "yaw": yaws,
            }
        )
    return {"durMs": dur_ms, "step": CUT_STEP_MS, "ns": ns, "actors": out}


def bake_as_units(b: dict) -> dict:
    """Same JSON as the editor's bake: positions in world units (n/256)."""
    out = dict(b)
    out["actors"] = [{**a, "x": [v / 256 for v in a["x"]], "y": [v / 256 for v in a["y"]], "z": [v / 256 for v in a["z"]]} for a in b["actors"]]
    return out


# ---- validation + packing ----


def level_rooms(level: dict) -> list[dict]:
    # Same list and order genmap.cook_one indexes rooms by.
    return [o for o in level.get("objects", []) if o.get("kind") == "room"]


def usable(level: dict) -> tuple[dict | None, str]:
    """(normalised cutscene, "") when the map has a playable one, else (None, reason)."""
    raw = level.get("cutscene")
    if raw is None:
        return None, ""
    cut = normalize(raw)
    if cut is None:
        return None, ""
    if not cut["roomId"]:
        return None, "no cutscene room chosen"
    rooms = level_rooms(level)
    if cut["roomId"] not in [r.get("id") for r in rooms]:
        return None, "the cutscene room no longer exists"
    cams = [a for a in cut["actors"] if a["kind"] == "camera"]
    if len(cams) != 1:
        return None, "needs exactly one camera" if cams else "no camera"
    return cut, ""


def validate_hard(cut: dict, level: dict, key: str) -> None:
    rooms = level_rooms(level)
    spawn_ids = {o.get("roomId") for o in level.get("objects", []) if o.get("kind") == "spawn"}
    if cut["roomId"] in spawn_ids:
        raise CutError(f"{key}: the cutscene room is the spawn room")
    for a in cut["actors"]:
        if a["kind"] == "item":
            item_type(a["item"])


def pack_data(cut: dict, level: dict, key: str) -> bytes:
    validate_hard(cut, level, key)
    rooms = level_rooms(level)
    room_idx = [r.get("id") for r in rooms].index(cut["roomId"])
    # Camera first: the overlay treats actor 0 as the camera.
    ordered = sorted(cut["actors"], key=lambda a: 0 if a["kind"] == "camera" else 1)
    cut = {**cut, "actors": ordered}
    b = bake(cut)
    if len(b["actors"]) > CUT_ACTOR_MAX:
        raise CutError(f"{key}: more than {CUT_ACTOR_MAX} cutscene actors")
    if b["durMs"] > 0xFFFF:
        raise CutError(f"{key}: cutscene too long")
    n = len(b["actors"])
    head = bytearray(CD_SAMPLES)
    head[CD_ROOM] = room_idx
    head[CD_NACT] = n
    head[CD_DUR] = b["durMs"] & 0xFF
    head[CD_DUR + 1] = b["durMs"] >> 8
    head[CD_STARS] = CUT_STAR_COUNT if cut.get("starfield") else 0
    body = bytearray()
    for i, a in enumerate(b["actors"]):
        if a["ns"] > 255:
            raise CutError(f"{key}: too many samples")
        # The engine lerps one signed 8.8 delta per sample.
        for ch in ("x", "y", "z"):
            vals = a[ch]
            for j in range(1, len(vals)):
                if abs(vals[j] - vals[j - 1]) >= MAX_STEP_UNITS * 256:
                    raise CutError(
                        f"{key}: actor {i} moves {abs(vals[j] - vals[j - 1]) / 256:.0f} units in one {CUT_STEP_MS} ms step "
                        f"(max {MAX_STEP_UNITS}); lengthen the cutscene or shorten the path"
                    )
        head[CD_KIND + i] = KIND_CAMERA if a["kind"] == "camera" else item_type(a["item"])
        head[CD_SCALE + i] = {1: 0, 2: 1, 4: 2, 8: 3}[a["scale"]]
        head[CD_NS + i] = a["ns"]
        off = CD_SAMPLES + len(body)
        head[CD_OFFL + i] = off & 0xFF
        head[CD_OFFH + i] = off >> 8
        for ch in ("x", "y", "z"):
            body += bytes(v & 0xFF for v in a[ch])
            body += bytes((v >> 8) & 0xFF for v in a[ch])
        body += bytes(a["yaw"])
    return bytes(head) + bytes(body)


def cut_x(letter: str) -> str:
    return f"CUT{letter.upper()}"


def prg_path(letter: str) -> Path:
    return MAP_DIR / f"cut{letter.lower()}.prg"


def playable_cutscenes() -> dict[str, tuple[dict, dict]]:
    """letter -> (cutscene, level) for the playable maps that have a usable one (warn on the rest)."""
    found: dict[str, tuple[dict, dict]] = {}
    for letter in mapnames.map_letters():
        level = json.loads(mapnames.json_path(letter).read_text(encoding="utf-8"))
        cut, why = usable(level)
        if cut is not None:
            found[letter] = (cut, level)
        elif why:
            print(f"WARNING {mapnames.key(letter)}: cutscene skipped: {why}", file=sys.stderr)
    return found


def write_flags() -> None:
    letters = mapnames.map_letters()
    found = playable_cutscenes()
    vals = ",".join("1" if l in found else "0" for l in letters)
    FLAGS_OUT.write_text(
        f"; Generated by tools/gencutscene.py - 1 when map level N has a cutscene overlay (CUT<letter>), MAPA..MAP{letters[-1]}\n"
        f"cut_has\t!byte {vals}\n",
        encoding="utf-8",
    )
    names = ", ".join(mapnames.key(l) for l in found) or "none"
    print(f"Wrote cut_maps.asm: cutscenes on {names}")


def write_packs() -> None:
    if not OVERLAY_PRG.is_file() or not OVERLAY_LBL.is_file():
        raise SystemExit(f"missing {OVERLAY_PRG.name} / {OVERLAY_LBL.name}: assemble a8cutscene.asm first")
    prg = OVERLAY_PRG.read_bytes()
    base = mem_const("CUT_BASE")
    limit = mem_const("QS_OVL")
    if prg[0] | (prg[1] << 8) != base:
        raise SystemExit("cutscn.prg load address is not CUT_BASE; rebuild it")
    code = prg[2:]
    labels = read_labels(OVERLAY_LBL)
    data_at = labels.get("cut_data")
    if data_at is None or data_at - base != len(code):
        raise SystemExit("cutscn.prg must end at label cut_data (no bytes after it)")
    room = limit - data_at
    MAP_DIR.mkdir(exist_ok=True)
    found = playable_cutscenes()
    keep = {prg_path(l).name for l in found}
    for stale in MAP_DIR.glob("cut?.prg"):
        if stale.name not in keep:
            stale.unlink()
    for letter, (cut, level) in found.items():
        key = mapnames.key(letter)
        try:
            data = pack_data(cut, level, key)
        except CutError as e:
            raise SystemExit(str(e))
        if len(data) > room:
            raise SystemExit(f"{key}: cutscene data is {len(data)} B, only {room} B fit after the {len(code)} B overlay code")
        prg_path(letter).write_bytes(struct.pack("<H", base) + code + data)
        print(f"Wrote {prg_path(letter).name}: code {len(code)} B + data {len(data)} B (room for {room} B)")


def level_from(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def baked_from(path: Path) -> dict:
    level = level_from(path)
    cut, why = usable(level)
    if cut is None:
        raise SystemExit(f"{path}: no usable cutscene ({why or 'none'})")
    return bake_as_units(bake(cut))


def compare(path: Path) -> int:
    ours = baked_from(path)
    node = subprocess.run(
        ["node", str(Path(__file__).resolve().parent / "cut_bake_js.js"), str(path)],
        capture_output=True, text=True, check=False,
    )
    if node.returncode != 0:
        print(node.stderr, file=sys.stderr)
        return 2
    theirs = json.loads(node.stdout)
    bad = 0
    if (ours["durMs"], ours["ns"]) != (theirs["durMs"], theirs["ns"]):
        print(f"duration/samples differ: {ours['durMs']},{ours['ns']} vs js {theirs['durMs']},{theirs['ns']}")
        return 1
    by_id = {a["id"]: a for a in theirs["actors"]}
    worst = 0.0
    for a in ours["actors"]:
        t = by_id.get(a["id"])
        if t is None or t["ns"] != a["ns"]:
            print(f"actor {a['id']}: sample count {a['ns']} vs js {t and t['ns']}")
            bad += 1
            continue
        for ch in ("x", "y", "z"):
            for i, (p, q) in enumerate(zip(a[ch], t[ch])):
                d = abs(p - q)
                worst = max(worst, d)
                if d > 1 / 256 + 1e-12:
                    print(f"actor {a['id']} {ch}[{i}]: {p} vs js {q}")
                    bad += 1
        for i, (p, q) in enumerate(zip(a["yaw"], t["yaw"])):
            d = min((p - q) % 256, (q - p) % 256)
            if d > 1:
                print(f"actor {a['id']} yaw[{i}]: {p} vs js {q}")
                bad += 1
    print(f"compare: {len(ours['actors'])} actors, worst position delta {worst:.6f}, {bad} mismatches")
    return 1 if bad else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--flags", action="store_true")
    g.add_argument("--pack", action="store_true")
    g.add_argument("--dump", metavar="MAP_JSON")
    g.add_argument("--compare", metavar="MAP_JSON")
    args = ap.parse_args()
    if args.flags:
        write_flags()
    elif args.pack:
        write_packs()
    elif args.dump:
        json.dump(baked_from(Path(args.dump)), sys.stdout, indent=1)
        sys.stdout.write("\n")
    else:
        sys.exit(compare(Path(args.compare)))


if __name__ == "__main__":
    main()
