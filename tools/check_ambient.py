#!/usr/bin/env python3
"""Run src/ambient.asm in py65 and compare its AUDF4 / AUDC4 writes per VBI
with the replica in genambient.py: every tune in the library, PAL and NTSC,
two loops and a bit, at full and reduced effects_vol. The tune sits where a
map would put it (bank-0 heap): every read of it must happen with PORTB =
PORTB_PLAY, and PORTB must be back at its old value after each call.

Usage: python tools/check_ambient.py   (ACME from %ACME% or C:\\app\\acme)
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import genambient as amb  # noqa: E402

ROOT = amb.ROOT
TMP = ROOT / "tmp"
ORG = 0x2000
TUNE_AT = 0x47F0                # crosses a page inside the bank window

WRAP = f"""\
!cpu 6502
!to "../tmp/ambient_test.bin", plain
effects_vol = $08fd
sample_ms = $08f0
map_tune = $0518
PORTB_PLAY = $e2
*= ${ORG:04x}
!source "ambient.asm"
"""


def main() -> None:
    TMP.mkdir(exist_ok=True)
    wrap = TMP / "ambient_test.asm"
    wrap.write_text(WRAP, encoding="ascii")
    acme = os.environ.get("ACME", r"C:\app\acme\acme.exe")
    lbl = TMP / "ambient_test.lbl"
    r = subprocess.run([acme, "--vicelabels", str(lbl), str(wrap)], cwd=ROOT / "src",
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stdout + r.stderr)
    labels = {}
    for line in lbl.read_text().splitlines():
        m = re.match(r"al C:([0-9a-fA-F]+) \.(\S+)", line)
        if m:
            labels[m.group(2)] = int(m.group(1), 16)
    code = (TMP / "ambient_test.bin").read_bytes()

    from py65.devices.mpu6502 import MPU

    class WMem(bytearray):
        def __init__(self, *a):
            super().__init__(*a)
            self.pokey = bytearray(16)

        def __setitem__(self, k, v):
            if isinstance(k, int) and 0xD200 <= k <= 0xD20F:
                self.pokey[k - 0xD200] = v
                if k not in (0xD206, 0xD207):
                    sys.exit(f"write to ${k:04x}: not channel 4")
            elif isinstance(k, int) and k < 0x100:
                sys.exit(f"zero page write ${k:02x}")
            bytearray.__setitem__(self, k, v)

        def __getitem__(self, k):
            if isinstance(k, int) and TUNE_AT <= k < 0x8000 and self.guard:
                if bytearray.__getitem__(self, 0xD301) != 0xE2:
                    sys.exit(f"tune read at ${k:04x} with PORTB ${bytearray.__getitem__(self, 0xD301):02x}")
            return bytearray.__getitem__(self, k)

    mem = WMem(65536)
    mem.guard = False
    mem[ORG:ORG + len(code)] = code
    m = MPU(memory=mem)

    def call(name: str, limit: int = 5000) -> int:
        mem[0x1FF] = 0xFE
        mem[0x1FE] = 0xFF
        m.sp = 0xFD
        m.pc = labels[name]
        mem[0xFEFF] = 0xEA
        mem[0xD301] = 0xFE
        mem.guard = True
        n = 0
        c0 = m.processorCycles
        while m.pc != 0xFF00:
            m.step()
            n += 1
            if n > limit:
                sys.exit(f"{name} hang")
        mem.guard = False
        if mem[0xD301] != 0xFE:
            sys.exit(f"{name} left PORTB at ${mem[0xD301]:02x}")
        return m.processorCycles - c0

    ok = True
    print(f"check_ambient: ambient.asm is {len(code)} bytes (code + state)")
    for k, t in enumerate(amb.TUNES):
        blob = amb.pack(t)
        for std, sname in ((0, "PAL"), (1, "NTSC")):
            for ev in (15, 9, 0):
                n = int(2.2 * amb.loop_ticks(t) * t[2] / amb.SAMPLE_MS[std])
                ref = amb.play(blob, std, n, ev)
                mem[TUNE_AT:TUNE_AT + len(blob)] = blob
                mem[0x0518] = TUNE_AT & 255
                mem[0x0519] = TUNE_AT >> 8
                mem[0x08FD] = ev
                mem[0x08F0] = amb.SAMPLE_MS[std]
                call("amb_init")
                worst = bad = 0
                for i, want in enumerate(ref):
                    worst = max(worst, call("amb_tick"))
                    got = (mem.pokey[6], mem.pokey[7])
                    if got != want:
                        bad += 1
                        if bad < 4:
                            print(f"  {t[0]} {sname} ev {ev} VBI {i}: got {got} want {want}")
                peak = max(a & 15 for _f, a in ref)
                print(f"check_ambient: {t[0]} {sname} vol {ev}: {n} VBIs, {bad} mismatches, "
                      f"peak vol {peak}, worst {worst} cycles")
                ok = ok and not bad and (ev or not peak)
    # A map without a tune (map_tune hi = 0) leaves the channel off.
    mem[0x0519] = 0
    call("amb_init")
    call("amb_tick")
    if mem[labels["amb_on"]] or mem.pokey[7]:
        print("check_ambient: a map with no tune did not stay silent")
        ok = False
    if not ok:
        sys.exit(1)
    print("check_ambient: ok")


if __name__ == "__main__":
    main()
