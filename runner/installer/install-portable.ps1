$ErrorActionPreference = 'Stop'

function Assert-SafeInstallPath([string]$basePath, [string]$targetPath) {
    $baseFull = [System.IO.Path]::GetFullPath($basePath).TrimEnd('\') + '\'
    $targetFull = [System.IO.Path]::GetFullPath($targetPath).TrimEnd('\') + '\'
    if (-not $targetFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'O diretório de instalação calculado não está dentro do perfil local do usuário.'
    }
}

$payloadRoot = Join-Path $PSScriptRoot 'payload'
if (-not (Test-Path -LiteralPath (Join-Path $payloadRoot 'runtime\node.exe'))) {
    throw 'Pacote inválido: o runtime do Runner não foi encontrado.'
}
if (-not (Test-Path -LiteralPath (Join-Path $payloadRoot '.env'))) {
    throw 'Pacote inválido: a configuração do PlanEvidences não foi encontrada.'
}

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$installRoot = Join-Path $localAppData 'PlanEvidencesRunner'
Assert-SafeInstallPath $localAppData $installRoot

$runnerPort = 4317
$portLine = Get-Content -LiteralPath (Join-Path $payloadRoot '.env') |
    Where-Object { $_ -match '^RUNNER_PORT=\d+$' } |
    Select-Object -First 1
if ($portLine) {
    $runnerPort = [int]($portLine -replace '^RUNNER_PORT=', '')
}

Write-Host 'Preparando o PlanEvidences Runner...' -ForegroundColor Cyan
$listeners = Get-NetTCPConnection -LocalPort $runnerPort -State Listen -ErrorAction SilentlyContinue
foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    $processPath = $process.Path
    if (
        $processPath -and
        [System.IO.Path]::GetFullPath($processPath).StartsWith(
            [System.IO.Path]::GetFullPath($installRoot),
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        Stop-Process -Id $processId -Force
    } else {
        throw "A porta local $runnerPort está sendo usada por outro programa. Feche-o e tente novamente."
    }
}

if (Test-Path -LiteralPath $installRoot) {
    Assert-SafeInstallPath $localAppData $installRoot
    Remove-Item -LiteralPath $installRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item -Path (Join-Path $payloadRoot '*') -Destination $installRoot -Recurse -Force

$shell = New-Object -ComObject WScript.Shell
$startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'PlanEvidences Runner.lnk'
$shortcut = $shell.CreateShortcut($startupShortcut)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = "`"$(Join-Path $installRoot 'start-runner.vbs')`""
$shortcut.WorkingDirectory = $installRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Inicia o PlanEvidences Runner com o Windows'
$shortcut.Save()

Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') `
    -ArgumentList "`"$(Join-Path $installRoot 'start-runner.vbs')`"" `
    -WindowStyle Hidden

Start-Sleep -Seconds 3
$started = Get-NetTCPConnection -LocalPort $runnerPort -State Listen -ErrorAction SilentlyContinue
if (-not $started) {
    throw "O Runner foi instalado, mas não iniciou na porta $runnerPort. Consulte $installRoot\logs\runner-error.log."
}

Write-Host "Runner instalado em $installRoot." -ForegroundColor Green
Write-Host 'Ele já está ativo e iniciará automaticamente com o Windows.' -ForegroundColor Green
