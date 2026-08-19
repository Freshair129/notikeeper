@echo off
REM Ensures a persistent local API token exists, then exports it as NOTIKEEPER_TOKEN
REM for whichever launcher CALLed this script.
REM
REM The token gates POST /ingest and every read API (/api/*, /events). Without it
REM those endpoints are open to anything that can reach the port, so every launcher
REM sources this before starting server.mjs.
REM
REM The token is generated once and kept in a gitignored file rather than written
REM into any script - this repository is public. Delete the file to roll the token
REM (you must then re-pair the phone).
REM
REM Uses goto rather than parenthesised if-blocks: cmd parses a whole ( ) block up
REM front, which mangles the inline PowerShell below.

set "TOKEN_FILE=%~dp0.notikeeper-token"

if exist "%TOKEN_FILE%" goto :read

set "PS_GEN=$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $t = [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_'); Set-Content -Path $env:TOKEN_FILE -Value $t -NoNewline -Encoding ascii"
powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS_GEN%"
set "PS_GEN="
if not exist "%TOKEN_FILE%" goto :nofile
echo   Generated a new API token: %TOKEN_FILE%
echo   Re-pair the phone so it picks up the new token.

:read
set /p NOTIKEEPER_TOKEN=<"%TOKEN_FILE%"
goto :eof

:nofile
echo   WARNING: could not create %TOKEN_FILE%
echo   WARNING: the server will start UNAUTHENTICATED.
goto :eof
