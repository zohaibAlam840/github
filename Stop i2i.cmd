@echo off
REM Stops whatever the launcher started, for when the window was closed the
REM hard way (End Task, a crash) and the processes are still holding their
REM ports. Safe to run at any time.
title Stop i2i
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-i2i.ps1"
