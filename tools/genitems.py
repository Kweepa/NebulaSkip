#!/usr/bin/env python3
"""Cook pickup and door line meshes from editor JSON → src/item_mesh.asm (unique X/Z)."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "editor" / "nebula.json"
OUT = ROOT / "src" / "item_mesh.asm"
# Per-page blobs and the per-slot offsets only fill_item_slot reads: segment E
# (src/e_item.asm sources it). item_mesh.asm keeps what resident code indexes.
BLOB = ROOT / "src" / "item_blob.asm"

ITEM_COORD_MIN = -128
ITEM_COORD_MAX = 127
ITEM_POS_Q = 4
ITEM_ORIGIN = 0
ITEM_BIAS = 1
ITEM_MAX_VERTS = 16
ITEM_MAX_LINES = 16
ITEM_MAX_UNIQUE = 6
ITEM_MAX_SPHERES = 2  # keep in sync with editor/js/model.js
ITEM_SPHERE_R_MAX = 127  # quarter-units
ITEM_OFFSET_MAX = 255  # per-slot vo/eo/uo/zo are one byte
ITEM_PAGES_MAX = 2  # keep in sync with editor/js/model.js

# Index = TH_*. The cooker puts every grantable pickup in one block (TH 0..BP_NPICKUP-1) so the
# asm handles them with tables (world.asm gb_* rows, hud.asm th_name_*). Props and editor items
# follow. Keep in sync with genmap.py BUILTIN_ITEMS. "bit wallet" / "bit safe" are listed in the
# editor's customItems; they are pulled into this block by name.
BP_PICKUP_KEY = [
    "small health",
    "large health",
    "green armor",
    "blue armor",
    "ammo box",
    "boost pack",
    "red keycard",
    "yellow keycard",
    "blue keycard",
    "soulsphere",
    "radsuit",
    "bit wallet",
    "bit safe",
]
BP_NPICKUP = len(BP_PICKUP_KEY)
BP_MESH_KEY = BP_PICKUP_KEY + ["lightpost", "barrel"]
DOOR_MESH_KEY = ["Tech", "Arch", "Tri", "Crack"]
DOOR_ALIAS = {"tech": "Tech", "arch": "Arch", "tri": "Tri", "crack": "Crack"}


def v(x, y, z):
    return {"x": x, "y": y, "z": z}


DEFAULT_MESHES = {
    "boost pack": {
        "verts": [v(-1, 0, -1), v(1, 0, -1), v(0, 0, 1), v(0, 2, 0)],
        "lines": [[0, 1], [1, 2], [2, 0], [3, 0], [3, 1], [3, 2]],
    },
    "small health": {
        "verts": [
            v(0, 2, 0),
            v(-1, 1, 0),
            v(0, 1, 1),
            v(1, 1, 0),
            v(0, 1, -1),
            v(0, 0, 0),
        ],
        "lines": [
            [4, 5],
            [3, 5],
            [1, 5],
            [2, 5],
            [1, 4],
            [1, 2],
            [2, 3],
            [3, 4],
            [0, 1],
            [0, 2],
            [0, 4],
            [0, 3],
        ],
    },
    "large health": {
        "verts": [
            v(0, 4, 0),
            v(-2, 2, 0),
            v(0, 2, 2),
            v(2, 2, 0),
            v(0, 2, -2),
            v(0, 0, 0),
        ],
        "lines": [
            [4, 5],
            [3, 5],
            [1, 5],
            [2, 5],
            [1, 4],
            [1, 2],
            [2, 3],
            [3, 4],
            [0, 1],
            [0, 2],
            [0, 4],
            [0, 3],
        ],
    },
    "green armor": {
        "verts": [v(-1, 0, -1), v(1, 0, -1), v(1, 0, 1), v(-1, 0, 1), v(0, 3, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]],
    },
    "soulsphere": {
        "verts": [v(0, 0, -2), v(2, 0, 0), v(0, 0, 2), v(-2, 0, 0), v(0, 4, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]],
    },
    "radsuit": {
        "verts": [v(-2, 2, 0), v(-1, 1, 0), v(1, 1, 0), v(2, 2, 0), v(1, 4, 0), v(-1, 4, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
    },
    "yellow keycard": {
        "verts": [v(-2, 1, 0), v(-2, 2, 0), v(-1, 2, 0), v(-1, 1, 0), v(2, 1, 0), v(2, 0, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5]],
    },
    "blue keycard": {
        "verts": [
            v(-2, 1, 0),
            v(-2, 3, 0),
            v(-1, 3, 0),
            v(-1, 1, 0),
            v(2, 1, 0),
            v(2, 2, 0),
            v(2, 0, 0),
        ],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [4, 6]],
    },
    "red keycard": {
        "verts": [
            v(0, 0, 0),
            v(-2, 1, 0),
            v(-2, 3, 0),
            v(0, 4, 0),
            v(2, 3, 0),
            v(2, 1, 0),
            v(0, 2, 0),
            v(-1, 1, 0),
            v(1, 1, 0),
        ],
        "lines": [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
            [5, 0],
            [3, 6],
            [6, 0],
            [6, 7],
            [6, 8],
        ],
    },
    "lightpost": {
        "verts": [v(0, 0, 0), v(0, 4, 0), v(-1, 4, 0), v(1, 4, 0), v(0, 4, -1), v(0, 4, 1)],
        "lines": [[0, 1], [2, 3], [4, 5]],
    },
    "barrel": {
        "verts": [v(-1, 0, 0), v(1, 0, 0), v(1, 2, 0), v(-1, 2, 0), v(0, 0, 1), v(0, 2, 1)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [3, 5], [2, 5], [4, 5]],
    },
    "Tech": {
        "verts": [v(-2, 0, 0), v(2, 0, 0), v(2, 5, 0), v(-2, 5, 0), v(-2, 2, 0), v(2, 2, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]],
    },
    "Arch": {
        "verts": [v(-2, 0, 0), v(2, 0, 0), v(2, 4, 0), v(0, 5, 0), v(-2, 4, 0)],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
    },
    "Tri": {
        "verts": [v(-2, 0, 0), v(2, 0, 0), v(0, 5, 0)],
        "lines": [[0, 1], [1, 2], [2, 0]],
    },
    "Crack": {
        "verts": [
            v(-2, 0, 0),
            v(-2, 4, 0),
            v(-1, 2, 0),
            v(0, 5, 0),
            v(1, 2, 0),
            v(2, 4, 0),
            v(2, 0, 0),
        ],
        "lines": [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    },
}


def js_round(v: float) -> int:
    return int(math.floor(float(v) + 0.5))


def clamp_grid(n: float) -> float:
    q = js_round(float(n) * ITEM_POS_Q) / ITEM_POS_Q
    lo = ITEM_COORD_MIN / ITEM_POS_Q
    hi = ITEM_COORD_MAX / ITEM_POS_Q
    if q < lo:
        return lo
    if q > hi:
        return hi
    return q


def pack_u(n: float) -> int:
    q = js_round(float(n) * ITEM_POS_Q)
    if q < ITEM_COORD_MIN:
        return ITEM_COORD_MIN
    if q > ITEM_COORD_MAX:
        return ITEM_COORD_MAX
    return q


def shift_legacy_vert(raw) -> dict | None:
    if isinstance(raw, (list, tuple)) and len(raw) >= 3:
        return {"x": int(raw[0]) - 4, "y": int(raw[1]), "z": int(raw[2]) - 4}
    if isinstance(raw, dict):
        return {
            "x": int(raw.get("x", 0)) - 4,
            "y": int(raw.get("y", 0)),
            "z": int(raw.get("z", 0)) - 4,
        }
    return None


def migrate_items(raw_items, version: int) -> dict:
    if version >= 9 or not isinstance(raw_items, dict):
        return raw_items if isinstance(raw_items, dict) else {}
    out: dict = {}
    for key, mesh in raw_items.items():
        if not isinstance(mesh, dict):
            continue
        verts = []
        for s in mesh.get("verts") or []:
            v = shift_legacy_vert(s)
            if v:
                verts.append(v)
        out[key] = {**mesh, "verts": verts}
    bp = out.get("boost pack") or {}
    pts = [(int(v["x"]), int(v["y"]), int(v["z"])) for v in bp.get("verts") or []]
    if pts == [(0, 0, 0), (2, 0, 0), (1, 0, 2), (1, 2, 1)]:
        out["boost pack"] = DEFAULT_MESHES["boost pack"]
    return out


def parse_vert(raw) -> dict | None:
    if isinstance(raw, (list, tuple)) and len(raw) >= 3:
        return {"x": clamp_grid(raw[0]), "y": clamp_grid(raw[1]), "z": clamp_grid(raw[2])}
    if isinstance(raw, dict):
        return {
            "x": clamp_grid(raw.get("x", 0)),
            "y": clamp_grid(raw.get("y", 0)),
            "z": clamp_grid(raw.get("z", 0)),
        }
    return None


def parse_mesh(raw) -> dict:
    verts: list[dict] = []
    seen: set[tuple[int, int, int]] = set()
    src_verts = (raw or {}).get("verts") or []
    for s in src_verts:
        v = parse_vert(s)
        if not v:
            continue
        k = (v["x"], v["y"], v["z"])
        if k in seen or len(verts) >= ITEM_MAX_VERTS:
            continue
        seen.add(k)
        verts.append(v)
    lines: list[list[int]] = []
    line_seen: set[tuple[int, int]] = set()
    for s in (raw or {}).get("lines") or []:
        if not isinstance(s, (list, tuple)) or len(s) < 2:
            continue
        a, b = int(s[0]), int(s[1])
        if a == b or a < 0 or b < 0 or a >= len(verts) or b >= len(verts):
            continue
        lo, hi = (a, b) if a < b else (b, a)
        if (lo, hi) in line_seen or len(lines) >= ITEM_MAX_LINES:
            continue
        line_seen.add((lo, hi))
        lines.append([lo, hi])
    return {"verts": verts, "lines": lines, "spheres": parse_spheres((raw or {}).get("spheres"))}


def parse_spheres(raw) -> list[dict]:
    """Up to ITEM_MAX_SPHERES {x,y,z,r}: origin on the vert grid (units, 0.25 snap) and r in
    units, returned as quarter-units (1..127). Mirror of parseItemSpheres in editor/js/model.js."""
    out: list[dict] = []
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict) or len(out) >= ITEM_MAX_SPHERES:
            continue
        try:
            r = js_round(float(s.get("r", 0)) * ITEM_POS_Q)
        except (TypeError, ValueError):
            continue
        r = max(0, min(ITEM_SPHERE_R_MAX, r))
        if r <= 0:
            continue
        out.append(
            {
                "x": clamp_grid(s.get("x", 0)),
                "y": clamp_grid(s.get("y", 0)),
                "z": clamp_grid(s.get("z", 0)),
                "r": r,
            }
        )
    return out


def unique_u8(vals: list[int], cap: int, what: str, name: str) -> tuple[list[int], list[int]]:
    seen: list[int] = []
    idx: list[int] = []
    for v in vals:
        v = v & 0xFF
        if v not in seen:
            if len(seen) >= cap:
                raise SystemExit(f"item {name!r} has >{cap} unique {what}")
            seen.append(v)
        idx.append(seen.index(v))
    return seen, idx


def cook(mesh: dict, name: str) -> dict:
    verts = list(mesh["verts"])
    lines = mesh["lines"]
    if not (verts and lines) and not mesh.get("spheres"):
        raise SystemExit(f"item {name!r} has no geometry")
    # Each sphere origin is a vertex the mesh pipeline already transforms and projects; the
    # sphere routine reads its screen position. An origin on an existing vert reuses it,
    # otherwise it is appended with no edges.
    sph: list[tuple[int, int]] = []
    for s in mesh.get("spheres") or []:
        key = (pack_u(s["x"]), pack_u(s["y"]), pack_u(s["z"]))
        vi = next((i for i, v in enumerate(verts) if (pack_u(v["x"]), pack_u(v["y"]), pack_u(v["z"])) == key), -1)
        if vi < 0:
            vi = len(verts)
            verts.append({"x": s["x"], "y": s["y"], "z": s["z"]})
        sph.append((vi, s["r"]))
    if len(verts) > ITEM_MAX_VERTS:
        raise SystemExit(f"item {name!r} has {len(verts)} verts incl. sphere origins (max {ITEM_MAX_VERTS})")
    ux, xid = unique_u8([pack_u(v["x"]) for v in verts], ITEM_MAX_UNIQUE, "X", name)
    uz, zid = unique_u8([pack_u(v["z"]) for v in verts], ITEM_MAX_UNIQUE, "Z", name)
    pairs: list[tuple[int, int]] = []
    col: list[int] = []
    for xi, zi in zip(xid, zid):
        p = (xi, zi)
        if p not in pairs:
            if len(pairs) >= 16:
                raise SystemExit(f"item {name!r} has >16 unique XZ columns")
            pairs.append(p)
        col.append(pairs.index(p))
    ea: list[int] = []
    eb: list[int] = []
    for a, b in lines:
        ea.append(a)
        eb.append(b)
    return {
        "nv": len(verts),
        "ne": len(lines),
        "nx": len(ux),
        "nz": len(uz),
        "ux": ux,
        "uz": uz,
        "vy": [pack_u(v["y"]) & 0xFF for v in verts],
        "xid": xid,
        "zid": zid,
        "col": col,
        "ea": ea,
        "eb": eb,
        "sph": sph,
    }


def btable(name: str, vals: list[int]) -> str:
    if not vals:
        return f"{name}\n\t!byte 0\n"
    lines = [f"{name}"]
    for i in range(0, len(vals), 16):
        chunk = vals[i : i + 16]
        lines.append("\t!byte " + ",".join(str(v & 0xFF) for v in chunk))
    return "\n".join(lines) + "\n"


def custom_items(doc: dict) -> list[str]:
    """Editor-defined item names that are not in the built-in block, in TH order (TH 15..)."""
    out: list[str] = []
    taken = {k.lower() for k in BP_MESH_KEY} | {k.lower() for k in DOOR_MESH_KEY}
    for src in doc.get("customItems") or []:
        if not isinstance(src, str):
            continue
        name = src.strip()
        if not name or name.lower() in taken:
            continue
        taken.add(name.lower())
        out.append(name)
    return out


ITEM_FL_ROT = 1  # item_rot bit 0: yaw-spins
ITEM_FL_RIDE = 2  # item_rot bit 1: moves with an elevator car it stands on


def item_flags(meta: dict, key: str, custom: bool) -> int:
    """Per-slot flag byte (item_rot). Spin: built-in props (lightpost, barrel) default still.
    Rides lifts: default on (every thing rode before the flag existed)."""
    base = custom or key not in ("lightpost", "barrel")
    m = meta.get(key)
    rot = base
    rides = True
    if isinstance(m, dict):
        if m.get("rotating") is not None:
            rot = bool(m["rotating"])
        if m.get("rides") is not None:
            rides = bool(m["rides"])
        if m.get("door") is True:  # a door face is never a thing
            rot = rides = False
    return (ITEM_FL_ROT if rot else 0) | (ITEM_FL_RIDE if rides else 0)


def pack_pages(cooked: list[dict | None], names: list[str]) -> tuple[list[dict], list[int], list[tuple[int, int, int, int]]]:
    """First-fit, in slot order. A mesh fits a page while every offset it would
    get (verts, edges, unique X, unique Z so far) is <= ITEM_OFFSET_MAX; its data
    may run past 255 because the asm carries into the pointer hi byte.
    Returns (pages, page_of_slot, (vo, eo, uo, zo) per slot). Empty slots: page 0, offsets 0.
    Mirrors itemPagePlan in editor/js/model.js."""
    pages: list[dict] = []
    page_of: list[int] = []
    offs: list[tuple[int, int, int, int]] = []

    def new_page() -> dict:
        pg = {k: [] for k in ("ux", "uz", "vy", "xid", "zid", "col", "ea", "eb")}
        pages.append(pg)
        return pg

    for c, name in zip(cooked, names):
        if c is None:
            page_of.append(0)
            offs.append((0, 0, 0, 0))
            continue
        pi = -1
        for i, pg in enumerate(pages):
            if max(len(pg["vy"]), len(pg["ea"]), len(pg["ux"]), len(pg["uz"])) <= ITEM_OFFSET_MAX:
                pi = i
                break
        if pi < 0:
            new_page()
            pi = len(pages) - 1
            if pi >= ITEM_PAGES_MAX:
                raise SystemExit(
                    f"genitems: item {name!r} needs mesh page {pi} (max {ITEM_PAGES_MAX} pages of 8-bit offsets)"
                )
        pg = pages[pi]
        offs.append((len(pg["vy"]), len(pg["ea"]), len(pg["ux"]), len(pg["uz"])))
        for k in pg:
            pg[k].extend(c[k])
        page_of.append(pi)
    if not pages:
        new_page()
    return pages, page_of, offs


# In-game "You got the <name>" text. Index = TH_* (0..BP_NPICKUP-1). Only the pickup block can be
# granted, so only these get a name. Defaults reproduce the old hand-written hud.asm strings.
GAME_NAME_DEFAULT = {"small health": "stimpack", "large health": "medikit"}
GAME_NAME_GLYPH = {
    "red keycard": "HUD_CH_KEY_RED",
    "yellow keycard": "HUD_CH_KEY_YEL",
    "blue keycard": "HUD_CH_KEY_BLU",
}
ITEM_NAME_MAX = 24  # keep in sync with editor/js/model.js
HUD_MSG_W = 40  # src/mem.asm
HUD_GOT_LEN = 12  # len("You got the ")


def clamp_item_name(s) -> str:
    """Mirror of clampItemName in editor/js/model.js."""
    t = re.sub(r"[^A-Za-z0-9 _-]", "", str(s or ""))
    t = re.sub(r"\s+", " ", t).strip()[:ITEM_NAME_MAX].strip()
    return t


def th_names(meta: dict) -> str:
    """Name strings + th_name_lo/hi for the grantable TH types."""
    lines = ["; TH_* names for hud_got (editor item names; keycards keep their glyph until renamed)"]
    for i, key in enumerate(BP_PICKUP_KEY):
        m = meta.get(key)
        label = clamp_item_name(m.get("label")) if isinstance(m, dict) else ""
        if label:
            text, glyph = label, None
        elif key in GAME_NAME_GLYPH:
            text, glyph = " keycard", GAME_NAME_GLYPH[key]
        else:
            text, glyph = GAME_NAME_DEFAULT.get(key, key), None
        if len(text) + (1 if glyph else 0) + HUD_GOT_LEN > HUD_MSG_W:
            raise SystemExit(f"genitems: name of item {key!r} is too long for the HUD message line")
        lines.append(f"thn_{i}")
        if glyph:
            lines.append(f"\t!byte {glyph}")
        lines.append(f'\t!text "{text}",0')
    lo = ", ".join(f"<thn_{i}" for i in range(BP_NPICKUP))
    hi = ", ".join(f">thn_{i}" for i in range(BP_NPICKUP))
    lines.append(f"th_name_lo\n\t!byte {lo}")
    lines.append(f"th_name_hi\n\t!byte {hi}")
    return "\n".join(lines)


def load_item_meshes() -> tuple[dict, list[str], dict]:
    """(meshes by key, custom item names, itemMeta) from editor/nebula.json over DEFAULT_MESHES."""
    items = dict(DEFAULT_MESHES)
    custom: list[str] = []
    meta: dict = {}
    if DOC.exists():
        doc = json.loads(DOC.read_text(encoding="utf-8"))
        custom = custom_items(doc)
        meta = doc.get("itemMeta") or {}
        raw = migrate_items(doc.get("items") or {}, int(doc.get("version") or 0))
        if isinstance(raw, dict):
            for k, v in raw.items():
                mesh = parse_mesh(v)
                key = DOOR_ALIAS.get(k, k)
                if key == "boost pack" and not mesh["verts"]:
                    continue
                if key in DOOR_MESH_KEY and not mesh["verts"]:
                    continue
                # A sphere-only item has no verts; the cooker appends the sphere origins.
                keep = mesh["verts"] or (mesh["spheres"] and key not in DOOR_MESH_KEY and key != "boost pack")
                items[key] = mesh if keep else items.get(key, {"verts": [], "lines": []})
    return items, custom, meta


def main() -> None:
    items, custom, meta = load_item_meshes()

    for name in custom:
        m = meta.get(name)
        if isinstance(m, dict) and m.get("pickup"):
            raise SystemExit(
                f"genitems: item {name!r} is flagged pickup but is not in BP_PICKUP_KEY (no grant row in world.asm)"
            )

    item_keys = BP_MESH_KEY + custom
    ntypes = len(item_keys)
    slot_names = item_keys + DOOR_MESH_KEY
    cooked: list[dict | None] = []
    for key in item_keys:
        mesh = items.get(key) or {"verts": [], "lines": []}
        if not (mesh.get("verts") and mesh.get("lines")) and not mesh.get("spheres"):
            cooked.append(None)
            continue
        cooked.append(cook(mesh, key))
    # Door meshes are slots ntypes.. in the same tables. A door type byte is any slot (editor Door flag).
    for key in DOOR_MESH_KEY:
        mesh = items.get(key) or DEFAULT_MESHES[key]
        if not mesh.get("verts") or not mesh.get("lines"):
            mesh = DEFAULT_MESHES[key]
        cooked.append(cook(mesh, key))

    if len(slot_names) > 127:
        raise SystemExit(f"genitems: {len(slot_names)} item slots; a door type is 7 bits (DOOR_HIDDEN is bit 7)")
    pages, page_of, offs = pack_pages(cooked, slot_names)

    nv = [c["nv"] if c else 0 for c in cooked]
    ne = [c["ne"] if c else 0 for c in cooked]
    nx = [c["nx"] if c else 0 for c in cooked]
    nz = [c["nz"] if c else 0 for c in cooked]
    vo = [o[0] for o in offs]
    eo = [o[1] for o in offs]
    uo = [o[2] for o in offs]
    zo = [o[3] for o in offs]
    rot = [item_flags(meta, k, k in custom) for k in item_keys] + [0] * len(DOOR_MESH_KEY)
    # Thing cull radius (units, Chebyshev about box+ITEM_BIAS). Worst case over every facing/spin,
    # so draw_world needs no per-frame yaw maths. Min 1 = the old 2x2 foot box.
    def s8_abs(v: int) -> int:
        return abs(v - 256 if v > 127 else v)  # cooked ux/uz are u8-masked

    # A sphere reaches |origin| + r from the centre (r in quarter-units, like ux/uz).
    cr = [
        max(
            1,
            math.ceil(
                (
                    math.hypot(max(map(s8_abs, c["ux"])), max(map(s8_abs, c["uz"])))
                    + max((r for _, r in c["sph"]), default=0)
                )
                / ITEM_POS_Q
            ),
        )
        if c
        else 1
        for c in cooked
    ]
    # Spheres: count per slot, then (hidden or shared) origin vertex index and radius, two per
    # slot (index slot*2 + i). item_spheres reads these after stroke_mesh.
    ns = [len(c["sph"]) if c else 0 for c in cooked]
    sv: list[int] = []
    sr: list[int] = []
    for c in cooked:
        pair = (c["sph"] if c else []) + [(0, 0)] * ITEM_MAX_SPHERES
        for vi, r in pair[:ITEM_MAX_SPHERES]:
            sv.append(vi)
            sr.append(r)

    blob_names = ("ux", "uz", "vy", "xid", "zid", "col", "ea", "eb")
    parts = [
        "; Generated by tools/genitems.py — do not edit",
        f"ITEM_ORIGIN	= {ITEM_ORIGIN}",
        f"ITEM_BIAS	= {ITEM_BIAS}",
        f"ITEM_DOOR_BASE	= {ntypes}",
        f"ITEM_NSLOTS	= {len(slot_names)}",
        f"ITEM_NPAGES	= {len(pages)}",
        f"ITEM_FL_ROT	= {ITEM_FL_ROT}",
        f"ITEM_FL_RIDE	= {ITEM_FL_RIDE}",
        "",
        "; Resident: indexed by th_cull_hit, item_pick_rot and the nv = 0 fallbacks.",
        btable("item_nv", nv).rstrip(),
        "; per-slot flags: ITEM_FL_ROT = yaw-spins about box+ITEM_BIAS (editor Rotating flag),",
        "; ITEM_FL_RIDE = carried by an elevator car it stands on (editor Rides lifts flag)",
        btable("item_rot", rot).rstrip(),
        "; thing frustum-cull half-extent in units about box+ITEM_BIAS (th_cull_hit)",
        btable("item_cr", cr).rstrip(),
        "; editor spheres: count per slot; origin vertex and radius (quarter-units), index slot*2+i",
        btable("item_ns", ns).rstrip(),
        btable("item_sv", sv).rstrip(),
        btable("item_sr", sr).rstrip(),
        "",
    ]
    parts.append(th_names(meta))
    parts.append("")
    OUT.write_text("\n".join(parts), encoding="utf-8")
    blob = [
        "; Generated by tools/genitems.py — do not edit",
        "; Segment E (e_item.asm): read only by fill_item_slot and, through the mesh",
        "; pointers it sets, by the transform / project / clip that follow.",
        btable("item_ne", ne).rstrip(),
        btable("item_nx", nx).rstrip(),
        btable("item_nz", nz).rstrip(),
        btable("item_vo", vo).rstrip(),
        btable("item_eo", eo).rstrip(),
        btable("item_uo", uo).rstrip(),
        btable("item_zo", zo).rstrip(),
        btable("item_pg", page_of).rstrip(),
        "",
    ]
    for b in blob_names:
        for pi, pg in enumerate(pages):
            blob.append(btable(f"item_{b}_{pi}", pg[b] or [0]).rstrip())
    blob.append("")
    for b in blob_names:
        lo = ",".join(f"<item_{b}_{pi}" for pi in range(len(pages)))
        hi = ",".join(f">item_{b}_{pi}" for pi in range(len(pages)))
        blob.append(f"pg_{b}_lo\n\t!byte {lo}")
        blob.append(f"pg_{b}_hi\n\t!byte {hi}")
    blob.append("")
    BLOB.write_text("\n".join(blob), encoding="utf-8")
    n_custom = sum(1 for c in cooked[:ntypes] if c)
    print(
        f"Wrote {OUT.relative_to(ROOT)}: {n_custom} item meshes ({len(custom)} custom) "
        f"+ {len(DOOR_MESH_KEY)} door meshes, {len(pages)} page(s)"
    )


if __name__ == "__main__":
    main()
