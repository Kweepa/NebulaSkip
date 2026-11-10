#!/usr/bin/env python3
"""Drive cursor for the Atari menu: ui/drivecursorlow.png → src/a8_cursor_tab.asm.

The source is hand-reduced art, one pixel per hires pixel (24 wide = 12 colour
clocks, or 32 wide = 16). Hardware split per line:

  - P0|P1 cover clocks 0..7, P2|P3 the rest, multicolour OR, so each clock is
    one of 0, CA, CB, CA|CB. Each pair has its own colours (PAIRS, or searched).
  - M0..M3 double width as the fifth player (PF3 = black): a plate under the
    cursor, so black is wanted where the row's paper must not show.
  - Mode-2 glyph columns under the players. A set bit takes PF1's luminance
    and keeps the hue of whatever is underneath (player, plate or paper).

PF1 differs per text row (blank, yellow item, bright selected item), so every
line is solved for each luminance in LUMS. The menu picks the table at run time.

PAL: the menu converts the four COLPM bytes through a8_to_pal. OR of two
converted hues is not the converted OR, so an overlap of two different non-grey
hues is never used.

Frame 0 is the art as drawn, frame 1 lights the screen (blink).
"""
from __future__ import annotations

import colorsys
import functools
import itertools
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ui" / "drivecursorlow.png"
OUT = ROOT / "src" / "a8_cursor_tab.asm"
SPR = ROOT / "src" / "menu_cursor_spr.asm"
PREVIEW = ROOT / "ui" / "drive_cursor_preview.png"

_im = Image.open(SRC)
W, H = _im.size				# hand-reduced art, one source pixel per hires pixel
if W not in (24, 32):
	raise SystemExit(f"{SRC.name}: width must be 24 or 32, got {W}")
CLOCKS = W // 2
CELLS = W // 8				# glyph columns
PLATE_CELLS = W // 4		# 2 clocks each
LUMS = (0, 12, 14)			# blank row, yellow item, selected item
PAPER = 0x84				# option box: COL_BOX 6 → a8_c64pal[6]
FRAMES = 2
# Hand-picked (CA, CB) per player pair; None searches.
PAIRS = ((0x08, 0xD2), (0x08, 0xFC))

W_RGB = (2.0, 4.0, 3.0)
# The cursor sits on the selected row: its lines see PF1 luminance 14.
LUM_W = {0: 1.0, 12: 1.5, 14: 6.0}


# Altirra NTSC default palette, measured from a flat-colour chart: hue $0..$F,
# luminance 0,2,..14 (bit 0 of the luminance does not exist for players).
ALTIRRA = (
	((0,0,0),(22,21,23),(62,60,63),(103,100,106),(131,126,133),(170,164,173),(205,198,210),(239,232,244)),
	((0,2,0),(7,42,0),(54,79,0),(98,117,0),(127,142,0),(167,179,39),(203,213,85),(242,249,129)),
	((12,0,0),(61,24,0),(101,61,0),(143,100,0),(170,126,0),(210,163,58),(245,197,100),(255,234,143)),
	((40,0,0),(90,0,0),(131,41,0),(173,82,22),(200,109,57),(240,147,101),(255,182,140),(255,219,180)),
	((54,0,0),(103,0,0),(144,24,41),(187,69,86),(214,96,114),(254,135,155),(255,170,191),(255,208,231)),
	((51,0,16),(99,2,61),(140,26,101),(183,66,142),(210,93,169),(250,132,209),(255,167,244),(255,204,255)),
	((26,10,66),(76,21,109),(119,39,147),(161,74,187),(189,100,214),(229,137,253),(255,171,255),(255,208,255)),
	((0,19,95),(34,31,137),(81,52,174),(125,86,214),(153,111,241),(193,148,255),(229,182,255),(255,218,255)),
	((0,20,99),(0,35,141),(18,62,178),(76,98,218),(106,124,244),(148,161,255),(185,194,255),(224,231,255)),
	((0,14,77),(0,37,120),(0,72,157),(0,110,197),(42,136,224),(96,174,255),(137,208,255),(179,244,255)),
	((0,4,33),(0,44,77),(0,82,116),(0,121,157),(0,147,184),(34,185,223),(94,219,255),(142,255,255)),
	((0,11,0),(0,53,18),(0,91,60),(0,130,103),(0,156,131),(0,194,171),(74,227,208),(127,255,246)),
	((0,18,0),(0,59,0),(0,95,0),(0,134,43),(0,159,74),(38,197,117),(97,230,154),(144,255,194)),
	((0,15,0),(0,57,0),(0,93,0),(0,131,0),(49,156,13),(101,193,70),(142,227,110),(183,255,152)),
	((0,5,0),(0,47,0),(35,83,0),(83,121,0),(112,146,0),(154,183,41),(190,217,86),(229,253,130)),
	((3,0,0),(50,30,0),(90,67,0),(132,105,0),(159,131,0),(199,168,49),(234,202,93),(255,239,136)),
)


