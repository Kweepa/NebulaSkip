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

ITEM_COORD_MIN = -128
ITEM_COORD_MAX = 127
ITEM_POS_Q = 4
ITEM_ORIGIN = 0
ITEM_BIAS = 1
ITEM_MAX_VERTS = 16
ITEM_MAX_LINES = 16
ITEM_MAX_UNIQUE = 6
ITEM_OFFSET_MAX = 255  # per-slot vo/eo/uo/zo are one byte
ITEM_PAGES_MAX = 2  # keep in sync with editor/js/model.js

# Index = BP_*
BP_MESH_KEY = [
    "small health",
    "large health",
    "green armor",
    "blue armor",
    "ammo box",
    "shells",
    "box of rockets",
    "shotgun",
    "chaingun",
    "chainsaw",
    "rocket launcher",
    "backpack",
    "red keycard",
    "yellow keycard",
    "blue keycard",
    "soulsphere",
    "radsuit",
    "lightpost",
    "barrel",
]
DOOR_MESH_KEY = ["Tech", "Arch", "Tri", "Crack"]
DOOR_ALIAS = {"tech": "Tech", "arch": "Arch", "tri": "Tri", "crack": "Crack"}


def v(x, y, z):
    return {"x": x, "y": y, "z": z}


DEFAULT_MESHES = {
    "backpack": {
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
    "chainsaw": {
        "verts": [v(0, 0, 0), v(0, 3, 0), v(-1, 3, 0), v(1, 3, 0)],
        "lines": [[0, 1], [1, 2], [1, 3]],
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
    bp = out.get("backpack") or {}
    pts = [(int(v["x"]), int(v["y"]), int(v["z"])) for v in bp.get("verts") or []]
    if pts == [(0, 0, 0), (2, 0, 0), (1, 0, 2), (1, 2, 1)]:
        out["backpack"] = DEFAULT_MESHES["backpack"]
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
    return {"verts": verts, "lines": lines}


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
    verts = mesh["verts"]
    lines = mesh["lines"]
    if not verts or not lines:
        raise SystemExit(f"item {name!r} has no geometry")
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
    """User-defined item names, in TH order (TH 19..). Mirrors parseCustomItems."""
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


def item_rotates(meta: dict, key: str, custom: bool) -> int:
    """Per-slot spin flag. Built-in props (lightpost, barrel) default still."""
    base = custom or key not in ("lightpost", "barrel")
    m = meta.get(key)
    if isinstance(m, dict) and m.get("rotating") is not None:
        return 1 if m["rotating"] else 0
    return 1 if base else 0


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


# In-game "You got the <name>" text. Index = TH_* (0..TH_NTYPES-1). Only these slots can be
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
    for i, key in enumerate(BP_MESH_KEY):
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
    lo = ", ".join(f"<thn_{i}" for i in range(len(BP_MESH_KEY)))
    hi = ", ".join(f">thn_{i}" for i in range(len(BP_MESH_KEY)))
    lines.append(f"th_name_lo\n\t!byte {lo}")
    lines.append(f"th_name_hi\n\t!byte {hi}")
    return "\n".join(lines)


def main() -> None:
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
                if key == "backpack" and not mesh["verts"]:
                    continue
                if key in DOOR_MESH_KEY and not mesh["verts"]:
                    continue
                items[key] = mesh if mesh["verts"] else items.get(key, {"verts": [], "lines": []})

    for name in custom:
        m = meta.get(name)
        if isinstance(m, dict) and m.get("pickup"):
            raise SystemExit(
                f"genitems: item {name!r} is flagged pickup but has no grant behaviour in the asm"
            )

    item_keys = BP_MESH_KEY + custom
    ntypes = len(item_keys)
    slot_names = item_keys + DOOR_MESH_KEY
    cooked: list[dict | None] = []
    for key in item_keys:
        mesh = items.get(key) or {"verts": [], "lines": []}
        if not mesh.get("verts") or not mesh.get("lines"):
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
    rot = [item_rotates(meta, k, k in custom) for k in item_keys] + [0] * len(DOOR_MESH_KEY)
    # Thing cull radius (units, Chebyshev about box+ITEM_BIAS). Worst case over every facing/spin,
    # so draw_world needs no per-frame yaw maths. Min 1 = the old 2x2 foot box.
    def s8_abs(v: int) -> int:
        return abs(v - 256 if v > 127 else v)  # cooked ux/uz are u8-masked

    cr = [
        max(1, math.ceil(math.hypot(max(map(s8_abs, c["ux"])), max(map(s8_abs, c["uz"]))) / ITEM_POS_Q))
        if c
        else 1
        for c in cooked
    ]

    blob_names = ("ux", "uz", "vy", "xid", "zid", "col", "ea", "eb")
    parts = [
        "; Generated by tools/genitems.py — do not edit",
        f"ITEM_ORIGIN	= {ITEM_ORIGIN}",
        f"ITEM_BIAS	= {ITEM_BIAS}",
        f"ITEM_DOOR_BASE	= {ntypes}",
        f"ITEM_NSLOTS	= {len(slot_names)}",
        f"ITEM_NPAGES	= {len(pages)}",
        "",
        btable("item_nv", nv).rstrip(),
        btable("item_ne", ne).rstrip(),
        btable("item_nx", nx).rstrip(),
        btable("item_nz", nz).rstrip(),
        btable("item_vo", vo).rstrip(),
        btable("item_eo", eo).rstrip(),
        btable("item_uo", uo).rstrip(),
        btable("item_zo", zo).rstrip(),
        btable("item_pg", page_of).rstrip(),
        "; 1 = yaw-spins about box+ITEM_BIAS (editor Rotating flag)",
        btable("item_rot", rot).rstrip(),
        "; thing frustum-cull half-extent in units about box+ITEM_BIAS (th_cull_hit)",
        btable("item_cr", cr).rstrip(),
        "",
    ]
    for b in blob_names:
        for pi, pg in enumerate(pages):
            parts.append(btable(f"item_{b}_{pi}", pg[b] or [0]).rstrip())
    parts.append("")
    for b in blob_names:
        lo = ",".join(f"<item_{b}_{pi}" for pi in range(len(pages)))
        hi = ",".join(f">item_{b}_{pi}" for pi in range(len(pages)))
        parts.append(f"pg_{b}_lo\n\t!byte {lo}")
        parts.append(f"pg_{b}_hi\n\t!byte {hi}")
    parts.append("")
    parts.append(th_names(meta))
    parts.append("")
    OUT.write_text("\n".join(parts), encoding="utf-8")
    n_custom = sum(1 for c in cooked[:ntypes] if c)
    print(
        f"Wrote {OUT.relative_to(ROOT)}: {n_custom} item meshes ({len(custom)} custom) "
        f"+ {len(DOOR_MESH_KEY)} door meshes, {len(pages)} page(s)"
    )


if __name__ == "__main__":
    main()
