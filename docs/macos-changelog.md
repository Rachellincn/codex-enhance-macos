# macOS release history / macOS 更新记录

## v0.4.0-mac.4 — 2026-10-03

- 集成 codex-enhance v0.4.0（`f55ee83`）采集层，新增 SwiftUI / AppKit 原生 Mac 浮窗与菜单栏。
- 完善本地模型价格表、Fast / 长上下文规则与账号额度折算；`codex-auto-review` 保留明确的本地价格映射。
- 增加当前窗口任务跟随、固定观察及本轮工具调用状态、耗时和诊断详情。
- 加入只读 app-server 额度刷新、每周历史和持久化。
- 发布 Apple Silicon DMG、SHA-256 校验、中文和英文 README，运行时内置 Node.js。
- 价格目录更新指向本仓库，保留 Mac 扩展配置。最低系统版本按内置 Node 的实际要求设为 macOS 13.5。
- 安装包为 ad-hoc 签名，未做 Apple Developer ID 签名或公证。

English: native Mac interface and menu bar; expanded local pricing and quota estimates; current-window tool-call status, duration and diagnostics; read-only quota refresh and weekly history; Apple Silicon DMG with bundled Node.js, bilingual documentation and SHA-256 checksums. Requires macOS 13.5+. Ad-hoc signed, not notarized.
