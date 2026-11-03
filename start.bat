@echo off
echo Starting Smarter Charts...

start "Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn main:app --reload"

rem Weekly statement filler, in its own process: the API reloads on edits and would kill it.
start "Fundamentals filler" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && python -m fundamentals.warmer"

start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul

start http://localhost:5173

echo Servers and the statement filler are starting in separate windows.
pause