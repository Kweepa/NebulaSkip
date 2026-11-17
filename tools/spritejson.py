"""editor/sprites.json -> packed mode-E rects (shared by genweapons / gensplat / genenemymuzzle).

A sprite is w x h pixels, one bit each; a pixel is 2 hires wide. It is placed at (ox, oy) hires
inside a per-id local canvas, which is then handed to sprmask.pack_clipped with that id's
x_origin / y_origin. The canvases match what the old PNG pipeline fed pack_clipped, so the
packed bytes are unchanged.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from sprmask import pack_clipped  # noqa: E402

SPRITES_JSON = ROOT / "editor" / "sprites.json"

# id -> (canvas_w, canvas_h, x_origin, y_origin, black). Keep in sync with SPRITE_DEFS in
# editor/js/spriteModel.js (ox/oy are relative to these canvases).
VIEW_W = 192
VIEW_H = 128
CANVAS = {
    "pistol": (48, 42, 0, 0, True),
    "muzzle_flash": (24, 21, 172 - 88, -20, False),
    "jump_cursor": (VIEW_W, VIEW_H, 0, 0, True),
    # Pistol canvas, raised 6 rows: a 32-row rig rests flush with the viewport bottom (the bob only
    # pushes it down), where the pistol hangs 6 rows off. Drawn in the pistol's place in scan mode.
    "scan_rig": (48, 42, 0, -6, True),
}
for _i in range(3):
    CANVAS[f"splat_{_i}"] = (24, 21, 0, 0, False)
    CANVAS[f"enemy_muzzle_{_i}"] = (24, 21, 0, 0, False)


def load_sprites() -> dict[str, dict]:
    if not SPRITES_JSON.is_file():
        raise SystemExit(f"missing {SPRITES_JSON}; run tools/seed_sprites.py once")
    data = json.loads(SPRITES_JSON.read_text(encoding="utf-8"))
    return {s["id"]: s for s in data.get("sprites", [])}


def render(sprite: dict, sid: str) -> list[list[int]]:
    """Hires pixel grid (local canvas) for one sprite. Ink outside the canvas is dropped."""
    cw, ch, _xo, _yo, _black = CANVAS[sid]
    pix = [[0] * cw for _ in range(ch)]
    ox, oy = int(sprite["ox"]), int(sprite["oy"])
    clipped = 0
    for y, row in enumerate(sprite["rows"]):
        for x, c in enumerate(row):
            if c != "#":
                continue
            for dx in (0, 1):
                px, py = ox + 2 * x + dx, oy + y
                if 0 <= px < cw and 0 <= py < ch:
                    pix[py][px] = 1
                else:
                    clipped += 1
    if clipped:
        print(f"  WARNING {sid}: {clipped} hires pixels fall outside its {cw}x{ch} canvas and were dropped")
    return pix


def has_ink(sprite: dict) -> bool:
    return any("#" in r for r in sprite["rows"])


def pack(sprites: dict[str, dict], sid: str, *, required: bool = True) -> list[int] | None:
    """Packed rect for sprite `sid`, or None when it is blank and not required."""
    sp = sprites.get(sid)
    if sp is None:
        raise SystemExit(f"{SPRITES_JSON.name}: no sprite '{sid}'")
    if not has_ink(sp):
        if required:
            raise SystemExit(f"{sid}: no ink")
        return None
    _cw, _ch, xo, yo, black = CANVAS[sid]
    return pack_clipped(render(sp, sid), black=black, x_origin=xo, y_origin=yo, name=sid)
