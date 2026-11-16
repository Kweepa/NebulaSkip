#!/usr/bin/env python3
"""Ambient tune library for POKEY channel 4 (player: src/ambient.asm).

One voice, AUDCTL 0 (64 kHz, 8-bit). Pure tone stays in C3..C#5 (dividers
within ~10 cents); poly4 only on dividers with gcd(n+1, 15) = 1, as in
tools/genmenutune.py (C1 D1 E1 F1 F#1 G#1 A1 A#1 C#2 D2 E2 F2 F#2 G#2 C#3 D3
E3 F#3).

A map picks a tune by name ("tune" in editor/maps/map<x>.json, set in the
editor's map inspector). tools/genmap.py packs that tune into the map
(map_block), so only the current map's tune is in memory. This script writes
the library for the editor (editor/js/tunesData.js: picker + preview player).

Tune bytes: tick_ms, dist|peak, atk, rel, rel_ticks, vib_delay, vib_speed,
vib_depth, glide, hold, then (AUDF, len) pairs. len 1..127 ticks, bit 7 = rest,
len 0 = loop. Level is 4.4 per VBI. Vibrato and glide move AUDF in divider
steps (src/ambient.asm): one step is about 8 cents at C3, 28 at C5.

Voicing: the envelope is the instrument. atk is level per VBI toward
peak * 16 (atk 2, peak 6 = 0.8 s swell); the vibrato triple is (delay VBIs,
VBIs per quarter cycle, depth in steps); glide = steps per VBI for a note
that starts while the last one still sounds. rel 0 is the slowest fall, one
level every other VBI (peak 5 to hold 2 in about 1.8 s). hold (volume 0..15) is the level
the voice falls to and stays at instead of going silent: the last note of a
group carries on quietly through the rest, and with glide set the next group
bends up or down from it. At effects volume v it sounds as hold * (v+1) / 16,
so hold 1 is only heard at full volume.

rel_ticks is how many ticks before its end a note starts to fall, and it only
matters between two notes (a rest releases anyway): 0 = legato, the level
holds across the change (what glide needs; repeated pitches merge), 1 = a dip
that re-articulates. The fall must not reach volume 0 before the next note,
and a note must be longer than rel_ticks or it never sounds; pack() checks
both. No vibrato on poly4: one step off a clean divider changes the pattern
(pitch jumps a twelfth or more, or the channel goes silent).

Score strings: "D3:4 A3 C4 E4:8 -:8". NAME[:ticks]; "-" is a rest; ticks
carry over from the previous token.

    python tools/genambient.py [--wav-dir tmp]
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import genpokey as g  # noqa: E402
import genmenutune as mt  # noqa: E402

ROOT = g.ROOT
OUT_JS = ROOT / "editor" / "js" / "tunesData.js"
SAMPLE_MS = (20, 17)            # PAL, NTSC (mem.asm SAMPLE_MS_*)
TUNE_MAX_BYTES = 1024           # per map; not counted against MAP_MAX_BYTES

TONE, POLY4 = 0xA0, 0xC0
R = None                        # rest

HDR = 10
NOVIB = (0, 1, 0)

# name, about, tick_ms, dist, peak 1..15, atk, rel, rel_ticks, (vib delay, speed, depth), glide, hold, score
TUNES = [
    ("Dockside", "D dorian, slow rising figures, long gaps", 250, TONE, 6, 3, 0, 0, (30, 8, 1), 2, 2, """
        D3:4 A3 C4 E4:8 -:8   D3:4 A3 B3 F4:8 -:8   C3:4 G3 B3 D4:8 -:8   G3:4 D4 E4 A3:12 -:12
        F3:4 C4 E4 A4:8 -:8   E3:4 B3 D4 G4:8 -:8   D3:4 A3 C4 F4:8 G4:4 E4:12 -:16
        D3:4 A3 C4 E4:8 -:8   D3:4 A3 B3 F4:8 -:8   C3:4 G3 B3 D4:8 -:8   G3:4 D4 E4 D4:4 D3:16 -:16
    """),
    ("Canopy", "A lydian, slow airy phrases over a held, bending tone", 240, TONE, 5, 2, 0, 0, (30, 8, 1), 2, 2, """
        A3:10 E4:14 -:8   C#4:8 B3:16 -:10   F#3:10 C#4:8 E4:16 -:8   D#4:8 C#4 A3:20 -:14
        E3:12 B3:10 F#4:16 -:8   E4:8 C#4:18 -:10   A3:10 E4:8 G#4:18 -:6   F#4:8 E4:22 -:16
    """),
    ("Deep Shaft", "poly4 drone: E, the semitone above, the tritone below", 200, POLY4, 5, 1, 0, 0, NOVIB, 0, 2, """
        E2:28 -:12 F2:20 -:8 E2:24 -:16 D2:20 -:8 A#1:28 -:20 E1:32 -:24
        E2:28 -:12 F#2:20 -:8 E2:24 -:16 D2:20 -:8 A1:28 -:20 E1:32 -:32
    """),
    ("Drift", "F# minor 9, wide arpeggio, gliding", 150, TONE, 5, 3, 0, 0, (30, 8, 1), 2, 2, """
        F#3:6 C#4 E4 G#4:12 -:6   A3:6 E4 G#4 C#4:12 -:6
        E3:6 B3 E4 F#4:12 -:6   C#3:6 G#3 C#4 E4:18 -:18
        D3:6 A3 C#4 F#4:12 -:6   E3:6 B3 D4 G#4:12 -:6
        F#3:6 C#4 E4 A4:12 -:6   G#4:6 E4 C#4 F#3:18 -:18
    """),
    ("Signal", "relay beacon: soft high pings, shimmering tails", 200, TONE, 6, 8, 0, 0, (30, 8, 1), 2, 2, """
        B4:1 -:7 F#4:1 -:11 B4:1 -:3 E4:1 -:15 A4:1 -:7 F#4:1 -:3 C#4:1 -:19 B4:1 -:1 C#5:1 -:21
        E4:1 -:7 B4:1 -:11 A4:1 -:3 F#4:1 -:15 C#5:1 -:3 B4:1 -:23 F#4:1 -:1 E4:1 -:25
    """),
    ("Night Watch", "E minor, low and slow, theremin-like", 220, TONE, 5, 3, 0, 0, (30, 8, 1), 2, 2, """
        E3:8 G3:4 B3 A3:8 F#3 -:8   E3:8 G3:4 B3 D4:8 B3:12 -:12
        C4:8 B3:4 A3 G3:8 F#3 -:8   E3:6 F#3 G3:4 E3:16 -:20
        G3:8 B3:4 D4 E4:8 D4 -:8   C4:8 A3:4 C4 B3:8 G3:12 -:12
        A3:8 G3:4 F#3 E3:8 D3 -:8   E3:6 G3 F#3:4 E3:20 -:24
    """),
    ("Cold Storage", "whole-tone, eerie, very sparse", 240, TONE, 5, 2, 0, 0, (30, 8, 1), 2, 2, """
        C4:10 -:6 F#4:10 -:10 E4:8 G#4 -:14   A#3:10 -:6 E4:10 -:10 D4:8 F#4 -:14
        G#3:12 -:4 D4:12 -:8 C4:6 A#3 F#3:16 -:24
    """),
    ("Outpost", "G mixolydian, low and sparse, held tones", 230, TONE, 5, 2, 0, 0, (30, 8, 1), 2, 2, """
        G3:16 -:8 D4:12 F4:16 -:16   G3:12 C4:10 B3:18 -:14
        F3:16 -:6 C4:12 D4:8 G3:24 -:20   D3:14 A3:10 F4:8 E4:16 D4:20 -:28
    """),
    ("Undertow", "poly4 bass ostinato, restless", 170, POLY4, 4, 8, 3, 1, NOVIB, 0, 2, """
        D2:3 D2 F2:2 D2:3 D2 E2:2 D2:3 D2 F2:2 F#2:4 E2
        D2:3 D2 F2:2 D2:3 D2 E2:2 D2:3 D2 F2:2 F#2:4 E2
        A#1:3 A#1 D2:2 A#1:3 A#1 F2:2 A1:6 A1:2 E2:4 D2:8 -:8
        D2:3 D2 F2:2 D2:3 D2 E2:2 D2:3 D2 F2:2 G#2:4 F#2 E2:8 D2:12 -:12
    """),
    ("Thin Air", "glassy high tones, wide gaps, unsettled", 220, TONE, 4, 3, 0, 0, (30, 8, 1), 2, 2, """
        C5:6 -:10 G4:8 -:14 E4:6 A4:10 -:18   B4:6 -:8 F4:10 -:12 G#4:6 E4:12 -:22
        A4:8 -:10 C5:6 F4:12 -:16 E4:8 C4:16 -:28
    """),
    ("Long Dark", "low minor-second drone, slow swells", 250, TONE, 5, 1, 0, 0, (30, 8, 1), 2, 2, """
        C3:20 -:4 C#3:16 -:8 C3:20 -:12 D#3:12 D3 C3:24 -:20
        G3:16 -:4 F#3:16 -:8 C3:28 -:24
    """),
    ("Harbor Lights", "F lydian, slow gliding arcs", 250, TONE, 5, 2, 0, 0, (30, 8, 1), 2, 2, """
        F3:12 C4 B3:16 -:12   A3:10 E4:14 -:10 G4:8 E4:18 -:16
        D3:12 A3:10 B3:8 F4:18 -:14   C3:14 G3:10 E4:20 -:24
    """),
]

NOTE_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")
SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def die(msg: str) -> None:
    print(f"genambient: {msg}", file=sys.stderr)
    sys.exit(1)


def parse_score(name: str, score: str):
    notes = []
    ln = None
    for tok in score.split():
        head, _, tail = tok.partition(":")
        if tail:
            ln = int(tail)
        if ln is None:
            die(f"{name}: {tok!r} has no length")
        if head == "-":
            notes.append((R, ln))
            continue
        m = NOTE_RE.match(head)
        if not m:
            die(f"{name}: bad note {tok!r}")
        midi = 12 * (int(m.group(3)) + 1) + SEMI[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]
        notes.append((midi, ln))
    return notes


def pack(tune) -> bytes:
    name, _about, tick_ms, dist, peak, atk, rel, relt, (vdelay, vspeed, vdep), glide, hold, score = tune
    if not max(SAMPLE_MS) <= tick_ms <= 255:
        die(f"{name}: tick_ms {tick_ms} out of range")     # one tick per VBI at most, 8-bit
    if not (1 <= peak <= 15 and 1 <= atk <= 255 and 0 <= rel <= 255 and 0 <= relt <= 126):
        die(f"{name}: bad envelope")
    if not (0 <= vdelay <= 255 and 1 <= vspeed <= 255 and 0 <= vdep <= 8 and 0 <= glide <= 255):
        die(f"{name}: bad vibrato / glide")
    if not 0 <= hold < peak:
        die(f"{name}: hold {hold} must be under peak {peak}")
    out = bytearray((tick_ms, dist | peak, atk, rel, relt, vdelay, vspeed, vdep, glide, hold << 4))
    for m, ln in parse_score(name, score):
        if not 1 <= ln <= 127:
            die(f"{name}: length {ln} out of range")
        if m is R:
            out += bytes((0, 0x80 | ln))
        elif dist == POLY4:
            out += bytes((mt.poly4_div(m), ln))
        else:
            if not 48 <= m <= 73:
                die(f"{name}: tone note {m} is outside C3..C#5")
            out += bytes((mt.tone_div(m), ln))
    out += bytes((0, 0))
    if dist == POLY4 and vdep:
        die(f"{name}: vibrato on poly4 leaves the clean dividers")
    for k in range(HDR, len(out) - 2, 2):
        if not out[k + 1] & 0x80 and not vdep <= out[k] <= 255 - vdep:
            die(f"{name}: divider {out[k]} +- vibrato {vdep} leaves 0..255")
    if len(out) > TUNE_MAX_BYTES:
        die(f"{name}: {len(out)} bytes (max {TUNE_MAX_BYTES})")
    check_levels(name, bytes(out))
    return bytes(out)


def check_levels(name: str, blob: bytes) -> None:
    """Every note is heard, and a note that runs into another note has not
    faded to volume 0 by then (PAL and NTSC)."""
    ticks = sum(blob[k + 1] & 0x7F for k in range(HDR, len(blob) - 2, 2))
    for std, ms in enumerate(SAMPLE_MS):
        at = []
        vbis = play(blob, std, ticks * blob[0] // ms + 2, at=at)
        k = 0
        while k < len(at) and at[k] == HDR:     # before the first fetch
            k += 1
        while k < len(at):
            j = k
            while j < len(at) and at[j] == at[k]:
                j += 1
            cur = at[k] - 2                     # the pair being played
            if not blob[cur + 1] & 0x80:
                vols = [v & 15 for _f, v in vbis[k:j]]
                nxt = at[k] if blob[at[k] + 1] else HDR
                what = f"{name}: note {(cur - HDR) // 2 + 1} ({('PAL', 'NTSC')[std]})"
                if not max(vols):
                    die(f"{what} is silent (shorter than rel_ticks, or attack too slow)")
                if j < len(at) and not blob[nxt + 1] & 0x80 and not vols[-1]:
                    die(f"{what} fades to 0 before the next note (rel * rel_ticks too large)")
            k = j


def tune_names() -> list[str]:
    return [t[0] for t in TUNES]


def map_block(name: str | None, map_key: str = "") -> bytes:
    """Tune block for a packed map: length word (counting itself), then the
    tune bytes. No tune = just the word (2)."""
    name = (name or "").strip()
    blob = b""
    if name:
        for t in TUNES:
            if t[0].lower() == name.lower():
                blob = pack(t)
                break
        else:
            die(f"{map_key}: unknown tune {name!r} (have: {', '.join(tune_names())})")
    return struct.pack("<H", len(blob) + 2) + blob


def play(blob: bytes, std: int, nvbi: int, effects_vol: int = 15, at: list | None = None):
    """Replica of amb_init + nvbi calls of amb_tick: [(AUDF4, AUDC4)].
    at, when given, gets the read offset per VBI (which pair is playing)."""
    tick_ms, dp, atk, rel, relt, vdelay, vspeed, vdep, glide, hold = blob[:HDR]
    dist, peak = dp & 0xF0, (dp << 4) & 0xFF
    start = rd = HDR
    acc = lvl = gate = f = tgt = vt = vc = vph = half = 0
    left = 1
    ms = SAMPLE_MS[std]
    out = []
    for _ in range(nvbi):
        acc += ms
        if acc >= tick_ms:
            acc -= tick_ms
            left = (left - 1) & 255
            if left == 0:
                while True:
                    a, ln = blob[rd], blob[rd + 1]
                    rd += 2
                    if ln:
                        break
                    rd = start
                if ln & 0x80:
                    left, gate = ln & 0x7F, 0
                else:
                    left, tgt, gate = ln, a, 1
                    if not glide or not lvl:
                        f = a
                    vt = vc = vph = 0
        if gate and relt < left:
            lvl = min(lvl + atk, peak)
        elif lvl > hold:                    # under it only before the first note
            if rel:
                lvl = max(lvl - rel, hold)
            else:                           # rel 0: one level every other VBI
                half += 1
                lvl -= half & 1
        v = lvl >> 4
        if effects_vol & 15 != 15:
            v = (v * ((effects_vol & 15) + 1)) >> 4
        if f > tgt:
            f = max(f - glide, tgt)
        elif f < tgt:
            f = min(f + glide, tgt)
        off = 0
        if vdep:
            if vt < vdelay:
                vt += 1
            else:
                vc += 1
                if vc >= vspeed:
                    vc = 0
                    vph = (vph + 1) & 255
                off = (0, vdep, 0, -vdep)[vph & 3]
        out.append(((f + off) & 255, v | dist))     # before the first note f is 0 (volume 0 too)
        if at is not None:
            at.append(rd)
    return out


def loop_ticks(tune) -> int:
    return sum(ln for _m, ln in parse_score(tune[0], tune[-1]))


def loop_secs(tune) -> float:
    return loop_ticks(tune) * tune[2] / 1000.0


def render_wav(path: Path, vbis, std: int = 0, rate: int = 44100) -> None:
    vbi_hz = g.VBI_HZ[std]
    ph, idx, t_acc = 0.0, 0, 0.0
    out = bytearray()
    for f, audc in vbis:
        div_hz = g.POKEY_64K / (f + 1)
        vol, dist = audc & 15, audc & 0xE0
        t_acc += rate / vbi_hz
        ns = int(t_acc)
        t_acc -= ns
        for _ in range(ns):
            ph += div_hz / rate
            k = int(ph)
            ph -= k
            if dist == TONE:
                idx = (idx + k) & 1
                bit = idx
            else:
                idx = (idx + k) % 15
                bit = mt.POLY4[idx]
            out += struct.pack("<h", int(vol * (bit - 0.5) * 2000))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(out))


JS_TAIL = """
export function tuneByName(name) {
  const key = String(name ?? "").trim().toLowerCase();
  return key ? TUNES.find((t) => t.name.toLowerCase() === key) || null : null;
}

