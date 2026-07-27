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
echo Instalacao concluida. Esta janela pode ser fechada.
pause
