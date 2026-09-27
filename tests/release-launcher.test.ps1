param([Parameter(Mandatory=$true)][string]$LauncherPath, [Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
$savedLocal = $env:LOCALAPPDATA
$savedRoaming = $env:APPDATA
$global:launchCalls = [Collections.Generic.List[object]]::new()
$global:packageCalls = [Collections.Generic.List[object]]::new()
$global:mockExisting = $true
$global:mockConnected = $true
$global:mockPackage = Join-Path $FixtureDirectory 'OpenAI.Codex_test'
New-Item -ItemType Directory -Path (Join-Path $global:mockPackage 'app') -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $global:mockPackage 'app\ChatGPT.exe') -Force | Out-Null
function Get-AppxPackage { param($Name) [pscustomobject]@{ Name='OpenAI.Codex'; Version=[version]'1.0.0'; InstallLocation=$global:mockPackage; PackageFamilyName='OpenAI.Codex_test' } }
function Get-CimInstance {
    param($ClassName, $Filter)
    if ($global:mockExisting) { [pscustomobject]@{ ExecutablePath=(Join-Path $global:mockPackage 'app\ChatGPT.exe'); CommandLine='ChatGPT.exe'; ProcessId=1234 } }
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    if (!$global:mockConnected) { throw 'Fixture endpoint unavailable' }
    @([pscustomobject]@{ url='app://codex/index.html'; webSocketDebuggerUrl='ws://127.0.0.1:9336/devtools/page/example' })
}
function Start-Process { param($FilePath, $WindowStyle) $global:launchCalls.Add([pscustomobject]@{FilePath=$FilePath;WindowStyle=$WindowStyle}) }
function Invoke-CommandInDesktopPackage {
    param($PackageFamilyName, $AppId, $Command, [Alias('Args')]$PackageArguments, [switch]$PreventBreakaway)
    $global:packageCalls.Add([pscustomobject]@{Family=$PackageFamilyName;Arguments=$PackageArguments;PreventBreakaway=[bool]$PreventBreakaway})
}
function Assert($condition, $message) { if (!$condition) { throw $message } }
try {
    $env:LOCALAPPDATA = Join-Path $FixtureDirectory 'local'
    $env:APPDATA = Join-Path $FixtureDirectory 'roaming'
    & $LauncherPath -NonInteractive
    Assert ($global:launchCalls.Count -eq 1 -and $global:packageCalls.Count -eq 0) 'Existing client must not be relaunched.'
    Assert ($global:launchCalls[0].WindowStyle -eq 'Hidden') 'Companion launch must be hidden.'
    $global:launchCalls.Clear()
    $global:mockExisting = $false
    $global:mockConnected = $false
    & $LauncherPath -NonInteractive
    Assert ($global:packageCalls.Count -eq 1 -and $global:launchCalls.Count -eq 1) 'Fresh branch must request packaged launch plus companion.'
    Assert ($global:packageCalls[0].Arguments -match '--remote-debugging-address=127.0.0.1 --remote-debugging-port=(933[6-9]|934[0-9]|9350)') 'CDP must bind to loopback.'
    Assert ($global:packageCalls[0].PreventBreakaway) 'Package identity must be retained.'
    $connection = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexEnhance\connection.json') -Raw | ConvertFrom-Json
    Assert ($connection.port -ge 9336 -and $connection.port -le 9350) 'Saved port must match the supported range.'
    $global:launchCalls.Clear(); $global:packageCalls.Clear()
    $null = & $LauncherPath -Check
    Assert ($global:launchCalls.Count -eq 0 -and $global:packageCalls.Count -eq 0) 'Check mode must not launch anything.'
    Write-Output 'Launcher verification: 7 checks passed with isolated process/API fixtures.'
} finally {
    $env:LOCALAPPDATA = $savedLocal
    $env:APPDATA = $savedRoaming
}
