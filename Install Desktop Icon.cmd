@echo off
REM Run this ONCE on the office PC after copying the folder into place.
REM It puts an "i2i Control System" icon on the Desktop and in the Start
REM menu. After that, nobody needs to open this folder again.
title Install i2i Desktop Icon
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcut.ps1"
echo.
pause
