import subprocess, sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ATR = TOOLS.parent / "nebula.atr"
# default: quiet trap. `python tools/_launch_a8_e1m3.py log` runs the verbose trace instead.
modes = {"log": "a8dbg_e1m3.at", "force_old": "a8dbg_force_old.at", "force_new": "a8dbg_force_new.at"}
script = TOOLS / modes.get(sys.argv[1] if len(sys.argv) > 1 else "", "a8dbg_e1m3_trap.at")
cmd = (
    r"C:\app\altirra\Altirra64.exe"
    r" /hardware:130XE /ntsc /nobasic /memsize:128K /w /debug"
    f' /debugcmd:".batch {script}"'
    f" /diskemu:1050 /disk {ATR}"
)
print(cmd)
subprocess.Popen(cmd)
