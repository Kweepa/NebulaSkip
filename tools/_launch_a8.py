import subprocess
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ATR = TOOLS.parent / "nebula.atr"
SCRIPT = TOOLS / "a8dbg.at"
cmd = (
    r"C:\app\altirra\Altirra64.exe"
    r" /hardware:130XE /ntsc /nobasic /memsize:128K /w /debug"
    f' /debugcmd:".batch {SCRIPT}"'
    f" /diskemu:1050 /disk {ATR}"
)
print(cmd)
subprocess.Popen(cmd)
