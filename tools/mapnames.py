"""Which maps exist. Shared by genmap, mkreloc, mkatr, build, checkheap.

Maps are editor/maps/map<a-z>.json, cooked to maps/map<a-z>.prg and stored on the
disk as MAP<A-Z>. The game plays them in letter order as level_num 1..N, so N is
the leading run from A of maps that have a spawn: a new, still-empty map (or a gap)
ends the episode rather than becoming a level that cannot load.
"""

from __future__ import annotations

import json
import re
import string
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITOR_MAPS = ROOT / "editor" / "maps"
MAP_DIR = ROOT / "maps"

_FILE = re.compile(r"map([a-z])\.json")


def stem(letter: str) -> str:
    """'A' -> 'mapa' (file stem on both the editor and PRG side)."""
    return f"map{letter.lower()}"


def key(letter: str) -> str:
    """'A' -> 'MAPA' (editor key and disk file name)."""
    return f"MAP{letter.upper()}"


def json_path(letter: str) -> Path:
    return EDITOR_MAPS / f"{stem(letter)}.json"


def prg_path(letter: str) -> Path:
    return MAP_DIR / f"{stem(letter)}.prg"


def all_letters() -> list[str]:
    """Every letter that has a map json, spawn or not."""
    if not EDITOR_MAPS.is_dir():
        return []
    found = set()
    for p in EDITOR_MAPS.iterdir():
        m = _FILE.fullmatch(p.name)
        if m:
            found.add(m.group(1).upper())
    return sorted(found)


def has_spawn(letter: str) -> bool:
    try:
        level = json.loads(json_path(letter).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    objs = level.get("objects") if isinstance(level, dict) else None
    return any(isinstance(o, dict) and o.get("kind") == "spawn" for o in objs or [])


def map_letters() -> list[str]:
    """Leading run A, B, ... of maps that have a spawn."""
    out: list[str] = []
    for letter in string.ascii_uppercase:
        if not json_path(letter).is_file() or not has_spawn(letter):
            break
        out.append(letter)
    return out
