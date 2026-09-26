$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexEnhance'
$record = Get-Content -LiteralPath (Join-Path $stateRoot 'integration.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $record.launcher -Algorithm SHA256).Hash -ne $record.patchedSha256) {
    throw 'Launcher has changed since installation. Original retained; review instead of overwriting newer changes.'
}
Copy-Item -LiteralPath $record.original -Destination $record.launcher -Force
Write-Output 'Original launcher restored. Current Codex process was not modified.'
