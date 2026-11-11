@echo off
setlocal
cd /d "%~dp0"
title Upwork Session Keep-Alive Launcher

echo ============================================
echo   Upwork Session Keep-Alive
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 goto no_node

if exist "node_modules\puppeteer-core" goto deps_ready
echo Installing dependencies for the first run...
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed
:deps_ready

echo Starting Chrome with remote debugging...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-chrome.ps1"
if errorlevel 1 goto chrome_failed

echo.
echo Opening the keep-alive window...
echo If this is your first run, log in to Upwork in the Chrome window.
echo The keep-alive waits for login, then refreshes every 2 to 5 minutes.
echo.

start "Upwork Keep-Alive" /D "%~dp0" cmd /k "node keepalive.js"

echo The keep-alive is running in the new window.
echo You can close this launcher window.
exit /b 0

:no_node
echo.
echo Node.js was not found.
echo Install Node.js 18 or newer from https://nodejs.org/ and run this file again.
echo.
pause
exit /b 1

:install_failed
echo.
echo Could not install dependencies. Check your internet connection and try again.
echo.
pause
exit /b 1

:chrome_failed
echo.
echo Could not start Chrome with remote debugging.
echo Close every Chrome window that uses the debug profile and try again.
echo.
pause
exit /b 1
