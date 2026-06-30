@echo off
cd /d "%~dp0"
echo Stopping any site already running on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo.
echo Starting the site fresh - this can take 10-20 seconds...
echo Leave THIS window open. When you see "Ready" or "compiled", hard-refresh the browser (Ctrl+Shift+R).
echo.
call npm run dev
pause
