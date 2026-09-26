# Codex Enhance · Codex 状态浮窗

面向 Windows Codex 桌面客户端的原生 WPF 状态浮窗。作为 Codex 的附属窗口显示，随 Codex 遮挡、移动和最小化，切换其他应用不主动隐藏或改变展开状态；支持收起、拖动、固定观察任务和系统深浅色。这是独立的社区项目。

工具调用统一为一个分组：日常记录保持收起，**仅 Critical 自动展开**；手动收起后同一提示不反复顶开。显示上下文最近采样、最近请求缓存命中、本轮计时，并可打开性能详情及调用记录。

## 构建与安装

要求 Windows x64、Node.js 24+ 和 .NET 10 SDK。构建脚本会将本机 Node 可执行文件及 .NET 运行环境放入 `dist/`。

```powershell
git clone https://github.com/hrx114514x/codex-enhance.git
cd codex-enhance
npm test
.\scripts\build.ps1
.\scripts\install.ps1 -SkipStartupIntegration
```

采集层只使用 Node 内置模块，无需 `npm install`。安装后从桌面快捷方式打开浮窗，也可以直接运行 `dist\CodexEnhance.exe`。更新已运行的浮窗前先从其托盘退出，再运行安装脚本。

`-SkipStartupIntegration` 安装浮窗和快捷方式，不接入特定启动器。未启用本地 CDP 时，可以点击任务名手动选择本地任务，指标来自日志；自动跟随与实时调用状态需要下述连接配置。

## 使用

- 桌面快捷方式：**Codex 状态浮窗**。
- 程序：`%LOCALAPPDATA%\Programs\CodexEnhance\CodexEnhance.exe`。
- 设置与诊断：`%LOCALAPPDATA%\CodexEnhance`。
- 点击任务名选择本地任务；底部“跟随对话”控制是否随 Codex 页面切换，关闭后显示“固定此对话”。这个开关只控制观察对象，不控制置顶；原图钉已移除。右键可查看详情、切换主题或退出，托盘也可隐藏和退出。
- 上下文/缓存区域可点击，打开详细指标。工具调用行可展开/收起；异常详情中的“查看全部调用”显示历史。
- 主面板显示“首字（日志）”：采用 `time_to_first_token_ms`。本轮尚无完成记录时，明确标为“最近记录”，展示最近有该字段的完成轮次；完全缺失则显示“—”，不使用整轮耗时替代，也不声称是屏幕实际首字时间。
- 外层浮窗的展开状态和位置保存；异常的临时展开不会覆盖用户偏好。

## 自动跟随

浮窗通过本机 CDP 连接识别当前任务及实时调用状态，通过本地会话日志恢复历史指标。客户端需要在正常启动时启用仅监听 `127.0.0.1` 的调试端口，例如启动参数 `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9336`。

采集器会尝试端口 9336、9335、9222，以及 `%APPDATA%\Codex\DevToolsActivePort`。自定义端口可写入 `%LOCALAPPDATA%\CodexEnhance\connection.json`，内容为 `{"port":9336}`。端口应仅供本机使用。

如果已有兼容的 `%LOCALAPPDATA%\OpenAI\CodexTools\Start-CodexToTray.ps1` 启动器，可运行 `.\scripts\install.ps1` 接入启动流程。脚本检查原有启动方法、保存备份、添加本地 CDP 参数并启动浮窗；它不创建管理员计划任务，也不重启现有 Codex。缺少该启动器时请使用 `-SkipStartupIntegration`。

普通 AppsFolder 入口不会自动附加这些参数。未连接时明确显示待连接；客户端结构更新导致不可识别时显示未知，可继续手动选任务。当前适配依赖客户端内部结构，多窗口、多显示器行为仍需进一步实机验证。

## 指标口径

