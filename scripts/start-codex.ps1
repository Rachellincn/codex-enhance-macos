[CmdletBinding()]
param([switch]$Check, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'

function Show-LaunchMessage([string]$Message) {
    if ($NonInteractive) { Write-Output $Message; return }
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($Message, 'Codex Enhance')
}

try {
    $appRoot = Split-Path -Parent $PSScriptRoot
    $companion = Join-Path $appRoot 'CodexEnhance.exe'
    if (!(Test-Path -LiteralPath $companion)) { $companion = Join-Path $appRoot 'dist\CodexEnhance.exe' }
    if (!(Test-Path -LiteralPath $companion)) { throw '请先完整解压下载包，再打开 Start Codex.cmd。' }
    $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if (!$package) { throw '未找到当前用户安装的 Windows Codex 桌面客户端。请先安装并登录 Codex。' }
    $codexExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if (!(Test-Path -LiteralPath $codexExe)) { throw '当前 Codex 安装结构暂不支持此启动入口。可直接打开 CodexEnhance.exe 手动选择任务。' }
    $existing = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {
        $_.ExecutablePath -like '*OpenAI.Codex*' -and $_.CommandLine -notmatch '(?:^|\s)--type='
    })
    # If an elevated process cannot be inspected, do not launch another instance.
    $uninspectable = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object { !$_.ExecutablePath -or !$_.CommandLine })
    if (!$existing.Count -and $uninspectable.Count) { throw '有正在运行但无法读取状态的客户端。请正常退出 Codex 后再使用此入口；现有进程未被关闭。' }
    $stateDirectory = Join-Path $env:LOCALAPPDATA 'CodexEnhance'
    $ports = @(9336, 9335, 9222)
    $connectionFile = Join-Path $stateDirectory 'connection.json'
    if (Test-Path -LiteralPath $connectionFile) {
        try { $configuredPort = [int](Get-Content -LiteralPath $connectionFile -Raw | ConvertFrom-Json).port; if ($configuredPort -ge 1024 -and $configuredPort -le 65535) { $ports = @($configuredPort) + $ports } } catch {}
    }
    $devtoolsFile = Join-Path $env:APPDATA 'Codex\DevToolsActivePort'
    if (Test-Path -LiteralPath $devtoolsFile) {
        try { $appPort = [int](Get-Content -LiteralPath $devtoolsFile -TotalCount 1); if ($appPort -ge 1024 -and $appPort -le 65535) { $ports = @($appPort) + $ports } } catch {}
    }
    $connectedPort = 0
    foreach ($port in ($ports | Select-Object -Unique)) {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1
            if (@($targets | Where-Object { $_.url -match '^app://[^/]*/index\.html(?:\?|$)' -and $_.url -notmatch 'initialRoute=' -and $_.webSocketDebuggerUrl -like 'ws://127.0.0.1:*' }).Count) { $connectedPort = $port; break }
        } catch {}
    }
    if ($Check) {
        [pscustomobject]@{ Package = $package.Name; Version = $package.Version.ToString(); ExistingClient = [bool]$existing.Count; ConnectedPort = $connectedPort; Action = $(if ($existing.Count) { 'Keep existing client; start companion' } else { 'Launch registered client with loopback CDP; start companion' }) }
        return
    }
    if ($existing.Count) {
        Start-Process -FilePath $companion -WindowStyle Hidden
        if (!$connectedPort) { Show-LaunchMessage 'Codex 已在运行，浮窗已打开。要启用自动跟随、工具目录与账号额度，请先保存工作并正常退出 Codex，再双击 Start Codex.cmd。本工具不会替你结束正在进行的任务。' }
        return
    }
    $launchPort = 0
    foreach ($candidate in 9336..9350) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start(); $launchPort = $candidate; break } catch {} finally { $listener.Stop() }
    }
    if (!$launchPort) { throw '未找到可用的本机连接端口（9336–9350）。' }
    $arguments = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $launchPort
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ([Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { $arguments += ' --do-not-de-elevate' }
    Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId 'App' -Command $codexExe -Args $arguments -PreventBreakaway
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    @{ port = $launchPort } | ConvertTo-Json | Set-Content -LiteralPath $connectionFile -Encoding UTF8
    Start-Process -FilePath $companion -WindowStyle Hidden
} catch {
    if ($Check -or $NonInteractive) { throw }
    Show-LaunchMessage $_.Exception.Message
    exit 1
}
