@echo off
setlocal
cd /d "%~dp0"

set "DISK=%~dp0nebula.atr"
if not exist "%DISK%" (
  echo %DISK% missing — run build-a8.bat first
  exit /b 1
)
if not exist "C:\app\altirra\Altirra64.exe" (
  echo Altirra not found. Expected C:\app\altirra\Altirra64.exe
  exit /b 1
)
set "VIDEO=/ntsc"
if /i "%~1"=="pal" set "VIDEO=/pal"
start "" "C:\app\altirra\Altirra64.exe" /hardware:130XE %VIDEO% /nobasic /memsize:128K /w /diskemu:1050 /disk "%DISK%"
