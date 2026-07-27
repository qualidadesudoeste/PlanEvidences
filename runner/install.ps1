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
        Write-Host 'Arquivo runner\.env criado.' -ForegroundColor Green
    }
    $envLines = Get-Content -LiteralPath '.env'
    $headlessFound = $false
    $envLines = $envLines | ForEach-Object {
        if ($_ -match '^RUNNER_HEADLESS=') {
            $headlessFound = $true
            'RUNNER_HEADLESS=true'
        } else {
            $_
        }
    }
    if (-not $headlessFound) {
        $envLines += 'RUNNER_HEADLESS=true'
    }
    [System.IO.File]::WriteAllLines(
        (Join-Path $runnerRoot '.env'),
        [string[]]$envLines,
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-Host 'Configurando inicialização automática com o Windows...' -ForegroundColor Cyan
    $startupFolder = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startupFolder 'PlanEvidences Runner Local.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerRoot\start-background.ps1`""
    $shortcut.WorkingDirectory = $runnerRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Inicia o Runner Local do PlanEvidences'
    $shortcut.Save()

    Write-Host 'Iniciando o Runner Local em segundo plano...' -ForegroundColor Cyan
    & (Join-Path $runnerRoot 'start-background.ps1')

    Write-Host 'Runner Local instalado, iniciado e configurado para abrir com o Windows.' -ForegroundColor Green
    Write-Host 'Não é necessário manter um terminal aberto.' -ForegroundColor Gray
} finally {
    Pop-Location
}
