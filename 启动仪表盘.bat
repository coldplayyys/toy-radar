@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  set "PY=python"
) else (
  set "PY=py -3"
)

echo 正在启动潮玩雷达（本地服务 + 大模型代理）...
echo 打开浏览器访问： http://localhost:8000/
echo 知识库页可用本地代理调用大模型，避免浏览器跨域问题。
echo 按 Ctrl+C 停止服务。
echo.

start "" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:8000/'"
%PY% kb_server.py 8000
