#!/usr/bin/env python3
"""Menu music for the Atari port: the jukebox tunes, composed here (no SID).

Same player and stream format as tools/genpokey.py (src/a8music.asm). Each
tune is three voices:

    pair (ch1+2, 16-bit @1.79 MHz, pure tone)
    ch3  (8-bit @64 kHz)
    ch4  (8-bit @64 kHz)

ch3 pure tone stays in C3..C5 (within ~10 cents at 64 kHz). Poly4 bass on
ch4 uses only dividers with gcd(n+1, 15) = 1: other dividers shorten the
sampled poly4 cycle and play off-pitch.

Tunes (jukebox order):
    1 Low Orbit   96 BPM swung, D minor. Bass / arp+lead / drums.
    2 Cryosleep   70 BPM, F# minor. Gliding vibrato lead / echo arp / sub bass.
    3 Far Relay   84 BPM swung, E minor. Bass / echo arp+lead / drums+pings.
    4 Duty Free   92 BPM 12/8 shuffle, G minor. Sliding bass / rolled chords+lead /
                  drums, toms, pings.

Writes music/menu_tunes.asm: shared envelope rate tables, per-track rate,
AUDCTL, envelope offset and token pointer, the token streams, and the
jukebox strings (str_trkN, str_nowN, juke_now_lo/hi).

    python tools/genmenutune.py [--wav-dir tmp]
"""

from __future__ import annotations

import argparse
import math
import random
import struct
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import genpokey as g  # noqa: E402

ROOT = g.ROOT
OUT_ASM = ROOT / "music" / "menu_tunes.asm"
INST_BYTES_MAX = 256    # all tracks' (AD, SR) pairs share one table, offset in Y
CLK = g.POKEY_64K

CLS_TONE, CLS_POLY4, CLS_NOISE, CLS_OFF = 0, 1, 2, 3


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12.0)


def pair_div(midi: float) -> int:
    return max(0, min(65535, round(g.POKEY_179 / (2.0 * hz(midi)) - 7)))


def tone_div(midi: int) -> int:
    n = round(CLK / (2.0 * hz(midi))) - 1
    if not 0 <= n <= 255:
        g.die(f"8-bit tone note {midi} out of range")
    return n


def poly4_div(midi: int) -> int:
    f = hz(midi)
    best = None
    n0 = round(CLK / (15.0 * f))
    for n in (n0 - 1, n0, n0 + 1):
        if 1 <= n <= 256 and math.gcd(n, 15) == 1:
            e = abs(1200.0 * math.log2(CLK / (15.0 * n) / f))
            if best is None or e < best[0]:
                best = (e, n - 1)
    if best is None or best[0] > 16:
        g.die(f"poly4 note {midi} has no clean divider")
    return best[1]


# --------------------------------------------------------------------------
# Voices and song timing
# --------------------------------------------------------------------------

class Voice:
    """Per-tick register state. Later writes win."""

    def __init__(self, n: int) -> None:
        self.f = [None] * n          # divider (None = hold)
        self.on = [None] * n         # (cls, inst) note start, retrig
        self.off = [False] * n       # gate off here
        self.n = n

    def freq(self, t0: int, fs) -> None:
        for k, v in enumerate(fs if isinstance(fs, list) else [fs]):
            if 0 <= t0 + k < self.n:
                self.f[t0 + k] = v

    def note(self, t0: int, t1: int, f, cls: int, inst: int) -> None:
        """Gate on at t0 (retrigger), off at t1. f = divider or per-tick list."""
        if t0 >= self.n:
            return
        self.on[t0] = (cls, inst)
        self.off[t0] = False
        self.freq(t0, f)
        if t1 < self.n:
            self.off[t1] = True

    def columns(self):
        f = 0
        cls, inst, gate = CLS_OFF, 0, 0
        for t in range(self.n):
            rt = 0
            if self.f[t] is not None:
                f = self.f[t]
            if self.off[t]:
                gate = 0
            if self.on[t]:
                cls, inst = self.on[t]
                gate = 1
                rt = 1
            yield f, rt << 7 | gate << 6 | cls << 4 | inst


