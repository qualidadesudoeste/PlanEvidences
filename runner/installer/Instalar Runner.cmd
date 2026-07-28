@echo off
setlocal
title PlanEvidences Runner
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-portable.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar o PlanEvidences Runner.
  echo Consulte a mensagem acima ou solicite apoio ao administrador.
  pause
  exit /b 1
)
echo.
echo Instalacao concluida. O Runner continuara ativo em segundo plano.
start "" "http://127.0.0.1:4317/"
timeout /t 2 /nobreak >nul
exit /b 0
