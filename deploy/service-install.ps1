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

# Verifica nssm
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host '[ERRO] nssm não encontrado no PATH.' -ForegroundColor Red
    Write-Host '       Instale com:  winget install NSSM.NSSM' -ForegroundColor Yellow
    Write-Host '       Ou manual em:  https://nssm.cc/download' -ForegroundColor Yellow
    exit 1
}

# --- Uninstall ---
if ($Uninstall) {
    Write-Host "Removendo serviço '$ServiceName'..." -ForegroundColor Cyan
    & nssm stop $ServiceName 2>&1 | Out-Null
    & nssm remove $ServiceName confirm 2>&1 | Out-Host
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
    & nssm stop $ServiceName 2>&1 | Out-Null
} else {
    Write-Host "Criando serviço '$ServiceName'..." -ForegroundColor Cyan
    & nssm install $ServiceName $nodeExe $serverJs
    if ($LASTEXITCODE -ne 0) { throw 'nssm install falhou' }
}

# Configura: working dir, restart automático, logs
& nssm set $ServiceName AppDirectory (Join-Path $repoRoot 'backend') | Out-Null
& nssm set $ServiceName DisplayName 'PlanEvidences (QA Suite)' | Out-Null
& nssm set $ServiceName Description 'PlanEvidences — gerador de casos de teste + editor de evidências (porta 4500)' | Out-Null
& nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
& nssm set $ServiceName AppStdout $stdoutLog | Out-Null
& nssm set $ServiceName AppStderr $stderrLog | Out-Null
& nssm set $ServiceName AppRotateFiles 1 | Out-Null
& nssm set $ServiceName AppRotateBytes 10485760 | Out-Null  # 10 MB por rotação
& nssm set $ServiceName AppExit Default Restart | Out-Null
& nssm set $ServiceName AppRestartDelay 2000 | Out-Null

# Inicia
Write-Host "Iniciando serviço..." -ForegroundColor Cyan
& nssm start $ServiceName 2>&1 | Out-Host

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
