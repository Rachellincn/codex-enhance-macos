[CmdletBinding()]
param([string]$SeedThreadId, [switch]$SkipStartupIntegration)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\CodexEnhance'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexEnhance'
$distribution = Join-Path $projectRoot 'dist'
if (!(Test-Path -LiteralPath (Join-Path $distribution 'CodexEnhance.exe'))) { throw 'Run scripts/build.ps1 first.' }
New-Item -ItemType Directory -Force -Path $installRoot,$stateRoot | Out-Null
Get-ChildItem -LiteralPath $distribution -Force | Copy-Item -Destination $installRoot -Recurse -Force
# Remove only obsolete files owned by this companion; never touch Codex history databases.
foreach ($obsolete in @('collector\search.mjs','collector\search-worker.mjs','assets\icons\search.svg')) {
    $obsoletePath = Join-Path $installRoot $obsolete
    if (Test-Path -LiteralPath $obsoletePath) { Remove-Item -LiteralPath $obsoletePath -Force }
}
foreach ($cacheName in @('conversation-search.sqlite','conversation-search.sqlite-wal','conversation-search.sqlite-shm')) {
    $cachePath = Join-Path $stateRoot $cacheName
    if (Test-Path -LiteralPath $cachePath) { Remove-Item -LiteralPath $cachePath -Force }
}
$exe = Join-Path $installRoot 'CodexEnhance.exe'
$settingsPath = Join-Path $stateRoot 'settings.json'
if (!(Test-Path -LiteralPath $settingsPath)) {
    [ordered]@{ expanded=$false; followMode=$true; manualThreadId=$SeedThreadId; lockedThreadId=$null; theme='system'; rightOffset=22; topOffset=$null } |
        ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex 状态浮窗.lnk'))
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $installRoot
$shortcut.Description = '查看当前 Codex 任务的运行、上下文与工具状态'
$shortcut.Save()

if (!$SkipStartupIntegration) {
    $launcher = Join-Path $env:LOCALAPPDATA 'OpenAI\CodexTools\Start-CodexToTray.ps1'
    if (!(Test-Path -LiteralPath $launcher)) { throw 'Existing packaged administrator launcher is missing; installation remains available via its own shortcut.' }
    $content = Get-Content -LiteralPath $launcher -Raw
    if ($content -notmatch '# CodexEnhance integration') {
        $needle = '$arguments = ''--do-not-de-elevate'''
        if (!$content.Contains($needle) -or !$content.Contains('Invoke-CommandInDesktopPackage')) { throw 'Existing launcher changed; refusing to replace its launch method.' }
        $backup = Join-Path $stateRoot 'launcher-original.ps1'
        if (!(Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $launcher -Destination $backup }
        $replacement = @'
# CodexEnhance integration: preserve package identity and existing administrator token.
        $enhancePort = 0
        foreach ($candidatePort in 9336..9350) {
            $probeListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidatePort)
            try { $probeListener.Start(); $enhancePort = $candidatePort; break } catch {} finally { $probeListener.Stop() }
        }
        $arguments = '--do-not-de-elevate'
        if ($enhancePort -gt 0 -and !$VerificationUserDataDirectory) {
            $arguments += ' --remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $enhancePort
            $enhanceState = Join-Path $env:LOCALAPPDATA 'CodexEnhance'
            New-Item -ItemType Directory -Force -Path $enhanceState | Out-Null
            @{port=$enhancePort} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $enhanceState 'connection.json') -Encoding UTF8
        }
'@
        $content = $content.Replace($needle, $replacement.TrimEnd())
        $marker = '    [pscustomobject]@{'
        $index = $content.IndexOf($marker, [StringComparison]::Ordinal)
        if ($index -lt 0) { throw 'Launcher result marker was not found.' }
        $startCompanion = @'
    # CodexEnhance companion uses the same successful launch lifecycle.
    $enhanceExe = Join-Path $env:LOCALAPPDATA 'Programs\CodexEnhance\CodexEnhance.exe'
    if (!$VerificationUserDataDirectory -and (Test-Path -LiteralPath $enhanceExe)) {
        Start-Process -FilePath $enhanceExe -WindowStyle Hidden
    }
'@
        $content = $content.Insert($index, $startCompanion + [Environment]::NewLine)
        $tokens = $null; $parseErrors = $null
        [void][Management.Automation.Language.Parser]::ParseInput($content, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) { throw ('Patched launcher did not parse: ' + $parseErrors[0].Message) }
        Set-Content -LiteralPath $launcher -Value $content -Encoding UTF8
        @{launcher=$launcher; original=$backup; patchedSha256=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash} |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot 'integration.json') -Encoding UTF8
    }
}
Write-Output "Installed: $exe"
Write-Output 'The existing Codex process was preserved. The companion reconnects to an available local debugging port; initial setup takes effect at the next normal Codex launch.'