def atari_rgb(b: int) -> tuple[float, float, float]:
	return tuple(float(v) for v in ALTIRRA[b >> 4][(b & 15) >> 1])


RGB = np.array([atari_rgb(b) for b in range(256)])
PAPER_RGB = RGB[PAPER]
BLACK_RGB = RGB[0]


CHROMA_BOOST = 4.0		# coloured pixels (screen, connector) count more than grey body


@functools.lru_cache(maxsize=None)
def lab(rgb: tuple) -> tuple[float, float, float]:
	def lin(v):
		v /= 255.0
		return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

	r, g, b = (lin(v) for v in rgb)
	x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
	y = 0.2126 * r + 0.7152 * g + 0.0722 * b
	z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

	def f(t):
		return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

	fx, fy, fz = f(x), f(y), f(z)
	return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def dist(a, b) -> float:
	"""Squared CIE76 distance, a = target. Coloured targets weigh more."""
	la = lab(tuple(int(round(v)) for v in a))
	lb = lab(tuple(int(round(v)) for v in b))
	chroma = math.hypot(la[1], la[2])
	w = 1.0 + CHROMA_BOOST * max(0.0, chroma - 15.0) / 40.0
	return w * ((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2)


def load_target() -> list[list[tuple | None]]:
	a = np.asarray(Image.open(SRC).convert("RGBA"), dtype=float)
	return [
		[None if a[y, x, 3] < 128 else tuple(a[y, x, :3]) for x in range(W)]
		for y in range(H)
	]


def lit_frame(grid):
	"""Frame 1: dark screen green becomes the bright green used for its glints."""
	out = []
	for row in grid:
		nr = []
		for x, p in enumerate(row):
			if p is not None and x < W // 2 and abs(p[0] - 31) + abs(p[1] - 92) + abs(p[2] - 50) < 12:
				p = (86.0, 172.0, 77.0)
			nr.append(p)
		out.append(nr)
	return out


def px_byte(pcs, pm, g, plate, row_lum) -> int:
	if pm:
		b = pcs[pm]
	elif plate:
		b = 0
	else:
		b = PAPER
	if g:
		b = (b & 0xF0) | row_lum
	return b


def solve_clock(t0, t1, pcs, plate, row_lum):
	"""Best (err, player mask, glyph bits) for one colour clock."""
	t0 = PAPER_RGB if t0 is None else t0
	t1 = PAPER_RGB if t1 is None else t1
	best = None
	for pm in (0, 1, 2, 3):
		if pm and pcs[pm] is None:
			continue
		for g in (0, 2, 1, 3):
			e = dist(t0, RGB[px_byte(pcs, pm, g & 2, plate, row_lum)]) + dist(
				t1, RGB[px_byte(pcs, pm, g & 1, plate, row_lum)]
			)
			if best is None or e < best[0]:
				best = (e, pm, g)
	return best


def pairs_for(ca: int, cb: int):
	"""Player colours by mask. The overlap is only usable when its hue survives
	a8_to_pal: both hues equal, or one of them grey. Otherwise None."""
	ha, hb = ca >> 4, cb >> 4
	both = ca | cb if (ha == hb or ha == 0 or hb == 0) else None
	return (0, ca, cb, both)


def cell_cost(line, cell, pcs, on):
	e = 0
	for lum in LUMS:
		for c in (cell * 2, cell * 2 + 1):
			e += LUM_W[lum] * solve_clock(line[2 * c], line[2 * c + 1], pcs, on, lum)[0]
	return e


def half_cost(grids, half, pcs) -> float:
	"""Total error of one player pair (4 plate cells) over every frame/line."""
	tot = 0.0
	for grid in grids:
		for line in grid:
			for cell in range(half * 4, min(PLATE_CELLS, half * 4 + 4)):
				tot += min(cell_cost(line, cell, pcs, False), cell_cost(line, cell, pcs, True))
	return tot


def nearest_hue(rgb) -> int | None:
	h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in rgb))
	if s < 0.22 or v < 0.12:
		return None
	best, bd = 1, 1e9
	for hue in range(1, 16):
		hh, _s, _v = colorsys.rgb_to_hsv(*(x / 255 for x in atari_rgb(hue * 16 + 8)))
		d = min(abs(h - hh), 1 - abs(h - hh))
		if d < bd:
			best, bd = hue, d
	return best


