@echo off
cd /d "%~dp0"
echo Running Traitfolio test suite...
echo.
call npm test
echo.
echo ================================================
echo   Look just above for a line like "# fail 0".
echo   fail 0  =  everything passed (green light).
echo ================================================
pause
