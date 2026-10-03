# macOS 使用说明

本项目集成自 [codex-enhance](https://github.com/hrx114514x/codex-enhance)，使用原生 SwiftUI / AppKit 界面与 Node.js 采集层。发行版支持 macOS 13.5+、Apple Silicon arm64，内置 Node.js 24+。

## 安装与升级

从 [Release](https://github.com/Rachellincn/codex-enhance-macos/releases/latest) 下载 DMG，将 App 拖入“应用程序”，弹出安装磁盘后启动。更新前使用 `⌘Q` 退出旧版，再替换 App。当前包采用 ad-hoc 签名，未做 Developer ID 签名或公证；首次启动如受系统拦截，可在确认来源后使用“系统设置 → 隐私与安全性 → 仍要打开”。

## 三个选项卡

- **计算明细**：Astra 长上下文 / Fast 折算开关、普通计价、加价组成、API 等效金额和计算公式。开关保存在本机。
- **每周历史**：额度 / tokens / API 等效金额图表，按账号重置周期保留最近 26 周；没有实际观测的周期不补造百分比。
- **当前窗口**：自动跟随或固定观察、任务名、模型、effort、阶段、上下文、缓存和本轮工具调用。成功、失败、执行中、已中断、待确认分别显示，提供耗时和诊断原因；悬停查看可用详情，最多展示 40 条。

顶部可切换深浅色、置顶或收起。关闭窗口后可从菜单栏图标恢复；`⌘Q` 完全退出。

## 连接与离线

额度通过已安装客户端 / CLI 的 app-server 只读接口独立读取，每 60 秒刷新。“刷新额度”可立即重试，无需 CDP，不启动模型任务、不重新登录。

点击“连接…”并在保存工作、等待任务结束后确认正常重启客户端，请求仅绑定 `127.0.0.1` 的 CDP 端口（9336–9350）。连接助手最多等待 120 秒，不强制结束进程。支持 `Codex.app` 和包含 Codex Framework 的 `ChatGPT.app`；是否接受参数、是否公开兼容的内部状态，以连接状态为准。

自动跟随不可用时显示“本地记录”，临时展示最近更新的任务，恢复连接后重新跟随。下拉框可固定观察，选择“自动跟随当前页面”恢复自动。多个窗口时需核对选中任务。断线后仍可查看上次已确认账号的缓存历史，并标注离线。

## 价格、状态与隐私

数据位于 `~/Library/Application Support/CodexEnhance`；只读访问 `$CODEX_HOME`（默认 `~/.codex`）的任务库和日志。价格目录从本仓库公开 JSON 更新，不发送任务、账号或用量内容。

`codex-auto-review` 使用本地指定的 `gpt-5.6-terra` 计价规则，原始模型名保留，并非官方公布价格。API 等效金额不是官方余额或账单，不含其他设备及语音用量。模型未定价、索引未完成、采样不足或记录不完整时显示“—”及原因。

## 开发

安装 Xcode Command Line Tools 和独立 Node.js 24+，执行：

```bash
npm test
NODE_BINARY=/absolute/path/to/node npm run build:mac
open "dist/Codex Enhance.app"
NODE_BINARY=/absolute/path/to/node npm run package:mac
```

源代码还提供 `Start Codex.command`：正常退出客户端后可用该脚本请求调试连接，需先构建 `dist/Codex Enhance.app`。安装版可直接使用浮窗“连接…”按钮。

构建只生成本机架构，打包拒绝非系统动态库依赖。完整功能、模型价格表及校验方式见 [中文 README](../README.md) 和 [English README](../README.en.md)。