def candidate_pairs(grid, half):
	"""(CA, CB) for one player pair: every luminance of grey and the top hues."""
	votes: dict[int, int] = {}
	for line in grid:
		for p in line[half * 16 : half * 16 + 16]:
			if p is None:
				continue
			h = nearest_hue(p)
			if h:
				votes[h] = votes.get(h, 0) + 1
	hues = [0] + [h for h, _n in sorted(votes.items(), key=lambda kv: -kv[1])[:3]]
	cols = sorted({(h << 4) | l for h in hues for l in range(2, 16, 2)})
	return [(ca, cb) for ca, cb in itertools.combinations(cols, 2) if ca | cb not in (ca, cb)]


def solve_line(line, pairs, row_lum, plate):
	"""Players, glyph bytes for one line/lum given the plate cells (8-bit mask)."""
	p = [0, 0, 0, 0]		# P0..P3, bit 7 = leftmost clock of the pair
	glyph = 0
	err = 0
	for c in range(CLOCKS):
		half = c // 8
		covered = bool(plate & (1 << (PLATE_CELLS - 1 - c // 2)))
		e, pm, g = solve_clock(line[2 * c], line[2 * c + 1], pairs[half], covered, row_lum)
		err += e
		bit = 7 - (c % 8)
		if pm & 1:
			p[half * 2] |= 1 << bit
		if pm & 2:
			p[half * 2 + 1] |= 1 << bit
		glyph |= g << (2 * (CLOCKS - 1 - c))
	return err, p, glyph


def pick_plate(line, pairs) -> int:
	plate = 0
	for cell in range(PLATE_CELLS):
		pcs = pairs[cell // 4]
		if cell_cost(line, cell, pcs, True) < cell_cost(line, cell, pcs, False):
			plate |= 1 << (PLATE_CELLS - 1 - cell)
	return plate


def missile_byte(plate: int) -> int:
	# Cell 0..7, M0 = cells 0-1 (bits 1,0), M1 = 2-3 (3,2), M2 = 4-5, M3 = 6-7.
	out = 0
	for cell in range(PLATE_CELLS):
		if plate & (1 << (PLATE_CELLS - 1 - cell)):
			out |= 1 << ((cell // 2) * 2 + (1 if cell % 2 == 0 else 0))
	return out


def fmt(data, per=16):
	return ["\t!byte " + ",".join(f"${b:02x}" for b in data[i : i + per]) for i in range(0, len(data), per)]


def main() -> None:
	base = load_target()
	grids = [base, lit_frame(base)]

	chosen = []
	total = 0.0
	for half in (0, 1):
		if PAIRS and PAIRS[half]:
			ca, cb = PAIRS[half]
			e = half_cost(grids, half, pairs_for(ca, cb))
			chosen.append((e, ca, cb))
			total += e
			continue
		best = None
		for ca, cb in candidate_pairs(base, half):
			e = half_cost(grids, half, pairs_for(ca, cb))
			if best is None or e < best[0]:
				best = (e, ca, cb)
		chosen.append(best)
		total += best[0]
	pairs = [pairs_for(c[1], c[2]) for c in chosen]
	cols = [c[1:] for c in chosen]

	lines = [
		"; Auto-generated by tools/gen_drive_cursor.py from ui/drivecursorlow.png",
		f"A8CUR_C0\t= ${cols[0][0]:02x}\t\t; P0 (NTSC; menu converts with a8_to_pal)",
		f"A8CUR_C1\t= ${cols[0][1]:02x}\t\t; P1 (P0|P1 = ${cols[0][0] | cols[0][1]:02x})",
		f"A8CUR_C2\t= ${cols[1][0]:02x}\t\t; P2",
		f"A8CUR_C3\t= ${cols[1][1]:02x}\t\t; P3 (P2|P3 = ${cols[1][0] | cols[1][1]:02x})",
		f"A8CUR_GEN_LINES\t= {H}",
		f"A8CUR_GEN_COLS\t= {CELLS}",
		"; Per frame, per line, per row luminance (0, C, E):",
		";   a8ct_p: P0, P1, P2, P3",
		";   a8ct_g: glyph bytes for the text columns (always four, unused ones 0)",
		"; a8ct_m: per frame, per line, missile plate byte",
		"",
	]
	ptabs, gtabs, mtabs = [], [], []
	for grid in grids:
		pt: list[int] = []
		gt: list[int] = []
		mt: list[int] = []
		for line in grid:
			plate = pick_plate(line, pairs)
			for lum in LUMS:
				_e, p, glyph = solve_line(line, pairs, lum, plate)
				pt += p
				gt += [(glyph >> (8 * (CELLS - 1 - k))) & 0xFF if k < CELLS else 0 for k in range(4)]
			mt.append(missile_byte(plate))
		ptabs.append(pt)
		gtabs.append(gt)
		mtabs.append(mt)

	for name in ("p", "g", "m"):
		lines.append(f"a8ct_{name}lo\t!byte " + ",".join(f"<a8ct_{name}{f}" for f in range(FRAMES)))
		lines.append(f"a8ct_{name}hi\t!byte " + ",".join(f">a8ct_{name}{f}" for f in range(FRAMES)))
	lines.append("")
	for name, tabs in (("p", ptabs), ("g", gtabs), ("m", mtabs)):
		for f, tab in enumerate(tabs):
			lines.append(f"a8ct_{name}{f}")
			lines.extend(fmt(tab))
		lines.append("")
	OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
	SPR.write_text(
		"; Auto-generated by tools/gen_drive_cursor.py\n"
		f"CURSOR_FRAMES\t= {FRAMES}\n",
		encoding="utf-8",
	)
	write_preview(grids, pairs, ptabs, gtabs, mtabs)
	print(
		f"wrote {OUT.relative_to(ROOT)} left=${cols[0][0]:02x}/${cols[0][1]:02x} "
		f"right=${cols[1][0]:02x}/${cols[1][1]:02x} err={total:.0f} + {PREVIEW.relative_to(ROOT)}"
	)


def write_preview(grids, pairs, ptabs, gtabs, mtabs) -> None:
	"""Per frame: target, then the Atari result on selected / yellow / blank rows."""
	S = 8
	gap = 4
	cw = W * S + gap * S
	rh = H * S + gap * S
	im = Image.new("RGB", (cw * FRAMES, rh * 4), tuple(int(v) for v in PAPER_RGB))
	px = im.load()

	def put(fx, ry, x, y, rgb):
		rgb = tuple(int(round(v)) for v in rgb)
		for dy in range(S):
			for dx in range(S):
				px[fx * cw + x * S + dx, ry * rh + y * S + dy] = rgb

	for f in range(FRAMES):
		for y in range(H):
			for x in range(W):
				t = grids[f][y][x]
				put(f, 0, x, y, PAPER_RGB if t is None else t)
			for k, li in enumerate((2, 1, 0)):
				lum = LUMS[li]
				base = (y * 3 + li)
				p = ptabs[f][base * 4 : base * 4 + 4]
				g = gtabs[f][base * 4 : base * 4 + 4]
				m = mtabs[f][y]
				for x in range(W):
					c = x // 2
					half = c // 8
					bit = 7 - (c % 8)
					pm = ((p[half * 2] >> bit) & 1) | (((p[half * 2 + 1] >> bit) & 1) << 1)
					gb = (g[x // 8] >> (7 - (x % 8))) & 1
					cell = x // 4
					mbit = (cell // 2) * 2 + (1 if cell % 2 == 0 else 0)
					plate = bool(m & (1 << mbit))
					put(f, k + 1, x, y, RGB[px_byte(pairs[half], pm, gb, plate, lum)])
	im.save(PREVIEW)


if __name__ == "__main__":
	main()
