# =============================================================================
# PlanEvidences — registra o backend Node como Windows Service via nssm
# =============================================================================
# Pré-requisito: nssm instalado e no PATH.
#   Recomendado: winget install NSSM.NSSM
#   Manual:      baixar em https://nssm.cc/download, extrair e adicionar ao PATH
#
# Uso:
#   .\deploy\service-install.ps1              # instala o serviço PlanEvidences
#   .\deploy\service-install.ps1 -Uninstall   # remove o serviço
#   .\deploy\service-install.ps1 -ServiceName MeuNome  # nome customizado
# =============================================================================

param(
    [string]$ServiceName = 'PlanEvidences',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Precisa ser Administrator pra criar/remover serviço
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
if (-not $isAdmin) {
    Write-Host '[ERRO] Rode este script como Administrator (clique direito → Run as Administrator).' -ForegroundColor Red
    exit 1
}

# Resolve nssm: primeiro tenta o binário bundleado no repo (deploy\nssm.exe),
# depois cai pro PATH (caso o operador prefira gerenciar via winget/chocolatey).
$bundledNssm = Join-Path $PSScriptRoot 'nssm.exe'
if (Test-Path $bundledNssm) {
    $nssmExe = $bundledNssm
    Write-Host "Usando nssm bundleado: $nssmExe" -ForegroundColor Gray
} else {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Host '[ERRO] nssm não encontrado. Esperado em deploy\nssm.exe ou no PATH.' -ForegroundColor Red
        Write-Host '       Faça git pull (o nssm.exe está commitado) OU baixe em https://nssm.cc/download' -ForegroundColor Yellow
        exit 1
    }
    $nssmExe = $cmd.Source
    Write-Host "Usando nssm do PATH: $nssmExe" -ForegroundColor Gray
}

# --- Uninstall ---
if ($Uninstall) {
    Write-Host "Removendo serviço '$ServiceName'..." -ForegroundColor Cyan
    & $nssmExe stop $ServiceName 2>&1 | Out-Null
    & $nssmExe remove $ServiceName confirm
    Write-Host "Serviço '$ServiceName' removido." -ForegroundColor Green
    exit 0
}

# --- Install ---
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host '[ERRO] Node.js não encontrado no PATH.' -ForegroundColor Red
    exit 1
}
$nodeExe = $nodeCmd.Source
$serverJs = Join-Path $repoRoot 'backend\src\server.js'

if (-not (Test-Path $serverJs)) {
    Write-Host "[ERRO] $serverJs não encontrado. Rode .\deploy\install.ps1 primeiro." -ForegroundColor Red
    exit 1
}

# Logs
$logsDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$stdoutLog = Join-Path $logsDir 'stdout.log'
$stderrLog = Join-Path $logsDir 'stderr.log'

# Se o serviço já existe, para antes de reconfigurar
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Serviço '$ServiceName' já existe — reconfigurando..." -ForegroundColor Yellow
    & $nssmExe stop $ServiceName 2>&1 | Out-Null
} else {
    Write-Host "Criando serviço '$ServiceName'..." -ForegroundColor Cyan
    & $nssmExe install $ServiceName $nodeExe '--env-file=.env' $serverJs
    if ($LASTEXITCODE -ne 0) { throw 'nssm install falhou' }
}

# Configura: working dir, restart automático, logs
& $nssmExe set $ServiceName AppDirectory (Join-Path $repoRoot 'backend') | Out-Null
& $nssmExe set $ServiceName DisplayName 'PlanEvidences (QA Suite)' | Out-Null
& $nssmExe set $ServiceName Description 'PlanEvidences — gerador de casos de teste + editor de evidências (porta 4500)' | Out-Null
& $nssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssmExe set $ServiceName AppStdout $stdoutLog | Out-Null
& $nssmExe set $ServiceName AppStderr $stderrLog | Out-Null
& $nssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $nssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null
& $nssmExe set $ServiceName AppExit Default Restart | Out-Null
& $nssmExe set $ServiceName AppRestartDelay 2000 | Out-Null

# Inicia
Write-Host "Iniciando serviço..." -ForegroundColor Cyan
& $nssmExe start $ServiceName

Start-Sleep -Seconds 2
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Write-Host "`n[OK] Serviço '$ServiceName' rodando." -ForegroundColor Green
    Write-Host "    Logs:    $logsDir" -ForegroundColor Gray
    Write-Host "    Acesso:  http://localhost:4500" -ForegroundColor Gray
    Write-Host "             http://<ip-do-servidor>:4500 (intranet)" -ForegroundColor Gray
    Write-Host "    Comandos: nssm stop/start/restart/status $ServiceName" -ForegroundColor Gray
} else {
    Write-Host "`n[AVISO] Serviço criado mas não está Running. Cheque $stderrLog" -ForegroundColor Yellow
}
