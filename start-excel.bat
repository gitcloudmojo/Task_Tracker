@echo off
REM ---------------------------------------------------------------------------
REM  A1K Task Tracker - Excel Edition
REM
REM  The same app, but the database is server\data\A1K-Task-Tracker.xlsx.
REM  Open that file in Excel while this is running and your edits show up in
REM  the app; changes made in the app are written back to the file.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------------
  echo   Node.js is not installed, or Windows cannot find it.
  echo.
  echo   Install the LTS build from https://nodejs.org, then close this
  echo   window, open the folder again and double-click this file.
  echo   ------------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

node tools\launch.mjs --excel %*

echo.
pause
