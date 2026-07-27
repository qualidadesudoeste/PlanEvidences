$ErrorActionPreference = 'Stop'
$runnerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $runnerRoot
try {
    Write-Host 'Instalando dependências do Runner Local...' -ForegroundColor Cyan
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou no Runner Local' }

    Write-Host 'Instalando Chrome for Testing do Playwright MCP...' -ForegroundColor Cyan
    npx --no-install @playwright/mcp install-browser chrome-for-testing
    if ($LASTEXITCODE -ne 0) { throw 'Instalação do navegador do Playwright MCP falhou' }

    if (-not (Test-Path '.env')) {
        Copy-Item '.env.example' '.env'
        Write-Host 'Arquivo runner\.env criado. Informe a URL do PlanEvidences antes de iniciar.' -ForegroundColor Yellow
    }

    Write-Host 'Runner Local instalado.' -ForegroundColor Green
    Write-Host 'Para iniciar:  cd runner; npm start' -ForegroundColor Gray
} finally {
    Pop-Location
}
