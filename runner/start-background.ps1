$ErrorActionPreference = 'Stop'
$runnerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $runnerRoot '.env'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Arquivo runner\.env não encontrado. Execute install.ps1 uma vez.'
}

$runnerPort = 4317
$portLine = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^RUNNER_PORT=\d+$' } |
    Select-Object -First 1
if ($portLine) {
    $runnerPort = [int]($portLine -replace '^RUNNER_PORT=', '')
}

$existing = Get-NetTCPConnection -LocalPort $runnerPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    exit 0
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logsPath = Join-Path $runnerRoot 'logs'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('--env-file=.env', 'src/server.js') `
    -WorkingDirectory $runnerRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsPath 'runner-out.log') `
    -RedirectStandardError (Join-Path $logsPath 'runner-error.log')

Start-Sleep -Seconds 2
$started = Get-NetTCPConnection -LocalPort $runnerPort -State Listen -ErrorAction SilentlyContinue
if (-not $started) {
    throw "O Runner Local não iniciou na porta $runnerPort. Consulte runner\logs\runner-error.log."
}
