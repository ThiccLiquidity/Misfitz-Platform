@echo off
cd /d "%~dp0"
echo ============================================================
echo   Pushing today's work to GitHub (50 commits)...
echo ============================================================
echo.
git push origin main
echo.
echo If you see "main -> main" or "Everything up-to-date", you are backed up.
echo If it asks you to sign in to GitHub, do that and it will continue.
echo.
pause
