@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "NODE_EXE=C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "NODE_PATH=C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
cd /d "%ROOT%"
start "" "http://127.0.0.1:17880/jianying.html"
"%NODE_EXE%" "%ROOT%src\app-server.js"
pause
