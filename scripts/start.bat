@echo off
setlocal
cd /d "%~dp0.."

if not exist "node_modules" (
  echo [start] Dependencies missing, running setup...
  call "%~dp0setup.bat"
  if errorlevel 1 exit /b 1
)

if not exist "dist\index.js" (
  echo [start] Build missing, running setup...
  call "%~dp0setup.bat"
  if errorlevel 1 exit /b 1
)

node dist\index.js %*
if errorlevel 1 pause
