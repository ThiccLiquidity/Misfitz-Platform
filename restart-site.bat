@echo off
cd /d "%~dp0"
echo ============================================================
echo  Restarting Traitfolio cleanly.
echo  This stops ALL Node processes so no old/stale copy of the
echo  site can keep running, then starts ONE fresh server.
echo ============================================================
echo.
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Old servers stopped. Starting fresh on http://localhost:3000 ...
echo Leave THIS window OPEN. When you see "Ready in" or "compiled", hard-refresh the browser (Ctrl+Shift+R).
echo.
call npm run dev
pause
