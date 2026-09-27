[CmdletBinding()]
param([string]$InstallDirectory, [switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (!(Test-Path -LiteralPath (Join-Path $sourceDirectory 'CodexEnhance.exe'))) { throw '请从完整解压后的发布包运行 Install.cmd。' }
if (!$InstallDirectory) { $InstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\CodexEnhance' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if ($InstallDirectory -eq [IO.Path]::GetPathRoot($InstallDirectory).TrimEnd('\') -or $sourceDirectory.StartsWith($InstallDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or $sourceDirectory -eq $InstallDirectory) { throw '请选择独立的安装目录。' }
$targetExe = Join-Path $InstallDirectory 'CodexEnhance.exe'
if ((Test-Path -LiteralPath $InstallDirectory) -and @(Get-ChildItem -LiteralPath $InstallDirectory -Force).Count -and !(Test-Path -LiteralPath $targetExe)) { throw '目标目录不为空，且不是已有浮窗安装。请选择空目录。' }
$running = @(Get-Process -Name CodexEnhance -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $targetExe } catch { $true } })
if ($running.Count) { throw '请先在托盘菜单中退出旧版 Codex 状态浮窗，再运行安装。Codex 本身可以保持运行。' }
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Force | Copy-Item -Destination $InstallDirectory -Recurse -Force
if (!$NoShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop 'Codex + 状态浮窗.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDirectory 'scripts\start-codex.ps1') + '"'
    $shortcut.WorkingDirectory = $InstallDirectory
    $shortcut.IconLocation = $targetExe
    $shortcut.Description = '打开 Codex，并连接状态浮窗'
    $shortcut.Save()
    $standalone = $shell.CreateShortcut((Join-Path $desktop 'Codex 状态浮窗.lnk'))
    $standalone.TargetPath = $targetExe
    $standalone.WorkingDirectory = $InstallDirectory
    $standalone.Save()
}
Write-Output "安装完成：$InstallDirectory"
Write-Output '打开桌面的 Codex + 状态浮窗 即可使用。已有设置会保留。'
Write-Output '未改动 Codex 的原始快捷方式、计划任务或运行进程。'