- 上下文：最近 `token_count` 的 `last_token_usage.total_tokens / model_context_window` 估算，显示采样口径，和累计消耗分开。
- 缓存：最近请求 `cached_input_tokens / input_tokens`；输入分母缺失或为零显示未知。
- 首 token：使用日志里的 `time_to_first_token_ms`，缺失显示未知，不冒充屏幕首字延迟。
- 工具执行状态和结果质量分开。`read_thread` 的空轮只提示核查；无输出的成功命令、写入操作不因此判失败。等待较久不自动等同超时。
- 分级：Info 为普通结果或原因未明的非零退出，只记录；Warning 为缺失/可疑内容或明确超时；Error 为明确执行失败、权限拒绝等；Critical 限于有明确证据的工具服务启动/初始化故障。
- Info / Warning / Error 只在手动展开的记录里分级呈现，主面板保持中性计数；Critical 才突出并自动展开。同一提示不反复弹开，升级到 Critical 时会提示一次。明确恢复后会撤销对应服务故障。
- 单条、无错误输出的 `rg` 退出码 1（无匹配）和 `git diff --exit-code/--quiet` 退出码 1（有差异）按 Info 处理；复合命令不会套用其中一个子命令的退出码语义。原始退出码保留在详情。
- 等级只针对已观察到的调用证据；工具完全未注册、没有产生日志时未必能形成调用记录。没有告警不等于所有工具服务都已检查。
- 本轮历史异常不表示 Codex 程序本身故障；相同类别合并显示，完整记录可展开查看。
- 初次打开较长任务时会增量载入历史；未追平之前不把历史片段当成新异常自动展开。

## 性能与卡慢线索

点击上下文/缓存区域，可查看当前阶段、距上次可见进度变化、距最近日志、首 token 与同模型/思考强度下近 5 轮中位数、压缩耗时及服务端压缩进度。

工具执行中、等待确认、压缩中和暂时没有可见进度分别显示。大上下文与低缓存、首 token 相对升高、结束后缺少可见回复记录，只作为核查线索，不自动判为 Critical，也不自动压缩、重试或重启 Codex。不能单凭这些数据分离模型计算、服务端排队和界面渲染耗时。

## 精简版交互

- 主卡片并列显示上下文、缓存、首字；额外区分采集是否实时以及距可见进度变化的时间。
- 性能详情实时刷新，加入最近 8 轮相同模型和强度的首 token 趋势；缺失指标保留为空，不填零或估算。
- 调用记录支持本轮、需关注、最近记录筛选；只有 Critical 主动展开。
- 更多菜单提供连接与诊断、重连、恢复默认位置和主题选择；收起状态也可拖动。
- 诊断摘要通过字段白名单生成，不导出对话正文、标题、命令、路径或账号凭据。
- 已移除独立搜索，使用 Codex 官方搜索。更新清理本工具的旧搜索缓存，不改 Codex 历史数据库。

## 数据与隐私

采集器读取 `CODEX_HOME`（默认 `%USERPROFILE%\.codex`）中的任务元数据与会话日志，通过标准输入输出向 WPF 界面发送状态。运行时连接仅访问本机 CDP，不向外部服务上传会话内容。自身设置保存在 `%LOCALAPPDATA%\CodexEnhance`，诊断导出使用字段白名单。

仓库不包含本机日志、会话记录、运行截图、安装包或个人交接笔记。第三方来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 开发与验证

```powershell
npm test
.\scripts\build.ps1
.\dist\CodexEnhance.exe --self-test .\artifacts\ui-state-tests.json
.\dist\CodexEnhance.exe --preview --attention
.\dist\CodexEnhance.exe --render .\artifacts\renders
```

`--preview` 明确显示示例数据，不读实时任务。`--render` 输出原生 WPF 渲染图用于视觉 QA。安装脚本不重启现有 Codex；恢复启动器可运行 `scripts/restore-launcher.ps1`，若启动器后续又被修改则拒绝覆盖。

源码结构：`src/` 为 WPF 窗口与交互，`collector/` 为 Node 采集层，`tests/` 为隔离测试，`scripts/` 为构建、安装和启动器恢复脚本。
