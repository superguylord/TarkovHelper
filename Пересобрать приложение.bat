@echo off
rem Пересобирает TarkovHelper.exe после изменений в коде
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run pack
pause
