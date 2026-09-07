@echo off
REM ---------------------------------------------------------------------------
REM  A1K Task Tracker - Standard Edition
REM
REM  Double-click this file. It installs whatever is missing, builds the app,
REM  starts it and opens your browser. Safe to run as often as you like.
REM
REM  For the Excel edition, use start-excel.bat instead.
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

node tools\launch.mjs %*

echo.
pause
