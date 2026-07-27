param(
    [string]$PlanEvidencesUrl = 'http://136.248.115.65:4500',
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$runnerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $runnerRoot
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot 'downloads'
}

try {
    $planOrigin = ([uri]$PlanEvidencesUrl).GetLeftPart([System.UriPartial]::Authority)
    if (-not $planOrigin.StartsWith('http://') -and -not $planOrigin.StartsWith('https://')) {
        throw
    }
} catch {
    throw 'PlanEvidencesUrl deve ser uma URL HTTP ou HTTPS válida.'
}

$buildRoot = Join-Path $runnerRoot '.package'
$distributionRoot = Join-Path $buildRoot 'distribution'
$payloadRoot = Join-Path $distributionRoot 'payload'
$runtimeRoot = Join-Path $payloadRoot 'runtime'
$browsersRoot = Join-Path $payloadRoot 'browsers'
$outputFile = Join-Path $OutputDirectory 'PlanEvidencesRunner-Windows.zip'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeDirectory = Split-Path -Parent $nodePath
$npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
$npxCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npx-cli.js'
if (-not (Test-Path -LiteralPath $npmCli) -or -not (Test-Path -LiteralPath $npxCli)) {
    throw 'A instalação atual do Node não contém os executáveis internos do npm/npx.'
}

$runnerFull = [System.IO.Path]::GetFullPath($runnerRoot).TrimEnd('\') + '\'
$buildFull = [System.IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
if (-not $buildFull.StartsWith($runnerFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'O diretório temporário do pacote não está dentro da pasta runner.'
}

if (Test-Path -LiteralPath $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $browsersRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Push-Location $runnerRoot
$previousBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
try {
    Write-Host 'Instalando dependências fixadas do Runner...' -ForegroundColor Cyan
    & $nodePath $npmCli ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou ao preparar o Runner.' }

    Write-Host 'Baixando o navegador compatível para dentro do pacote...' -ForegroundColor Cyan
    $env:PLAYWRIGHT_BROWSERS_PATH = $browsersRoot
    & $nodePath $npxCli --no-install @playwright/mcp install-browser chrome-for-testing
    if ($LASTEXITCODE -ne 0) { throw 'A instalação do Chrome for Testing falhou.' }
} finally {
    if ($null -eq $previousBrowsersPath) {
        Remove-Item Env:\PLAYWRIGHT_BROWSERS_PATH -ErrorAction SilentlyContinue
    } else {
        $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowsersPath
    }
    Pop-Location
}

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $runtimeRoot 'node.exe')
$nodeLicense = Join-Path (Split-Path -Parent $nodePath) 'LICENSE'
if (Test-Path -LiteralPath $nodeLicense) {
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtimeRoot 'NODE-LICENSE.txt')
}

Copy-Item -LiteralPath (Join-Path $runnerRoot 'src') -Destination $payloadRoot -Recurse
Copy-Item -LiteralPath (Join-Path $runnerRoot 'node_modules') -Destination $payloadRoot -Recurse
Copy-Item -LiteralPath (Join-Path $runnerRoot 'package.json') -Destination $payloadRoot
Copy-Item -LiteralPath (Join-Path $runnerRoot 'package-lock.json') -Destination $payloadRoot
Copy-Item -LiteralPath (Join-Path $runnerRoot 'start-background.ps1') -Destination $payloadRoot
Copy-Item -LiteralPath (Join-Path $runnerRoot 'start-runner.vbs') -Destination $payloadRoot
Copy-Item -LiteralPath (Join-Path $runnerRoot 'installer\Instalar Runner.cmd') -Destination $distributionRoot
Copy-Item -LiteralPath (Join-Path $runnerRoot 'installer\install-portable.ps1') -Destination $distributionRoot

$envContent = @(
    "PLAN_EVIDENCES_URL=$planOrigin"
    'RUNNER_PORT=4317'
    'RUNNER_HEADLESS=true'
    'RUNNER_MAX_STEPS=35'
)
[System.IO.File]::WriteAllLines(
    (Join-Path $payloadRoot '.env'),
    [string[]]$envContent,
    (New-Object System.Text.UTF8Encoding($false))
)

if (Test-Path -LiteralPath $outputFile) {
    Remove-Item -LiteralPath $outputFile -Force
}
Write-Host 'Compactando o pacote distribuível...' -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $distributionRoot '*') -DestinationPath $outputFile -CompressionLevel Optimal

Write-Host "Pacote pronto: $outputFile" -ForegroundColor Green
Write-Host 'Os QAs baixam o ZIP, extraem e dão dois cliques em "Instalar Runner.cmd".' -ForegroundColor Green
