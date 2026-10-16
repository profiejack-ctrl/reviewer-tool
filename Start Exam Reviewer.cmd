@echo off
cd /d "%~dp0"
start "Exam Reviewer Studio" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
npm.cmd start
