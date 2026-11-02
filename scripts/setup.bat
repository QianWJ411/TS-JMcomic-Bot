@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [setup] Node.js 20.19+ is required.
  echo         Download: https://nodejs.org/  or  https://nodejs.cn/
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=19)?0:1)"
if errorlevel 1 (
  echo [setup] Node.js 20.19+ is required. Current:
  node -v
  pause
  exit /b 1
)

echo [setup] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [setup] npm install failed.
  pause
  exit /b 1
)

echo [setup] Building...
call npm run build
if errorlevel 1 (
  echo [setup] build failed.
  pause
  exit /b 1
)

echo [setup] Done. Double-click start.bat to run the bot.
pause
