@echo off
title NotiKeeper Server ^& Dashboard UI Launcher
cd /d "%~dp0mcp-server"

set "NODE_EXE=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo [1/2] Checking ^& Starting NotiKeeper MCP Server...
powershell -NoProfile -Command "try { $res = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/dashboard' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
    echo       Server is already running on port 8765.
) else (
    echo       Launching server in background...
    call "%~dp0mcp-server\load-token.cmd"
    start "" /B "%NODE_EXE%" "server.mjs"
    timeout /t 2 /nobreak >nul
)

echo [2/2] Opening Dashboard UI...
start "" "http://localhost:8765/dashboard"

echo.
echo ========================================================
echo   NotiKeeper Server ^& Dashboard UI launched successfully!
echo   URL: http://localhost:8765/dashboard
echo ========================================================
echo.
timeout /t 3
