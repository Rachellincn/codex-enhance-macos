[CmdletBinding()]
param([switch]$Development, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$sdkExe = Join-Path $env:LOCALAPPDATA 'CodexEnhance\sdk\dotnet.exe'
if (!(Test-Path -LiteralPath $sdkExe)) {
    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    if (!$dotnetCommand) { throw 'Install the .NET 10 SDK, then run this script again.' }
    $sdkExe = $dotnetCommand.Source
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
if ($Development) { & $sdkExe build (Join-Path $projectRoot 'src\CodexEnhance.csproj') -c Release --nologo }
else {
    & $sdkExe publish (Join-Path $projectRoot 'src\CodexEnhance.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -p:DebugType=None -p:DebugSymbols=false -o $OutputDirectory --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
    foreach ($obsolete in @('collector\search.mjs','collector\search-worker.mjs','assets\icons\search.svg')) {
        $obsoletePath = Join-Path $OutputDirectory $obsolete
        if (Test-Path -LiteralPath $obsoletePath) { Remove-Item -LiteralPath $obsoletePath -Force }
    }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $nodeInfo = & $nodeExe -p 'JSON.stringify({version:process.versions.node,arch:process.arch})' | ConvertFrom-Json
    if ([int]$nodeInfo.version.Split('.')[0] -lt 24 -or $nodeInfo.arch -ne 'x64') { throw 'Packaging requires Node.js 24+ for x64.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $OutputDirectory 'runtime') | Out-Null
    Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $OutputDirectory 'runtime\node.exe')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $OutputDirectory 'THIRD_PARTY_NOTICES.md')
}
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
