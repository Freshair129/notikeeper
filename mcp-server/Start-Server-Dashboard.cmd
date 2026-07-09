@echo off
REM Starts the NotiKeeper server if needed, then opens the dashboard.
REM Run before backing up from the phone: Settings - Device and Connection - Scan QR

set "NODE_EXE=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

cd /d "%~dp0"

echo Checking server...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8765/dashboard' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
    echo   Server already running.
) else (
    echo   Starting server...
    start "" /B "%NODE_EXE%" "%~dp0server.mjs"
    timeout /t 3 /nobreak >nul
)

if defined NOTIKEEPER_TOKEN (
    echo   NOTIKEEPER_TOKEN is set - enter the same token on your phone and the web dashboard.
)

echo Opening dashboard in browser...
start "" "http://localhost:8765/dashboard"

echo.
echo Ready to back up:
echo   1. On the phone, open NotiKeeper, go to Settings - Device and Connection, tap Scan QR.
echo   2. If the QR code is not showing on the dashboard, click "Pair Mobile" first.
echo.
pause
