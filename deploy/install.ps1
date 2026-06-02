# =============================================================================
# PlanEvidences — instalação no Smart Sig Runner (Windows Server)
# Idempotente: pode rodar várias vezes. Não sobrescreve .env existente.
# =============================================================================
# Uso:
#   cd C:\caminho\PlanEvidences
#   .\deploy\install.ps1
#
# Pré-requisitos (verificados pelo script):
#   - Node 18+
#   - npm
#   - git (opcional, só pra usar update.ps1 depois)
#   - MiKTeX/pdflatex (opcional, sem ele a app só gera .tex)
# =============================================================================

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Section($msg) {
    Write-Host "`n--- $msg ---" -ForegroundColor Cyan
}

function Test-Tool($name, $minVersion) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    try {
        $ver = (& $name --version 2>&1 | Select-Object -First 1).ToString().Trim()
        return $ver
    } catch {
        return 'instalado (versão indeterminada)'
    }
}

# ===== Pré-flight =====
Write-Section 'Verificando pré-requisitos'

$nodeVer = Test-Tool 'node'
if (-not $nodeVer) {
    Write-Host '  [ERRO] Node.js não encontrado. Instale Node 18+ de https://nodejs.org/' -ForegroundColor Red
    exit 1
}
Write-Host "  [OK]  Node:    $nodeVer" -ForegroundColor Green

$nodeMajor = [int]($nodeVer -replace 'v(\d+)\..*', '$1')
if ($nodeMajor -lt 18) {
    Write-Host "  [ERRO] Node 18+ é necessário (você tem $nodeVer)." -ForegroundColor Red
    exit 1
}

$npmVer = Test-Tool 'npm'
if (-not $npmVer) {
    Write-Host '  [ERRO] npm não encontrado.' -ForegroundColor Red
    exit 1
}
Write-Host "  [OK]  npm:     $npmVer" -ForegroundColor Green

$gitVer = Test-Tool 'git'
if ($gitVer) { Write-Host "  [OK]  git:     $gitVer" -ForegroundColor Green }
else        { Write-Host '  [--]  git:     não instalado (update.ps1 vai exigir)' -ForegroundColor Yellow }

$pdflatexVer = Test-Tool 'pdflatex'
if ($pdflatexVer) { Write-Host "  [OK]  pdflatex: $pdflatexVer" -ForegroundColor Green }
else              { Write-Host '  [--]  pdflatex: não instalado — instale MiKTeX (winget install MiKTeX.MiKTeX) ou a app gera só .tex' -ForegroundColor Yellow }

# ===== .env =====
Write-Section 'Conferindo arquivos .env'

$backendEnv = Join-Path $repoRoot 'backend\.env'
$frontendEnv = Join-Path $repoRoot 'frontend\.env'

if (-not (Test-Path $backendEnv)) {
    Copy-Item (Join-Path $repoRoot 'backend\.env.example') $backendEnv
    Write-Host "  [novo] backend/.env criado a partir do .env.example" -ForegroundColor Yellow
    Write-Host "         Edite com as credenciais antes de iniciar o serviço." -ForegroundColor Yellow
} else {
    Write-Host '  [OK]  backend/.env já existe' -ForegroundColor Green
}

if (-not (Test-Path $frontendEnv)) {
    Copy-Item (Join-Path $repoRoot 'frontend\.env.example') $frontendEnv
    Write-Host "  [novo] frontend/.env criado a partir do .env.example" -ForegroundColor Yellow
    Write-Host "         Edite com VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY antes do build." -ForegroundColor Yellow
} else {
    Write-Host '  [OK]  frontend/.env já existe' -ForegroundColor Green
}

# ===== Backend deps =====
Write-Section 'Instalando dependências do backend'
Push-Location (Join-Path $repoRoot 'backend')
try {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  npm ci falhou — tentando npm install' -ForegroundColor Yellow
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install do backend falhou' }
    }
} finally { Pop-Location }

# ===== Frontend deps + build =====
Write-Section 'Instalando dependências do frontend'
Push-Location (Join-Path $repoRoot 'frontend')
try {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  npm ci falhou — tentando npm install' -ForegroundColor Yellow
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install do frontend falhou' }
    }

    Write-Section 'Gerando build do frontend (vite build)'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou' }
} finally { Pop-Location }

# ===== Resumo =====
Write-Section 'Instalação concluída'
Write-Host "  Repo:      $repoRoot" -ForegroundColor Green
Write-Host "  Próximos passos:" -ForegroundColor Cyan
Write-Host "    1. Edite backend/.env com as credenciais (se ainda não fez)." -ForegroundColor Gray
Write-Host "    2. Teste manualmente:  cd backend; npm start" -ForegroundColor Gray
Write-Host "       Abra http://localhost:4500" -ForegroundColor Gray
Write-Host "    3. Pra rodar como Windows Service:  .\deploy\service-install.ps1" -ForegroundColor Gray
