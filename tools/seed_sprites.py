#!/usr/bin/env python3
"""One-off: build editor/sprites.json from the legacy PNGs (assets/weapons, assets/enemies, ui/crosshair.png).

Refuses to overwrite an existing editor/sprites.json unless --force. Hires pairs are OR-ed into
2x1 pixels, which is exactly what pack_clipped did, so the generated .asm is unchanged.

    python tools/seed_sprites.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from PIL import Image  # noqa: E402

OUT = ROOT / "editor" / "sprites.json"
W_MIN, H_MIN = 4, 8


def load_hires(path: Path, ink_is_black: bool = False) -> list[list[int]]:
    if not path.is_file():
        raise SystemExit(f"missing {path}")
    im = Image.open(path).convert("RGB")
    src = im.load()
    out = []
    for y in range(im.size[1]):
        row = []
        for x in range(im.size[0]):
            r, g, b = src[x, y][:3]
            dark = r <= 16 and g <= 16 and b <= 16
            row.append(1 if (dark if ink_is_black else not dark) else 0)
        out.append(row)
    return out


def to_rows(hires: list[list[int]], pad_top: int = 0, pad_bottom: int = 0) -> list[str]:
    w = len(hires[0])
    if w % 2:
        raise SystemExit("odd hires width")
    rows = ["." * (w // 2)] * pad_top
    for r in hires:
        rows.append("".join("#" if (r[x] or r[x + 1]) else "." for x in range(0, w, 2)))
    rows += ["." * (w // 2)] * pad_bottom
    return rows


def entry(sid: str, rows: list[str], ox: int, oy: int) -> dict:
    h, w = len(rows), len(rows[0])
    if w < W_MIN or h < H_MIN or w % 4 or h % 2:
        raise SystemExit(f"{sid}: {w}x{h} is outside the editor slider grid")
    return {"id": sid, "w": w, "h": h, "ox": ox, "oy": oy, "rows": rows}


def main() -> None:
    if OUT.exists() and "--force" not in sys.argv:
        raise SystemExit(f"{OUT} exists; pass --force to overwrite")
    wp = ROOT / "assets" / "weapons"
    ep = ROOT / "assets" / "enemies"
    sprites = [
        entry("pistol", to_rows(load_hires(wp / "pistol_lines.png")), 10, 0),
        entry("muzzle_flash", to_rows(load_hires(wp / "muzzle_flash.png"), pad_bottom=1), 0, 0),
    ]
    for i in range(3):
        sprites.append(entry(f"splat_{i}", to_rows(load_hires(wp / f"splat_{i}.png"), pad_bottom=1), 0, 0))
    for i in range(3):
        sprites.append(entry(f"enemy_muzzle_{i}", to_rows(load_hires(ep / f"enemy_muzzle_{i}.png"), pad_bottom=1), 0, 0))
    xh = load_hires(ROOT / "ui" / "crosshair.png", ink_is_black=True)
    iw, ih = len(xh[0]), len(xh)
    # Centred on the 192x128 viewport (96, 64), padded to 8 rows: 2 above, rest below.
    pad_top = 2
    pad_bottom = H_MIN - ih - pad_top
    sprites.append(entry("jump_cursor", to_rows(xh, pad_top, pad_bottom), 96 - iw // 2, 64 - ih // 2 - pad_top))
    sprites.append(entry("scan_rig", ["." * 20] * 20, 96 - 20, 64 - 10))

    blocks = []
    for sp in sprites:
        rows = ",\n".join(f"        {json.dumps(r)}" for r in sp["rows"])
        blocks.append(
            f'    {{\n      "id": {json.dumps(sp["id"])}, "w": {sp["w"]}, "h": {sp["h"]}, "ox": {sp["ox"]}, "oy": {sp["oy"]},\n'
            f'      "rows": [\n{rows}\n      ]\n    }}'
        )
    text = '{\n  "version": 1,\n  "sprites": [\n' + ",\n".join(blocks) + "\n  ]\n}\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(sprites)} sprites)")


if __name__ == "__main__":
    main()
