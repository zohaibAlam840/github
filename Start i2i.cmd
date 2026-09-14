@echo off
REM Double-click entry point for the i2i Control Management System.
REM Everything real lives in start-i2i.ps1; this exists so the operator has
REM something to click, and so the PowerShell execution policy cannot block
REM it on a machine that has never run a script before.
title i2i Control Management System
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-i2i.ps1" %*
