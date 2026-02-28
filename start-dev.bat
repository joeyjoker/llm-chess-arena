@echo off
setlocal
cd /d "%~dp0"

echo [LLM Chess Arena] working dir: %cd%

if not exist ".env" (
  echo [LLM Chess Arena] .env not found, creating from .env.example ...
  copy /Y ".env.example" ".env" >nul
)

echo [LLM Chess Arena] installing dependencies ...
call npm install
if errorlevel 1 (
  echo [LLM Chess Arena] npm install failed.
  exit /b 1
)

echo [LLM Chess Arena] starting dev server ...
call npm run dev