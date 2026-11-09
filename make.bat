@echo off
setlocal
cd /d "%~dp0"
call build-a8.bat
if errorlevel 1 exit /b 1

if not exist "%~dp0nebula.atr" (
  echo nebula.atr missing after build
  exit /b 1
)
if not exist "C:\app\altirra\Altirra64.exe" (
  echo Altirra not found — nebula.atr is built; run it manually.
  exit /b 0
)
start "" "C:\app\altirra\Altirra64.exe" /hardware:130XE /ntsc /nobasic /memsize:128K /w /diskemu:1050 /disk "%~dp0nebula.atr"
