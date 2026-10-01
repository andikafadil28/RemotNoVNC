@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-poc.ps1"
if errorlevel 1 pause
