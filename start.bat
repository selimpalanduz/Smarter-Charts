@echo off
echo Starting Smarter Charts...

start "Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn main:app --reload"

start "Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul

start http://localhost:5173

echo Both servers are starting in separate windows.
pause