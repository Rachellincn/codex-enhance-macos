# 开发

需要 Windows、Node.js 24+（x64）与 .NET 10 SDK。采集层只使用 Node 内置模块，无需安装 npm 依赖。

```powershell
git clone https://github.com/hrx114514x/codex-enhance.git
cd codex-enhance
npm test
.\scripts\build.ps1
.\dist\CodexEnhance.exe --self-test .\artifacts\ui-state-tests.json
.\dist\CodexEnhance.exe --render .\artifacts\renders
.\scripts\package.ps1
```

`--preview` 以示例数据打开界面，`--render` 导出原生截图与界面状态检查。`package.ps1` 在独立目录中构建 Windows ZIP 和 SHA-256 校验文件。

| 目录 | 内容 |
| --- | --- |
| `src/` | WPF 界面、窗口管理和交互 |
| `collector/` | 本地日志、客户端状态与用量采集 |
| `tests/` | 隔离测试 |
| `scripts/` | 构建、安装、启动与发布打包 |
| `packaging/` | 用户版入口和离线说明 |

## 本地连接

自动跟随依赖客户端的本机 CDP 连接。发布包启动器使用注册的 Windows 程序包上下文，绑定 `127.0.0.1`，保留已经运行的客户端。

已有专用 `Codex Start To Tray` 启动器的环境可使用 `scripts/install.ps1`；`-SkipStartupIntegration` 可只安装浮窗。恢复原启动器使用 `scripts/restore-launcher.ps1`。

客户端内部结构可能变化，无法识别时应显示未知。指标与状态的实现边界见 [metrics.md](metrics.md)。
