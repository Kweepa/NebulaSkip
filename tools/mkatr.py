"""Enhanced-density ATR: boot, 16-byte directory, CBM payloads."""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mapnames

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "nebula.atr"

SECTOR = 128
SECTORS = 1040
DIR_SEC = 20
DIR_SECS = 4
ENTRY = 16
# Quicksave slot: the last QSAVE_N sectors of the disk, outside the file area.
# src/mem.asm QSAVE_SEC / QSAVE_N must match (checked below).
QSAVE_N = 5
QSAVE_SEC = SECTORS - QSAVE_N + 1

# GAME is one ACME image with gaps (game.prg); it is cut into the four code
# segments by the labels nebula.asm emits. BANK0 is the image boot writes
# through the $4000 window into bank 0: the code zone at CODE0_BASE, the static
# data slice at STATIC_BASE, the QSAVE overlay at QS_OVL. BANK1 is the tab LUT
# source at TAB_STAGE (bank 1).
FILES = [
    ("EDATA", ROOT / "enemydata.prg", None),
    ("GAME", None, None),
    ("GAMEB", None, None),
    ("GAMEC", None, None),
    ("GAMED", None, None),
    ("SQT", ROOT / "sqt.prg", None),
    ("FNT", ROOT / "fnt.prg", 2 + 1024),
    ("BANK1", None, None),
    ("BANK0", None, None),
    ("MENU", ROOT / "menu.prg", None),
] + [(mapnames.key(l), mapnames.prg_path(l), None) for l in mapnames.map_letters()] + [
    ("POSS", ROOT / "enemies" / "poss.prg", None),
    ("BARON", ROOT / "enemies" / "baron.prg", None),
    ("PINKY", ROOT / "enemies" / "pinky.prg", None),
    ("IMP", ROOT / "enemies" / "imp.prg", None),
]


def read_labels(path: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0] == "al" and parts[2].startswith("."):
            out[parts[2][1:]] = int(parts[1].split(":")[1], 16)
    return out


def mem_const(mem: str, name: str) -> int:
    m = re.search(rf"^{name}\s*=\s*(\$[0-9a-fA-F]+|\d+)", mem, re.M)
    if not m:
        raise SystemExit(f"src/mem.asm: {name} not found")
    t = m.group(1)
    return int(t[1:], 16) if t.startswith("$") else int(t)


def prg(addr: int, data: bytes) -> bytes:
    return bytes([addr & 0xFF, addr >> 8]) + data


def game_blobs(mem_asm: str) -> dict[str, bytes]:
    raw = (ROOT / "game.prg").read_bytes()
    load = raw[0] | (raw[1] << 8)
    image = raw[2:]
    lbl = read_labels(ROOT / "game.lbl")

    def cut(lo: int, hi: int) -> bytes:
        if lo < load or hi - load > len(image) or hi < lo:
            raise SystemExit(f"game.prg does not cover ${lo:04X}-${hi:04X}")
        return image[lo - load : hi - load]

    seg_a = cut(0x0900, lbl["seg_a_end"])
    seg_b = cut(0x8000, lbl["seg_b_end"])
    seg_c = cut(0xC000, lbl["seg_c_end"])
    seg_d = cut(0xE000, lbl["seg_d_end"])
    static_base = mem_const(mem_asm, "STATIC_BASE")
    code0_base = mem_const(mem_asm, "CODE0_BASE")
    tab_stage = mem_const(mem_asm, "TAB_STAGE")
    qs_ovl = mem_const(mem_asm, "QS_OVL")
    static = cut(static_base, lbl["static_end"])
    code0 = cut(code0_base, lbl["code0_end"])

    tab = (ROOT / "tab.prg").read_bytes()[2:]
    qsave = (ROOT / "qsave.prg").read_bytes()
    if (qsave[0] | (qsave[1] << 8)) != qs_ovl:
        raise SystemExit("qsave.prg load address is not QS_OVL; rebuild it")
    qsave = qsave[2:]
    if len(tab) > 0x4000:
        raise SystemExit(f"tab.prg ({len(tab)} B) does not fit one bank window")
    bank = bytearray(qs_ovl + len(qsave) - code0_base)
    bank[0 : len(code0)] = code0
    bank[static_base - code0_base : static_base - code0_base + len(static)] = static
    bank[qs_ovl - code0_base :] = qsave
    return {
        "GAME": prg(0x0900, seg_a),
        "GAMEB": prg(0x8000, seg_b),
        "GAMEC": prg(0xC000, seg_c),
        "GAMED": prg(0xE000, seg_d),
        "BANK1": prg(tab_stage, tab),
        "BANK0": prg(code0_base, bytes(bank)),
    }