class Song:
    def __init__(self, name: str, bpm: int, t8: int, swing: int, inst, intro_bars: int,
                 loop_bars: int) -> None:
        self.name = name
        self.bpm = bpm
        self.t8 = t8                  # ticks per 8th
        self.swing = swing            # ticks on the even 16th
        self.inst = inst
        self.intro_bars = intro_bars
        self.loop_bars = loop_bars
        self.tick_hz = bpm * 2 * t8 / 60.0
        self.bar = 8 * t8
        n = (intro_bars + loop_bars) * self.bar
        self.n = n
        self.v = [Voice(n), Voice(n), Voice(n)]   # pair, ch3, ch4
        if len(inst) > 16:
            g.die(f"{name}: {len(inst)} envelopes (max 16)")

    def t(self, bar: int, step: int) -> int:
        bar += step // 16
        step %= 16
        return bar * self.bar + (step // 2) * self.t8 + (step & 1) * self.swing

    def columns(self):
        cols = []
        for (fp, ep), (f3, e3), (f4, e4) in zip(*(v.columns() for v in self.v)):
            cols.append((fp & 255, fp >> 8, f3, f4, ep, e3, e4))
        return cols, self.intro_bars * self.bar, self.loop_bars * self.bar


# --------------------------------------------------------------------------
# Shared phrase helpers
# --------------------------------------------------------------------------

def drum_hits(s: Song, v: Voice, bar: int, pat: str, kit: dict) -> None:
    """pat: one char per 16th. kit[c] = (cls, f or list, inst, gate ticks)."""
    for st, c in enumerate(pat):
        if c in kit:
            cls, f, inst, gt = kit[c]
            t0 = s.t(bar, st)
            v.note(t0, t0 + gt, list(f) if isinstance(f, list) else f, cls, inst)


def bass_bar(s: Song, v: Voice, bar: int, root: int, pat, inst: int, gap: int = 2,
             div=pair_div, cls: int = CLS_TONE) -> None:
    for st, iv, ln in pat:
        t0 = s.t(bar, st)
        v.note(t0, s.t(bar, st + ln) - gap, div(root + iv), cls, inst)


def echo_arp(s: Song, v: Voice, bars, steps_per_note: int, delay: int, main, echo,
             main_gate: int, echo_gate: int) -> None:
    """bars: list of (bar, voicing, pattern of voicing indices per main note).
    Main notes every `steps_per_note` 16ths; an echo of each `delay` 16ths later
    (delay odd, so echoes fall between main notes). main / echo = inst."""
    seq = []
    for bar, tones, pat in bars:
        for k, i in enumerate(pat):
            if i is not None:
                seq.append((bar, k * steps_per_note, tones[i]))
    for bar, st, m in seq:
        t0 = s.t(bar, st)
        v.note(t0, t0 + main_gate, tone_div(m), CLS_TONE, main)
    own = {b for b, _t, _p in bars}
    for bar, st, m in seq:
        if bar + (st + delay) // 16 not in own:
            continue                    # never echo into another part's bar
        t0 = s.t(bar, st + delay)
        if t0 < s.n and v.on[t0] is None:
            v.note(t0, t0 + echo_gate, tone_div(m), CLS_TONE, echo)


# --------------------------------------------------------------------------
# 1  Low Orbit
# --------------------------------------------------------------------------

def low_orbit() -> Song:
    s = Song("Low Orbit", 96, 12, 7, [
        (0x0A, 0xA6),   # 0 bass: hits, settles at 10, short tail
        (0x36, 0x04),   # 1 arp pluck
        (0x8A, 0xB9),   # 2 lead swell
        (0x07, 0x07),   # 3 kick body
        (0x07, 0x06),   # 4 snare
        (0x01, 0x01),   # 5 closed hat
        (0x04, 0x04),   # 6 open hat
    ], 2, 24)
    bs, mel, dr = s.v
    CH = {
        "Dm9":  (38, (50, 57, 60, 64, 65)),
        "Bb7":  (34, (53, 57, 58, 62, 65)),
        "Gm9":  (31, (55, 58, 62, 65, 69)),
        "Asus": (33, (52, 55, 57, 62, 64)),
        "A7":   (33, (52, 55, 57, 61, 64)),
        "C6":   (36, (48, 55, 57, 60, 64)),
    }
    PROG_A = ["Dm9", "Dm9", "Bb7", "Bb7", "Gm9", "Gm9", "Asus", "A7"]
    PROG_B = ["Bb7", "C6", "Dm9", "Dm9", "Gm9", "Bb7", "Asus", "A7"]
    ARP_A = [0, 2, 4, 1, 3, 2, None, 1, 0, 2, 4, 1, 3, 4, 2, None]
    ARP_A2 = [4, 2, 0, 3, 1, None, 2, 4, 3, 1, 4, 2, None, 0, 3, 1]
    BASS_1 = [(0, 0, 3), (3, 0, 1), (6, 12, 2), (10, 0, 1), (11, 7, 2), (14, 12, 1)]
    BASS_2 = [(0, 0, 3), (3, 0, 1), (6, 12, 1), (8, 7, 2), (11, 0, 1), (12, 12, 2), (15, 7, 1)]
    BASS_B = [(0, 0, 6), (6, 12, 2), (10, 0, 2), (14, 7, 2)]
    DR_1 = "K.h...h.S.Kh..h."
    DR_2 = "K.h...hKS..h.Kh."
    DR_FILL = "K.h...h.S.S.SSSS"
    DR_3 = "K.hh..hhS.Kh.hho"
    DR_4 = "K.hh..hKS.hh.Kho"
    KIT = {
        "K": (CLS_POLY4, [20, 34, 60, 110, 200, 255], 3, 3),
        "S": (CLS_NOISE, 0x0E, 4, 1),
        "h": (CLS_NOISE, 0x00, 5, 1),
        "o": (CLS_NOISE, 0x01, 6, 3),
    }
    LEAD = [
        [(0, 62, 6), (6, 65, 4), (10, 69, 6)],
        [(0, 67, 8), (8, 64, 4), (12, 60, 4)],
        [(0, 62, 12), (12, 64, 2), (14, 65, 2)],
        [(0, 64, 10)],
        [(0, 62, 4), (4, 65, 4), (8, 67, 8)],
        [(0, 65, 6), (6, 69, 10)],
        [(0, 62, 8), (8, 64, 8)],
        [(0, 61, 12)],
    ]

    def arp(bar, chord, pat, oct_up_last=False):
        tones = CH[chord][1]
        for st, i in enumerate(pat):
            if i is None:
                continue
            m = tones[i]
            if oct_up_last and st == 15 and m + 12 <= 69:
                m += 12
            t0 = s.t(bar, st)
            mel.note(t0, t0 + 3, tone_div(m), CLS_TONE, 1)

    def lead(bar, phrase):
        for st, m, ln in phrase:
            t0 = s.t(bar, st)
            mel.note(t0, s.t(bar, st + ln) - 1, tone_div(m), CLS_TONE, 2)

    arp(0, "Dm9", ARP_A)
    arp(1, "Dm9", ARP_A, oct_up_last=True)
    drum_hits(s, dr, 1, "............h.hh", KIT)
    b0 = s.intro_bars
    for k, ch in enumerate(PROG_A):
        bar = b0 + k
        arp(bar, ch, ARP_A, oct_up_last=k % 2 == 1)
        bass_bar(s, bs, bar, CH[ch][0], BASS_1 if k % 2 == 0 else BASS_2, 0)
        drum_hits(s, dr, bar, DR_FILL if k == 7 else (DR_1 if k % 2 == 0 else DR_2), KIT)
    for k, ch in enumerate(PROG_B):
        bar = b0 + 8 + k
        lead(bar, LEAD[k])
        bass_bar(s, bs, bar, CH[ch][0], BASS_B if k < 7 else BASS_2, 0)
        drum_hits(s, dr, bar, DR_FILL if k == 7 else DR_1, KIT)
    for k, ch in enumerate(PROG_A):
        bar = b0 + 16 + k
        arp(bar, ch, ARP_A2 if k < 6 else ARP_A, oct_up_last=k % 2 == 1)
        bass_bar(s, bs, bar, CH[ch][0], BASS_1 if k % 2 == 0 else BASS_2, 0)
        drum_hits(s, dr, bar, DR_FILL if k == 7 else (DR_3 if k % 2 == 0 else DR_4), KIT)
    return s


# --------------------------------------------------------------------------
# 2  Cryosleep
# --------------------------------------------------------------------------

VIB = [0.0, 0.38, 0.71, 0.92, 1.0, 0.92, 0.71, 0.38,
       0.0, -0.38, -0.71, -0.92, -1.0, -0.92, -0.71, -0.38]


def glide_lead(s: Song, v: Voice, notes, inst: int, end_tick: int, glide: int = 8,
               vib_delay: int = 18, depth: float = 0.16, vib_step: int = 2) -> None:
    """Theremin line on the pair. notes: (bar, step, midi, len 16ths, legato).
    Legato notes glide from the previous pitch without a retrigger. Vibrato
    fades in after vib_delay ticks; the pitch is updated every vib_step ticks."""
    starts = [s.t(b, st) for b, st, _m, _ln, _lg in notes] + [end_tick]
    prev = None
    for i, (b, st, m, ln, leg) in enumerate(notes):
        t0 = starts[i]
        t1 = s.t(b, st + ln) - 1
        span = starts[i + 1] - t0
        fs = []
        for k in range(span):
            p = m
            if leg and prev is not None and k < glide:
                x = k / glide
                p = prev + (m - prev) * (x * x * (3 - 2 * x))
            if k >= vib_delay:
                ramp = min(1.0, (k - vib_delay) / 24.0)
                p += depth * ramp * VIB[((k - vib_delay) // vib_step) % len(VIB)]
            fs.append(pair_div(p) if k % vib_step == 0 or k < glide else None)
        for k, f in enumerate(fs):
            if f is not None and t0 + k < v.n:
                v.f[t0 + k] = f
        if leg and prev is not None:
            v.off[t0] = False
        else:
            v.on[t0] = (CLS_TONE, inst)
        if t1 < starts[i + 1] and t1 < v.n:
            nxt_leg = i + 1 < len(notes) and notes[i + 1][4]
            if not nxt_leg:
                v.off[t1] = True
        prev = m


def cryosleep() -> Song:
    s = Song("Cryosleep", 70, 16, 8, [
        (0x98, 0xA9),   # 0 lead: slow swell, sustain 10, long tail
        (0x65, 0x05),   # 1 arp: soft rise, gate cut mid-attack
        (0x84, 0x05),   # 2 echo: slower rise, gate cut early = quieter
        (0x5A, 0x77),   # 3 sub bass (poly4): swell to 7
    ], 2, 16)
    lead, arp, bass = s.v

    # Voicings for ch3 (C3..A4), bass roots for poly4 (clean dividers only).
    CH = {
        "F#m9":  (42, 37, (54, 57, 61, 64, 68)),   # F#2 / C#2 | F#3 A3 C#4 E4 G#4
        "Dmaj7": (38, 33, (54, 57, 61, 62, 64)),   # D2 / A1   | F#3 A3 C#4 D4 E4
        "Amaj7": (33, 40, (52, 56, 57, 61, 64)),   # A1 / E2   | E3 G#3 A3 C#4 E4
        "E6":    (40, 28, (52, 56, 59, 61, 66)),   # E2 / E1   | E3 G#3 B3 C#4 F#4
        "C#m7":  (37, 32, (52, 56, 59, 61, 64)),   # C#2 / G#1 | E3 G#3 B3 C#4 E4
    }
    PROG_A = ["F#m9", "F#m9", "Dmaj7", "Dmaj7", "Amaj7", "Amaj7", "E6", "E6"]
    PROG_B = ["Dmaj7", "Dmaj7", "Amaj7", "Amaj7", "C#m7", "C#m7", "E6", "E6"]
    PAT_1 = [0, 2, 4, 3, 1, 3, 4, 2]
    PAT_2 = [4, 2, 3, 1, 2, 0, 1, 3]
    PAT_3 = [0, 1, 2, 4, 3, 2, 1, None]

    bars = []
    bars.append((0, CH["F#m9"][2], PAT_1))
    bars.append((1, CH["F#m9"][2], PAT_3))
    b0 = s.intro_bars
    for k, ch in enumerate(PROG_A):
        bars.append((b0 + k, CH[ch][2], PAT_1 if k % 2 == 0 else PAT_2))
    for k, ch in enumerate(PROG_B):
        bars.append((b0 + 8 + k, CH[ch][2], PAT_2 if k % 2 == 0 else PAT_1))
    # 8ths, echo a dotted 8th later (3 16ths): main / echo alternate on 16ths.
    echo_arp(s, arp, bars, 2, 3, 1, 2, 2, 2)

    # Sub bass: root swell, fifth / octave answer.
    def bass_2bars(bar, ch, last=False):
        root, fifth, _ = CH[ch]
        bass_bar(s, bass, bar, root, [(0, 0, 14)], 3, 3, poly4_div, CLS_POLY4)
        bass_bar(s, bass, bar + 1, root, [(0, 0, 8)], 3, 3, poly4_div, CLS_POLY4)
        f = [(8, fifth - root, 6 if not last else 8)]
        bass_bar(s, bass, bar + 1, root, f, 3, 3, poly4_div, CLS_POLY4)

    bass_bar(s, bass, 1, CH["F#m9"][0], [(8, 0, 8)], 3, 3, poly4_div, CLS_POLY4)
    for k in range(0, 8, 2):
        bass_2bars(b0 + k, PROG_A[k])
        bass_2bars(b0 + 8 + k, PROG_B[k], last=k == 6)

    # Lead: enters on the third bar of A; B climbs an octave.
    A, B = b0, b0 + 8
    notes = [
        (A + 2, 0, 73, 12, False), (A + 2, 12, 71, 4, True),
        (A + 3, 0, 69, 14, True),
        (A + 4, 0, 76, 8, False), (A + 4, 8, 73, 8, True),
        (A + 5, 0, 71, 12, True), (A + 5, 12, 73, 4, True),
        (A + 6, 0, 68, 16, False),
        (A + 7, 0, 71, 8, True), (A + 7, 8, 68, 6, True),
        (B + 0, 0, 78, 12, False), (B + 0, 12, 76, 4, True),
        (B + 1, 0, 73, 14, True),
        (B + 2, 0, 76, 8, False), (B + 2, 8, 80, 8, True),
        (B + 3, 0, 81, 14, True),
        (B + 4, 0, 80, 8, False), (B + 4, 8, 76, 8, True),
        (B + 5, 0, 71, 14, True),
        (B + 6, 0, 73, 8, False), (B + 6, 8, 71, 4, True), (B + 6, 12, 68, 4, True),
        (B + 7, 0, 66, 12, True),
    ]
    glide_lead(s, lead, notes, 0, s.n)
    return s


# --------------------------------------------------------------------------
# 3  Far Relay
# --------------------------------------------------------------------------

def far_relay() -> Song:
    s = Song("Far Relay", 84, 14, 8, [
        (0x0A, 0x96),   # 0 bass: hits, settles at 9
        (0x65, 0x05),   # 1 arp: soft rise
        (0x84, 0x05),   # 2 echo
        (0x29, 0x48),   # 3 lead: keys, settles at 4
        (0x07, 0x07),   # 4 kick
        (0x05, 0x05),   # 5 rim
        (0x01, 0x01),   # 6 shaker
        (0x0A, 0x0A),   # 7 ping: long fade
    ], 2, 20)
    bass, mel, dr = s.v

    CH = {
        "Em9":   (40, (52, 55, 59, 62, 66)),   # E2  | E3 G3 B3 D4 F#4
        "Cmaj7": (36, (52, 55, 59, 60, 64)),   # C2  | E3 G3 B3 C4 E4
        "Am9":   (33, (57, 59, 60, 64, 67)),   # A1  | A3 B3 C4 E4 G4
        "Bm7":   (35, (54, 59, 62, 66, 69)),   # B1  | F#3 B3 D4 F#4 A4
    }
    PROG = ["Em9", "Cmaj7", "Am9", "Bm7"] * 2
    BASS_1 = [(0, 0, 4), (6, 0, 1), (7, 12, 2), (11, 7, 2), (14, 0, 1)]
    BASS_2 = [(0, 0, 3), (3, 12, 1), (6, 0, 2), (10, 7, 1), (12, 7, 2), (14, 12, 1)]
    BASS_LONG = [(0, 0, 12), (12, 7, 4)]
    KIT = {
        "K": (CLS_POLY4, [22, 40, 75, 140, 255], 4, 2),
        "R": (CLS_NOISE, 0x06, 5, 1),
        "s": (CLS_NOISE, 0x00, 6, 1),
        "P": (CLS_TONE, tone_div(78), 7, 1),     # F#5 ping
        "p": (CLS_TONE, tone_div(71), 7, 1),     # B4 ping
    }
    DR_1 = "K.s...sKR.s...s."
    DR_2 = "K.s...s.R.s..Ks."
    DR_3 = "K.s...sKR.s.s.ss"
    DR_PING = "K.s...s.P......."
    LEAD = [
        [(0, 71, 6), (6, 69, 2), (8, 67, 8)],
        [(0, 64, 10), (10, 67, 2), (12, 71, 4)],
        [(0, 72, 6), (6, 71, 2), (8, 69, 8)],
        [(0, 66, 12), (12, 69, 2), (14, 66, 2)],
        [(0, 67, 4), (4, 66, 4), (8, 64, 8)],
        [(0, 59, 6), (6, 60, 2), (8, 64, 8)],
        [(0, 67, 8), (8, 69, 4), (12, 71, 4)],
        [(0, 66, 16)],
    ]
    PAT_1 = [0, 2, 4, 1, 3, 2, 4, 1]
    PAT_2 = [4, 3, 1, 2, 0, 2, 3, 1]

    b0 = s.intro_bars
    A, B, C = b0, b0 + 8, b0 + 16

    # Intro: pings and the arp fading in.
    drum_hits(s, dr, 0, "P.......p.......", KIT)
    drum_hits(s, dr, 1, "P...........s.ss", KIT)
    bars = [(0, CH["Em9"][1], [None, None, None, None, 0, 2, 4, 1]),
            (1, CH["Em9"][1], PAT_1)]
    # A: echo arp, bass, drums with a ping every fourth bar.
    for k, ch in enumerate(PROG):
        bar = A + k
        bars.append((bar, CH[ch][1], PAT_1 if k < 4 else PAT_2))
        bass_bar(s, bass, bar, CH[ch][0], BASS_1 if k % 2 == 0 else BASS_2, 0)
        drum_hits(s, dr, bar, DR_PING if k == 3 else (DR_3 if k == 7 else
                                                     (DR_1 if k % 2 == 0 else DR_2)), KIT)
    # C: breakdown, arp over long bass, pings only.
    for k, ch in enumerate(["Cmaj7", "Am9", "Bm7", "Bm7"]):
        bar = C + k
        bars.append((bar, CH[ch][1], PAT_2 if k % 2 else PAT_1))
        bass_bar(s, bass, bar, CH[ch][0], BASS_LONG, 0)
        drum_hits(s, dr, bar, "P.......p......." if k < 3 else "P.......K.s.s.ss", KIT)
    echo_arp(s, mel, bars, 2, 3, 1, 2, 2, 2)

    # B: keys lead on ch3, drums carry on.
    for k, ch in enumerate(PROG):
        bar = B + k
        for st, m, ln in LEAD[k]:
            t0 = s.t(bar, st)
            mel.note(t0, s.t(bar, st + ln) - 2, tone_div(m), CLS_TONE, 3)
        bass_bar(s, bass, bar, CH[ch][0], BASS_1 if k % 2 == 0 else BASS_2, 0)
        drum_hits(s, dr, bar, DR_PING if k == 3 else (DR_3 if k == 7 else
                                                     (DR_1 if k % 2 == 0 else DR_2)), KIT)
    return s


# --------------------------------------------------------------------------
# 4  Duty Free
# --------------------------------------------------------------------------

class Shuffle(Song):
    """12/8: four beats of three steps (triplet 8ths), 12 steps a bar."""

    def __init__(self, name: str, bpm: int, t8: int, inst, intro_bars: int,
                 loop_bars: int) -> None:
        if 2 * t8 % 3:
            g.die(f"{name}: beat of {2 * t8} ticks does not split in three")
        super().__init__(name, bpm, t8, 0, inst, intro_bars, loop_bars)
        self.step = 2 * t8 // 3

    def t(self, bar: int, step: int) -> int:
        return bar * self.bar + step * self.step


def duty_free() -> Song:
    BASS, LONG, STRUM, E1, E2, LEAD, KICK, RIM, HAT, PING, OHAT = range(11)
    s = Shuffle("Duty Free", 92, 12, [
        (0x0A, 0x96),   # 0 bass: hits, settles at 9
        (0x3A, 0xA8),   # 1 long bass (breakdown): soft edge, slow tail
        (0x09, 0x65),   # 2 strum: rings down to 6 under the roll
        (0x65, 0x05),   # 3 echo 1 / arp: soft rise, gate cut mid-attack
        (0x84, 0x05),   # 4 echo 2 / arp echo: quieter still
        (0x19, 0xA7),   # 5 lead: plucked, settles at 10
        (0x07, 0x07),   # 6 kick, toms
        (0x05, 0x05),   # 7 rim
        (0x01, 0x01),   # 8 hat
        (0x0A, 0x0A),   # 9 ping: long fade
        (0x04, 0x04),   # 10 open hat
    ], 2, 24)
    bs, mel, dr = s.v
    spans = {id(bs): [], id(mel): []}

    def put(v, t0, t1, f, inst):
        spans[id(v)].append((t0, t1, len(f) if isinstance(f, list) else 1))
        v.note(t0, t1, f, CLS_TONE, inst)

    # Rootless voicings for ch3, low to high (rolled one tick a tone).
    CH = {
        "Gm9":   (53, 58, 62, 69),   # F3 Bb3 D4 A4
        "C13":   (52, 58, 62, 69),   # E3 Bb3 D4 A4
        "Eb9":   (55, 61, 65, 70),   # G3 Db4 F4 Bb4
        "D7#9":  (54, 60, 65, 70),   # F#3 C4 F4 Bb4
        "Ab13":  (54, 60, 65, 70),   # Gb3 C4 F4 Bb4 (the same four notes)
        "Cm9":   (51, 58, 62, 67),   # Eb3 Bb3 D4 G4
        "F13":   (51, 57, 62, 67),   # Eb3 A3 D4 G4
        "Bbmaj": (50, 57, 60, 65),   # D3 A3 C4 F4
        "Ebmaj": (50, 55, 58, 65),   # D3 G3 Bb3 F4
        "Am7b5": (51, 55, 60, 67),   # Eb3 G3 C4 G4
        "Bb13":  (50, 56, 60, 67),   # D3 Ab3 C4 G4
    }

    # Bass on the pair. (step, midi | (from, to) slide, steps).
    def bass(bar, notes, inst=BASS, gap=3):
        for st, m, ln in notes:
            t0 = s.t(bar, st)
            if isinstance(m, tuple):
                a, b, hold, glide = m if len(m) == 4 else (m[0], m[1], 2, 4)
                f = [pair_div(a)] * hold + [pair_div(a + (b - a) * k / glide)
                                            for k in range(1, glide + 1)]
            else:
                f = pair_div(m)
            put(bs, t0, s.t(bar, st + ln) - gap, f, inst)

    def riff_up(root, third, last):          # 1 . . 3 . 4 | b5~5 . . b7 . approach
        return [(0, root, 2), (3, root + third, 1), (5, root + 5, 1),
                (6, (root + 6, root + 7), 2), (9, root + 10, 1), (11, last, 1)]

    def riff_down(root, third, last):        # 8 . . b7 . 5 | b5~4 . . 3 . approach
        return [(0, root + 12, 2), (3, root + 10, 1), (5, root + 7, 1),
                (6, (root + 6, root + 5), 2), (9, root + third, 1), (11, last, 1)]

    def walk(a, b, c, d, skip=False):        # quarters, optional skip note
        if skip:
            return [(0, a, 3), (3, b, 2), (5, b, 1), (6, c, 3), (9, d, 3)]
        return [(0, a, 3), (3, b, 3), (6, c, 3), (9, d, 3)]

    # ch3: rolled chord, echoes of its top note, lead with scoop and vibrato.
    def strum(bar, st, chord, gate=12):
        t0 = s.t(bar, st)
        put(mel, t0, t0 + gate, [tone_div(m) for m in CH[chord]], STRUM)

    def echo(bar, st, chord, inst):
        t0 = s.t(bar, st)
        put(mel, t0, t0 + (2 if inst == E1 else 1), tone_div(CH[chord][-1]), inst)

    def stabs(bar, chord, kind):
        if kind == 0:                        # roll, echo, roll, echo
            strum(bar, 2, chord)
            echo(bar, 5, chord, E1)
            strum(bar, 8, chord)
            echo(bar, 11, chord, E1)
        elif kind == 1:                      # one roll and its tail
            strum(bar, 5, chord)
            echo(bar, 8, chord, E1)
            echo(bar, 11, chord, E2)
        else:                                # roll on two, lead takes the rest
            strum(bar, 2, chord)

    def lead(bar, phrase):
        for st, m, ln, *scoop in phrase:
            t0 = s.t(bar, st)
            t1 = s.t(bar, st + ln) - 2
            d = tone_div(m)
            f = [d] * (t1 - t0)
            if scoop:
                f[0] = f[1] = tone_div(m - 1)
            if ln >= 3:                      # one divider step, towards true pitch
                sharp = CLK / (2.0 * (d + 1)) > hz(m)
                for k in range(14, len(f)):
                    if (k - 14) // 3 % 2:
                        f[k] = d + 1 if sharp else d - 1
            put(mel, t0, t1, f, LEAD)

    KIT = {
        "K": (CLS_POLY4, [20, 34, 60, 110, 200, 255], KICK, 3),
        "R": (CLS_NOISE, 0x06, RIM, 1),
        "h": (CLS_NOISE, 0x00, HAT, 1),
        "o": (CLS_NOISE, 0x01, OHAT, 3),
        "T": (CLS_TONE, [118, 128, 140, 154], KICK, 2),    # tom, 268 -> 206 Hz
        "t": (CLS_TONE, [160, 176, 194, 214], KICK, 2),    # tom, 198 -> 149 Hz
        "P": (CLS_TONE, tone_div(79), PING, 1),            # G5
        "Q": (CLS_TONE, tone_div(78), PING, 1),            # F#5
        "p": (CLS_TONE, tone_div(74), PING, 1),            # D5
    }
    DR_1 = "K.hR.hK.hR.h"
    DR_2 = "K.hR.K..hR.h"
    DR_3 = "K.hR.hK.hR.o"
    DR_4 = "K.hR.KK.hR.h"

    G, C = 31, 36
    LICK_UP = [(6, 62, 1), (7, 65, 1), (8, 67, 1), (9, 70, 2), (11, 67, 1)]
    LICK_DN = [(6, 67, 1), (7, 65, 1), (8, 62, 1), (9, 61, 2), (11, 60, 1)]

    # Intro: the bass riff, snaps and pings, then hats and one roll.
    bass(0, riff_up(G, 3, 42))
    bass(1, riff_down(G, 3, 32))
    drum_hits(s, dr, 0, "P..R..p..R..", KIT)
    drum_hits(s, dr, 1, "..hR.h..hRhh", KIT)
    stabs(1, "Gm9", 1)

    b0 = s.intro_bars
    A, B, BRK, REP = b0, b0 + 8, b0 + 16, b0 + 20

    # A: riff and rolls; the hook comes in on the second four.
    PROG_A = ["Gm9", "Gm9", "C13", "C13", "Gm9", "Gm9", "Eb9", "D7#9"]
    bass(A + 0, riff_up(G, 3, 42))
    bass(A + 1, riff_down(G, 3, 35))
    bass(A + 2, riff_up(C, 4, 47))
    bass(A + 3, riff_down(C, 4, 32))
    bass(A + 4, riff_up(G, 3, 42))
    bass(A + 5, riff_down(G, 3, 38))
    bass(A + 6, [(0, 39, 2), (3, 46, 1), (5, 49, 1), (6, 51, 2), (9, 49, 1), (11, 39, 1)])
    bass(A + 7, [(0, 38, 2), (3, 50, 1), (5, 48, 1), (6, 45, 2), (9, 42, 1), (11, 37, 1)])
    for k in range(4):
        stabs(A + k, PROG_A[k], k % 2)
    stabs(A + 4, "Gm9", 2)
    lead(A + 4, LICK_UP)
    lead(A + 5, [(0, 69, 4, True)])
    stabs(A + 5, "Gm9", 1)
    stabs(A + 6, "Eb9", 2)
    lead(A + 6, [(6, 61, 1), (7, 65, 1), (8, 67, 1), (9, 70, 2), (11, 67, 1)])
    lead(A + 7, [(0, 66, 4, True)])
    strum(A + 7, 5, "D7#9")
    echo(A + 7, 8, "D7#9", E1)
    for k in range(8):
        drum_hits(s, dr, A + k, "K.hR.hK.hRRR" if k == 7 else (DR_2 if k % 2 else DR_1), KIT)

    # B: walking bass, a roll on one, the tune.
    PROG_B = ["Cm9", "F13", "Bbmaj", "Ebmaj", "Am7b5", "D7#9", "Gm9", "Gm9"]
    WALK = [(36, 39, 43, 42), (41, 45, 48, 47), (46, 45, 43, 40), (39, 43, 46, 34),
            (33, 39, 36, 39), (38, 42, 45, 44), (43, 41, 38, 34)]
    TUNE = [
        [(3, 63, 2), (5, 65, 1), (6, 67, 3), (9, 70, 3)],
        [(0, 69, 5, True), (5, 67, 1), (6, 65, 2), (8, 63, 1), (9, 62, 3)],
        [(3, 62, 2), (5, 63, 1), (6, 65, 3), (9, 69, 3)],
        [(0, 67, 5, True), (5, 65, 1), (6, 62, 2), (8, 60, 1), (9, 58, 3)],
        [(3, 60, 2), (5, 63, 1), (6, 67, 3), (9, 72, 3)],
        [(0, 69, 3), (3, 68, 2), (5, 67, 1), (6, 66, 4), (10, 62, 1), (11, 66, 1)],
        [(0, 67, 5, True), (6, 65, 1), (7, 62, 1), (8, 58, 1), (9, 55, 3)],
    ]
    for k in range(7):
        bass(B + k, walk(*WALK[k], skip=k % 2 == 0))
        if k in (0, 2, 4):
            strum(B + k, 0, PROG_B[k], 14)
        lead(B + k, TUNE[k])
        drum_hits(s, dr, B + k, DR_3 if k % 2 else DR_1, KIT)
    bass(B + 7, [(0, 31, 3), (3, 38, 2), (6, 34, 3), (9, 46, 2), (11, 40, 1)])
    strum(B + 7, 2, "Gm9")
    strum(B + 7, 6, "Bb13")
    echo(B + 7, 9, "Bb13", E1)
    drum_hits(s, dr, B + 7, "K.hR.hR.RTTt", KIT)

    # Breakdown: long sliding bass, triplet arp with its echo, pings.
    ARP = {"Ebmaj": (55, 58, 62, 65, 67, 70), "D7#9": (54, 57, 60, 65, 66, 70)}
    PAT_1 = [0, 2, 4, 1, 3, 5, 2, 4, 3, 1, 2, 0]
    PAT_2 = [5, 3, 2, 4, 2, 1, 3, 1, 0, 2, 1, None]
    PAT_3 = [0, 2, 4, 1, 3, 5, None, None, None, None, None, None]
    arp = []
    for k, (ch, pat) in enumerate((("Ebmaj", PAT_1), ("Ebmaj", PAT_2),
                                   ("D7#9", PAT_1), ("D7#9", PAT_3))):
        arp += [(s.t(BRK + k, st), ARP[ch][i]) for st, i in enumerate(pat) if i is not None]
    mains = {t0 for t0, _m in arp}
    for t0, m in arp:
        put(mel, t0, t0 + 2, tone_div(m), E1)
    for t0, m in arp:
        te = t0 + s.step + s.step // 2      # between the next two main notes
        if te not in mains and te < s.t(BRK + 3, 9):
            put(mel, te, te + 2, tone_div(m), E2)
    bass(BRK + 0, [(0, 39, 11)], LONG)
    bass(BRK + 1, [(0, 39, 5), (6, 34, 3), (9, (39, 38, 6, 12), 3)], LONG)
    bass(BRK + 2, [(0, 38, 11)], LONG)
    bass(BRK + 3, [(0, 38, 5)], LONG)
    bass(BRK + 3, [(6, 50, 2), (9, 34, 1), (10, 33, 1), (11, 32, 1)])
    drum_hits(s, dr, BRK + 0, "P.h..hp.h..h", KIT)
    drum_hits(s, dr, BRK + 1, "..h..hP.h..h", KIT)
    drum_hits(s, dr, BRK + 2, "Q.h..hp.h..h", KIT)
    drum_hits(s, dr, BRK + 3, "..h..hR.RTTt", KIT)

    # Reprise: riff, hook up then down, bII back to the top.
    bass(REP + 0, riff_up(G, 3, 47))
    bass(REP + 1, riff_down(C, 4, 32))
    bass(REP + 2, riff_up(G, 3, 33))
    bass(REP + 3, [(0, 32, 2), (3, 44, 1), (5, 42, 1), (6, 39, 2), (9, 36, 1), (11, 32, 1)])
    stabs(REP + 0, "Gm9", 2)
    lead(REP + 0, LICK_UP)
    lead(REP + 1, [(0, 69, 4, True)])
    stabs(REP + 1, "C13", 1)
    stabs(REP + 2, "Gm9", 2)
    lead(REP + 2, LICK_DN)
    lead(REP + 3, [(0, 58, 3, True)])
    stabs(REP + 3, "Ab13", 1)
    drum_hits(s, dr, REP + 0, DR_4, KIT)
    drum_hits(s, dr, REP + 1, "K.hR.hK.hR.K", KIT)
    drum_hits(s, dr, REP + 2, DR_4, KIT)
    drum_hits(s, dr, REP + 3, "K.hR.hTTtR.R", KIT)

    # One voice each: a gate-off or a slide must not land inside the next note.
    for name, v in (("bass", bs), ("ch3", mel)):
        sp = sorted(spans[id(v)])
        for (a0, a1, an), (b0_, _b1, _bn) in zip(sp, sp[1:]):
            if a1 > b0_ or a0 + an > b0_:
                g.die(f"Duty Free {name}: note at tick {a0} runs into tick {b0_}")
        if sp[-1][1] >= s.n:
            g.die(f"Duty Free {name}: last note is still gated at the loop point")
    return s


TUNES = (low_orbit, cryosleep, far_relay, duty_free)


# --------------------------------------------------------------------------
# Preview render (rough POKEY model, for listening only)
# --------------------------------------------------------------------------

POLY4 = [1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1]


def render_wav(path: Path, vbis, std: int, rate: int = 44100) -> None:
    vbi_hz = g.VBI_HZ[std]
    rng = random.Random(1)
    ph = [0.0, 0.0, 0.0]
    idx = [0, 0, 0]
    out = bytearray()
    t_acc = 0.0
    for v in vbis:
        f1, f2, f3, f4, _a1, a2, a3, a4 = v
        chans = ((g.POKEY_179 / ((f1 | f2 << 8) + 7), a2),
                 (CLK / (f3 + 1), a3),
                 (CLK / (f4 + 1), a4))
        t_acc += rate / vbi_hz
        ns = int(t_acc)
        t_acc -= ns
        for _ in range(ns):
            smp = 0.0
            for c, (div_hz, audc) in enumerate(chans):
                vol = audc & 15
                if not vol:
                    continue
                dist = audc & 0xE0
                ph[c] += div_hz / rate
                k = int(ph[c])
                ph[c] -= k
                if dist == 0xA0:
                    idx[c] = (idx[c] + k) & 1
                    bit = idx[c]
                elif dist == 0xC0:
                    idx[c] = (idx[c] + k) % 15
                    bit = POLY4[idx[c]]
                else:
                    if k:
                        idx[c] = rng.getrandbits(1)
                    bit = idx[c] & 1
                smp += vol * (bit - 0.5)
            out += struct.pack("<h", max(-32767, min(32767, int(smp * 700))))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(out))


# --------------------------------------------------------------------------

def pack(s: Song):
    cols, ni, nl = s.columns()
    s_intro = g.sparse_encode(cols[:ni])
    s_loop = g.sparse_encode(cols[ni:], full_first=True)
    tokens = g.pack_stream(s_intro, s_loop, g.RING_BYTES - 1)
    blob = bytes((0x50, len(s.inst))) + b"".join(bytes(k) for k in s.inst) + tokens
    want_n = ni + 2 * nl
    for std, name in ((0, "PAL"), (1, "NTSC")):
        _, tks, _ = g.play_blob(blob, s.tick_hz, std)
        if len(tks) != want_n:
            g.die(f"{s.name} {name}: decoded {len(tks)} ticks, want {want_n}")
        for k in range(want_n):
            w = cols[k if k < ni + nl else k - nl]
            if tks[k] != tuple(w[:4]) + tuple(x & 0x7F for x in w[4:]):
                g.die(f"{s.name} {name}: round trip mismatch at tick {k}")
    print(f"genmenutune: {s.name}: {s.bpm} BPM, {s.tick_hz:.2f} Hz ticks, intro {ni / s.tick_hz:.1f} s "
          f"+ loop {nl / s.tick_hz:.1f} s, {len(s_intro) + len(s_loop)} stream bytes -> "
          f"{len(blob)} packed, round trip ok")
    return blob, tokens


def build(args) -> None:
    songs = [f() for f in TUNES]
    packed = [pack(s) for s in songs]
    inst_off = []
    inst = []
    for s in songs:
        inst_off.append(2 * len(inst))
        inst += s.inst
    if 2 * len(inst) > INST_BYTES_MAX:
        g.die("envelope table over 256 bytes")
    total = sum(len(t) for _, t in packed) + 2 * len(inst)
    print(f"genmenutune: {len(songs)} tracks, {total} data bytes")

    if args.wav_dir:
        for s, (blob, _) in zip(songs, packed):
            _, _, vbis = g.play_blob(blob, s.tick_hz, 0)
            p = args.wav_dir / (s.name.lower().replace(" ", "_") + ".wav")
            render_wav(p, vbis, 0)
            print(f"genmenutune: wrote {p}")

    def bytes_rows(b):
        return ["\t!byte " + ",".join(f"${x:02x}" for x in b[i:i + 16]) for i in range(0, len(b), 16)]

    n = len(songs)
    rl = [g.rate16(s.tick_hz, std) for s in songs for std in (0, 1)]
    L = [
        "; Generated by tools/genmenutune.py. Do not edit.",
        f"MUSIC_TRACKS = {n}",
        "",
        "mus_spf_lo\t!byte " + ",".join(f"${v & 255:02x}" for v in g.SPF),
        "mus_spf_hi\t!byte " + ",".join(f"${v >> 8:02x}" for v in g.SPF),
        "; per track: PAL, NTSC ticks per VBI (0.16)",
        "mus_rate_lo\t!byte " + ",".join(f"${v & 255:02x}" for v in rl),
        "mus_rate_hi\t!byte " + ",".join(f"${v >> 8:02x}" for v in rl),
        "mus_audctl\t!byte " + ",".join(f"${b[0]:02x}" for b, _ in packed),
        "mus_inst_off\t!byte " + ",".join(f"${o:02x}" for o in inst_off),
        "mus_tok_lo\t!byte " + ",".join(f"<mus_tok{k}" for k in range(n)),
        "mus_tok_hi\t!byte " + ",".join(f">mus_tok{k}" for k in range(n)),
        "mus_inst",
    ]
    L += bytes_rows(b"".join(bytes(k) for k in inst))
    for k, (s, (_, tok)) in enumerate(zip(songs, packed)):
        L.append(f"; {s.name}: {s.bpm} BPM, {s.tick_hz:.2f} Hz, {len(tok)} bytes")
        L.append(f"mus_tok{k}")
        L += bytes_rows(tok)
    L.append("mus_data_end")
    L.append("")
    for k, s in enumerate(songs):
        L.append(f'str_trk{k + 1}\t!scr "{s.name}",0')
    for k, s in enumerate(songs):
        L.append(f'str_now{k + 1}\t!scr "Now playing: {s.name}",0')
    L.append("juke_now_lo\t!byte " + ", ".join(f"<str_now{k + 1}" for k in range(n)))
    L.append("juke_now_hi\t!byte " + ", ".join(f">str_now{k + 1}" for k in range(n)))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(L) + "\n", encoding="ascii")
    print(f"genmenutune: wrote {args.out.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT_ASM)
    ap.add_argument("--wav-dir", type=Path, help="also render rough PAL previews")
    build(ap.parse_args())


if __name__ == "__main__":
    main()
