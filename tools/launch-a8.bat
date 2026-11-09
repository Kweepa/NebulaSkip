@echo off
start "Altirra" "C:\app\altirra\Altirra64.exe" /defprofile:xl /hardware:130XE /ntsc /nobasic /tempprofile /memsize:128K /w /diskemu:1050 /debug "/debugcmd:.batch %~dp0a8dbg.at" /disk "%~dp0..\nebula.atr"