def main() -> None:
    boot_path = ROOT / "src" / "a8boot.bin"
    boot = bytearray(boot_path.read_bytes())
    if len(boot) < 6 or boot[2:4] != b"\x00\x04":
        raise SystemExit(f"bad boot image {boot_path} ({len(boot)} bytes)")
    nsec = math.ceil(len(boot) / SECTOR)
    if nsec >= DIR_SEC:
        raise SystemExit(f"boot is {nsec} sectors, directory starts at {DIR_SEC}")
    boot = boot.ljust(nsec * SECTOR, b"\x00")
    boot[1] = 1
    lbl = (ROOT / "src" / "a8boot.lbl").read_text(encoding="utf-8", errors="replace")
    mark = None
    for line in lbl.splitlines():
        if ".stage_nsec" in line:
            mark = int(line.split()[1].split(":")[1], 16)
            break
    if mark is None:
        raise SystemExit("stage_nsec missing from src/a8boot.lbl")
    boot[mark - 0x400] = nsec - 1

    mem_asm = (ROOT / "src" / "mem.asm").read_text(encoding="utf-8", errors="replace")
    built = game_blobs(mem_asm)
    blobs: list[tuple[str, bytes]] = []
    for name, path, cap in FILES:
        if len(name) > 8:
            raise SystemExit(f"name too long: {name}")
        if path is None:
            blobs.append((name, built[name]))
            continue
        if not path.is_file():
            raise SystemExit(f"missing {path}")
        data = path.read_bytes()
        if cap is not None:
            data = data[:cap]
        blobs.append((name, data))
    if len(blobs) > DIR_SECS * SECTOR // ENTRY - 1:
        raise SystemExit("directory overflow")

    data_sec = DIR_SEC + DIR_SECS
    directory = bytearray(DIR_SECS * SECTOR)
    cursor = data_sec
    payload = bytearray()
    for i, (name, data) in enumerate(blobs):
        off = i * ENTRY
        raw = name.encode("ascii")
        directory[off : off + len(raw)] = raw
        count = math.ceil(len(data) / SECTOR)
        directory[off + 8] = cursor & 0xFF
        directory[off + 9] = (cursor >> 8) & 0xFF
        directory[off + 10] = count & 0xFF
        directory[off + 11] = (count >> 8) & 0xFF
        directory[off + 12] = len(data) & 0xFF
        directory[off + 13] = (len(data) >> 8) & 0xFF
        payload += data
        pad = (-len(data)) % SECTOR
        payload += b"\x00" * pad
        cursor += count

    used = (cursor - 1)
    if used >= QSAVE_SEC:
        raise SystemExit(
            f"ATR overflow: files end at sector {used}, quicksave slot starts at {QSAVE_SEC}"
        )
    mem = (ROOT / "src" / "mem.asm").read_text(encoding="utf-8", errors="replace")
    for sym, want in (("QSAVE_SEC", QSAVE_SEC), ("QSAVE_N", QSAVE_N)):
        m = re.search(rf"^{sym}\s*=\s*(\d+)", mem, re.M)
        if not m or int(m.group(1)) != want:
            raise SystemExit(f"src/mem.asm {sym} must be {want}")

    image = bytearray(SECTORS * SECTOR)
    image[: len(boot)] = boot
    dir_off = (DIR_SEC - 1) * SECTOR
    image[dir_off : dir_off + len(directory)] = directory
    file_off = (data_sec - 1) * SECTOR
    image[file_off : file_off + len(payload)] = payload

    paras = (SECTORS * SECTOR) // 16
    header = bytearray(16)
    header[0] = 0x96
    header[1] = 0x02
    header[2] = paras & 0xFF
    header[3] = (paras >> 8) & 0xFF
    header[4] = SECTOR & 0xFF
    header[5] = (SECTOR >> 8) & 0xFF
    OUT.write_bytes(header + image)
    print(f"wrote {OUT}  boot={nsec} sectors  files={len(blobs)}  last={used}")


if __name__ == "__main__":
    main()
