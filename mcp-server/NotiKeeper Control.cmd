@echo off
REM Double-click launcher for the NotiKeeper Control Panel.
REM Runs PowerShell hidden so only the GUI window is visible.
start "" /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0NotiKeeper-Control.ps1"
