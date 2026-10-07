@echo off
title JARVIS Windows Agent
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
node agent.js
pause
