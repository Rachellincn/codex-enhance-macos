[CmdletBinding()]
param([switch]$Development)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkExe = Join-Path $env:LOCALAPPDATA 'CodexEnhance\sdk\dotnet.exe'
if (!(Test-Path -LiteralPath $sdkExe)) {
    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    if (!$dotnetCommand) { throw 'Install the .NET 10 SDK, then run this script again.' }
    $sdkExe = $dotnetCommand.Source
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
if ($Development) { & $sdkExe build (Join-Path $projectRoot 'src\CodexEnhance.csproj') -c Release --nologo }
else {
    & $sdkExe publish (Join-Path $projectRoot 'src\CodexEnhance.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o (Join-Path $projectRoot 'dist') --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
    foreach ($obsolete in @('collector\search.mjs','collector\search-worker.mjs','assets\icons\search.svg')) {
        $obsoletePath = Join-Path (Join-Path $projectRoot 'dist') $obsolete
        if (Test-Path -LiteralPath $obsoletePath) { Remove-Item -LiteralPath $obsoletePath -Force }
    }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist\runtime') | Out-Null
    Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $projectRoot 'dist\runtime\node.exe')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $projectRoot 'dist\THIRD_PARTY_NOTICES.md')
}
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
