@echo off
REM Headless launcher used by Auto-start. Spawns the node server detached
REM so closing this window does NOT kill the server.

set "NODE_EXE=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

cd /d "%~dp0"
start "" /B "%NODE_EXE%" "%~dp0server.mjs"
