@echo off
title Glazed Bedrock
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies, this takes a minute...
  call npm.cmd install --omit=dev
  if errorlevel 1 (
    echo Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo In Minecraft: Servers tab, Add Server, address 127.0.0.1, port 19134.
echo The first time you join you get a Microsoft sign-in code: open the link, enter it, then rejoin.
echo Keep this window open while you play.
echo.
node src\index.js
pause
