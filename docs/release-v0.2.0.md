# Codex Enhance v0.2.0

**看清 Codex 正在做什么，以及哪里需要排查。**

这次把状态浮窗整理成了可直接使用的 Windows 版本：下载、解压、双击即可，无需安装开发环境。

## 下载与使用

下载下方 **CodexEnhance-v0.2.0-win-x64.zip**，完整解压后双击 **Start Codex.cmd**。需要已安装并登录 Windows Codex 桌面客户端。

可选运行 **Install.cmd** 创建桌面快捷方式；**Preview.cmd** 可安全预览示例界面。账号、会话和设置不随发布包分发。

如果 Codex 正在运行，启动入口会保留当前任务。尚未连接时，在方便时正常退出 Codex，再使用新的启动入口即可。

## 更新内容

- **工具可用性检查**：查看 MCP 服务与工具目录，区分目录变化、连接失败和未验证状态。
- **账号额度**：剩余比例、重置倒计时、本机用量与等效金额估算。
- **首字状态**：区分本轮等待、客户端观测与日志记录。
- **用量去重修复**：逐请求账本与 UI 镜像不再重复计算。
- **用户版打包**：自带 Node.js/.NET、可选安装、离线说明、预览和 SHA-256 校验文件。

<img src="https://raw.githubusercontent.com/hrx114514x/codex-enhance/v0.2.0/docs/screenshots/overview.png" width="354" alt="状态浮窗示例" />
<img src="https://raw.githubusercontent.com/hrx114514x/codex-enhance/v0.2.0/docs/screenshots/quota.png" width="430" alt="账号额度示例" />

截图均来自程序原生界面，使用示例数据。等效金额不是官方余额、账单或固定订阅上限；目录已登记不等于调用成功。

## 兼容性

适配 Windows x64 和 `OpenAI.Codex` 程序包。当前二进制未签名，提供 `SHA256SUMS.txt` 供核对。完整冷启动连接、多窗口、多显示器和不同客户端版本仍需更多实机验证；客户端内部结构变化可能影响部分功能。

## 发布验证

包内运行环境通过 64 项 Node 测试、25 项原生状态检查和 7 项启动脚本隔离检查。ZIP 解压、临时目录安装及安装前后文件哈希一致性已验证，现有客户端的只读连接检查通过。启动脚本的全新启动分支使用隔离接口验证，没有为发布测试重启正在运行的 Codex。

详细用法见 [项目首页](https://github.com/hrx114514x/codex-enhance)，问题可在 [Issues](https://github.com/hrx114514x/codex-enhance/issues) 反馈。
