@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "NODE_PATH=C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
cd /d "%ROOT%"
npm run desktop
