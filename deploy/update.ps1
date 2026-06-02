# =============================================================================
# PlanEvidences — atualiza no Smart Sig Runner (git pull + rebuild + restart)
# =============================================================================
# Idempotente. Roda como Administrator se for usar -RestartService.
#
# Uso:
#   .\deploy\update.ps1                    # git pull + reinstala + rebuilda
#   .\deploy\update.ps1 -RestartService    # idem + reinicia o Windows Service
#   .\deploy\update.ps1 -SkipPull          # pula git pull (usa código local)
# =============================================================================

param(
    [switch]$RestartService,
    [switch]$SkipPull,
    [string]$ServiceName = 'PlanEvidences'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Section($msg) {
    Write-Host "`n--- $msg ---" -ForegroundColor Cyan
}

Push-Location $repoRoot
try {
    # ===== Git pull =====
    if (-not $SkipPull) {
        Write-Section 'Atualizando código (git pull)'
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCmd) {
            Write-Host '[AVISO] git não encontrado. Pulando pull (use -SkipPull pra silenciar).' -ForegroundColor Yellow
        } else {
            git pull --ff-only 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw 'git pull falhou (resolva conflitos manualmente ou use -SkipPull)'
            }
        }
    }

    # ===== Backend =====
    Write-Section 'Sincronizando dependências do backend'
    Push-Location (Join-Path $repoRoot 'backend')
    try {
        npm ci --no-audit --no-fund 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  npm ci falhou — caindo pra npm install' -ForegroundColor Yellow
            npm install --no-audit --no-fund 2>&1 | Out-Host
        }
    } finally { Pop-Location }

    # ===== Frontend =====
    Write-Section 'Sincronizando dependências do frontend'
    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        npm ci --no-audit --no-fund 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  npm ci falhou — caindo pra npm install' -ForegroundColor Yellow
            npm install --no-audit --no-fund 2>&1 | Out-Host
        }

        Write-Section 'Build do frontend'
        npm run build 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou' }
    } finally { Pop-Location }

    # ===== Restart service =====
    if ($RestartService) {
        Write-Section "Reiniciando serviço '$ServiceName'"
        $isAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
                [Security.Principal.WindowsBuiltInRole]::Administrator
            )
        if (-not $isAdmin) {
            Write-Host '[AVISO] Para reiniciar o serviço rode como Administrator. Reinicie manualmente:' -ForegroundColor Yellow
            Write-Host "  nssm restart $ServiceName" -ForegroundColor Gray
        } else {
            $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
            if (-not $svc) {
                Write-Host "[AVISO] Serviço '$ServiceName' não está instalado. Use service-install.ps1." -ForegroundColor Yellow
            } else {
                nssm restart $ServiceName 2>&1 | Out-Host
                Start-Sleep -Seconds 2
                $svc = Get-Service -Name $ServiceName
                if ($svc.Status -eq 'Running') {
                    Write-Host "[OK] Serviço reiniciado." -ForegroundColor Green
                } else {
                    Write-Host "[AVISO] Serviço não está Running. Cheque logs/stderr.log" -ForegroundColor Yellow
                }
            }
        }
    } else {
        Write-Host "`nLembrete: se rodou como serviço, reinicie com 'nssm restart $ServiceName' ou rode de novo com -RestartService." -ForegroundColor Yellow
    }

    Write-Section 'Update concluído'
} finally { Pop-Location }
