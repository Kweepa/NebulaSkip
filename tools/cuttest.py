#!/usr/bin/env python3
"""Scripted check of the map-arrival cutscene in Altirra.

    python tools/cuttest.py            # boot MAPA (level 1), log every cutscene frame, dump views
    python tools/cuttest.py --render   # only re-render the PNGs from the last run

Boots nebula.atr under the Altirra debugger, skips the menu (see memory note altirra-smoke-test),
lets `start` load MAPA and run its cutscene, and stops at the first wait_draw_free at or past each
--times value while the overlay runs. Each stop logs the time cursor, room_idx and camera and dumps
both bitmaps; after the overlay returns it logs the restored spawn view at enter_card and dumps a
few frames of normal play. Needs a build with a cutscene on MAPA (build first). An Altirra window
opens; leave it alone. Output: tmp/cuttest/ (log, bitmaps, contact sheet PNGs).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALTIRRA = Path(r"C:\app\altirra\Altirra64.exe")
OUT = ROOT / "tmp" / "cuttest"
BOOT_JSR = 0x04C6
PORTB_PLAY = 0xE2
GAME_DL = bytes.fromhex("70420002827002028270020280" "4E0040") + b"\x0e" * 127 + bytes.fromhex("410000")


def labels(path: Path) -> dict[str, int]:
    out = {}
    for line in path.read_text().splitlines():
        m = re.match(r"al C:([0-9a-f]+) \.(\S+)", line)
        if m:
            out.setdefault(m.group(2), int(m.group(1), 16))
    return out


def script(lab: dict[str, int], cut: dict[str, int], times: list[int], after: int, log: Path, done: Path,
           level: int = 1, skip: bool = False, play: bool = False) -> str:
    cond = f"db($d301)=${PORTB_PLAY:02x}"
    A = lambda n: f"${lab[n]:04x}"
    state = (
        f'.printf "{{tag}} pc=%x room=%d cam=%d.%d,%d.%d,%d.%d yaw=%d show=%d den=%d t=%d" pc db({A("room_idx")}) '
        f'db({A("cam_xh")}) db({A("cam_xl")}) db({A("cam_yh")}) db({A("cam_yl")}) db({A("cam_zh")}) db({A("cam_zl")}) '
        f'db({A("yaw")}) db({A("show_buf")}) db({A("den_arm")}) dw(${cut["cu_tl"]:04x})'
    )
    L = [f".logopen {log.as_posix()}",
         f"bp ${BOOT_JSR:04x}", "g", f"e ${BOOT_JSR:04x} ea ea ea",
         "e r:$ef40 " + " ".join(f"{b:02x}" for b in GAME_DL),
         "bc *"]
    if level != 1:
        # Travel to another map the way the ship does: set level_num before LoadLevel reads it.
        L += [f"bp {A('LoadLevel')}", "g", f"e {A('level_num')} {level:02x}", "bc *"]
    if level != 1 and not play:
        # Maps without a cutscene never reach the overlay, so stop at the card instead.
        L += [f"bp {A('hud_enter_rows')}", "g", state.replace("{tag}", "CARD"), ".printf \"END\"", ".logclose",
              f".writemem {done.as_posix()} $0000 L1"]
        return "\n".join(L) + "\n"
    L += [f'bx "pc=${cut["cut_run"]:04x} and {cond}"', "g", "bc *",
         state.replace("{tag}", "ENTRY"),
         f'.printf "SPAWN room=%d xyz=%d,%d,%d rot=%d" db($0415) db($0411) db($0412) db($0413) db($0414)',
         f'.printf "DATA nact=%d dur=%d room=%d" db(${cut["cut_data"] + 1:04x}) dw(${cut["cut_data"] + 2:04x}) db(${cut["cut_data"]:04x})']
    # One stop per sample time, on the first wait_draw_free at or past it (draw_world_prep is skipped by hideRoom) (the bitmap dumped is the
    # frame published just before, show_buf says which half).
    for i, t in enumerate(times):
        L += ["bc *", f'bx "pc={A("wait_draw_free")} and {cond} and dw(${cut["cu_tl"]:04x})>={t}"', "g",
              state.replace("{tag}", f"T{t}"),
              f".writemem {(OUT / f'f{i:02d}.bin').as_posix()} r:$4000 L2000"]
        if skip and i == 1:
            L += [f"e ${lab['in_fire']:04x} 01"]  # a fresh press after fire was seen released
            break
    L += ["bc *", f"bp {A('hud_enter_rows')}", "g", state.replace("{tag}", "CARD"),
          f".writemem {(OUT / 'card.bin').as_posix()} r:$4000 L2000",
          "bc *", f'bx "pc={A("draw_world_prep")} and {cond}"']
    for i in range(after):
        L += ["g", state.replace("{tag}", f"P{i}"),
              f".writemem {(OUT / f'p{i:02d}.bin').as_posix()} r:$4000 L2000"]
    L += [".printf \"END\"", ".logclose", f".writemem {done.as_posix()} $0000 L1"]
    return "\n".join(L) + "\n"


def render() -> None:
    from PIL import Image

    tones = [(0, 0, 0), (85, 85, 140), (170, 170, 220), (255, 255, 255)]
    files = sorted(OUT.glob("f*.bin")) + sorted(OUT.glob("card.bin")) + sorted(OUT.glob("p*.bin"))
    log = (OUT / "cut.log").read_text(errors="replace").splitlines() if (OUT / "cut.log").is_file() else []
    # One dump per T*/CARD/P* line, in file order f*, card, p*; show_buf says which bitmap was on screen.
    shows = [int(m.group(1)) for line in log if re.match(r"(T\d+|CARD|P\d+) ", line) and (m := re.search(r"show=(\d)", line))]
    for n, path in enumerate(files):
        data = path.read_bytes()
        # A 128-row, 32 B/row mode-E block is 4K; the dump holds A at 0 and B at 0x1000.
        show = shows[n] if n < len(shows) else 0
        buf = data[0x1000 * show : 0x1000 * show + 4096]
        img = Image.new("RGB", (128, 128))
        px = img.load()
        for y in range(128):
            for x in range(128):
                b = buf[y * 32 + 4 + x // 4] if 4 + x // 4 < 28 else 0
                px[x, y] = tones[(b >> (6 - 2 * (x % 4))) & 3]
        img.resize((384, 384), Image.NEAREST).save(OUT / (path.stem + ".png"))
    print(f"rendered {len(files)} frames into {OUT}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--times", default="0,600,1200,1800,2400,2900", help="cutscene sample times in ms")
    ap.add_argument("--after", type=int, default=2, help="normal-play frames to dump after the card")
    ap.add_argument("--level", type=int, default=1, help="level_num to arrive on (2 = MAPB: no cutscene, stops at the card)")
    ap.add_argument("--play", action="store_true", help="with --level: that map has a cutscene, run the full check on it")
    ap.add_argument("--skip", action="store_true", help="press fire after the second sample: the cutscene must end early")
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if a.render:
        render()
        return 0
    lab = labels(ROOT / "game.lbl")
    cut = labels(ROOT / "cutscn.lbl")
    log, done, bat = OUT / "cut.log", OUT / "done.bin", OUT / "cut.at"
    for f in OUT.glob("*.bin"):
        f.unlink()
    log.unlink(missing_ok=True)
    bat.write_text(script(lab, cut, [int(x) for x in a.times.split(",")], a.after, log, done, a.level, a.skip, a.play), encoding="ascii")
    cmd = (f'"{ALTIRRA}" /hardware:130XE /ntsc /nobasic /memsize:128K /w /debug'
           f' /debugcmd:".batch {bat}" /diskemu:1050 /disk "{ROOT / "nebula.atr"}"')
    print("Altirra window opening, leave it alone")
    proc = subprocess.Popen(cmd)
    t0 = time.time()
    try:
        while not done.exists():
            if proc.poll() is not None:
                raise SystemExit("Altirra exited before the script finished")
            if time.time() - t0 > a.timeout:
                raise SystemExit(f"timed out after {a.timeout}s (log so far: {log})")
            time.sleep(1)
        time.sleep(1)
    finally:
        proc.kill()
    print(log.read_text(errors="replace"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
