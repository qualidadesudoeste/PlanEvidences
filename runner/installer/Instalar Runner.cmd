@echo off
setlocal
title PlanEvidences Runner
set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%WINDOWS_POWERSHELL%" (
  echo Windows PowerShell nao foi encontrado em:
  echo %WINDOWS_POWERSHELL%
  pause
  exit /b 1
)
"%WINDOWS_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-portable.ps1"
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