/** Bytes a map spends on its tune block: length word + tune (2 with no tune). */
export function tuneBytes(name) {
  const t = tuneByName(name);
  return 2 + (t ? t.data.length : 0);
}
"""


def build(args) -> None:
    blobs = [pack(t) for t in TUNES]
    if len(set(n.lower() for n in tune_names())) != len(TUNES):
        die("duplicate tune name")
    for t, b in zip(TUNES, blobs):
        print(f"genambient: {t[0]}: {len(b)} bytes, loop {loop_secs(t):.1f} s")

    if args.wav_dir:
        for t, b in zip(TUNES, blobs):
            n = int(loop_ticks(t) * t[2] / SAMPLE_MS[0])
            p = args.wav_dir / ("amb_" + t[0].lower().replace(" ", "_") + ".wav")
            render_wav(p, play(b, 0, n))
            print(f"genambient: wrote {p}")

    rows = []
    for t, b in zip(TUNES, blobs):
        rows.append("  { name: %s, about: %s, secs: %d, data: [%s] }," % (
            json.dumps(t[0]), json.dumps(t[1]), round(loop_secs(t)), ",".join(str(x) for x in b)))
    js = ("// Generated by tools/genambient.py. Do not edit.\n"
          "// Ambient tune library: data = the bytes the game plays (format in src/ambient.asm).\n"
          f"export const TUNE_MAX_BYTES = {TUNE_MAX_BYTES};\n"
          "export const TUNES = [\n" + "\n".join(rows) + "\n];\n" + JS_TAIL)
    args.out.write_text(js, encoding="utf-8", newline="\n")
    print(f"genambient: {len(TUNES)} tunes, {sum(len(b) for b in blobs)} bytes in all, "
          f"wrote {args.out.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT_JS)
    ap.add_argument("--wav-dir", type=Path, help="also render PAL previews (one loop each)")
    build(ap.parse_args())


if __name__ == "__main__":
    main()
