# 当前模型

浮窗底部直接显示模型名，例如 **GPT-6 Sol**。优先使用本轮最近已完成响应返回的模型；没有响应记录时显示本轮任务使用的模型。

悬停可看数据来源与选定模型；点击可看请求模型、来源、时间及最近响应。显示不同名字仅说明返回标识不同，不直接判定灰测、降级或后台权重变化。

## 数据范围

- 读取已有本地 Responses SSE 诊断记录，只接受有本轮标识和响应 ID、状态为 `completed` 的响应。优先使用 `response.headers` / 顶层 `headers` 中的 `openai-model` 或 `x-openai-model`，其次使用 `response.model`。
- 同一响应的早期元数据须等到对应响应完成才会展示；预热、内部压缩和未完成响应不作为识别结果。
- 客户端明确报告的模型重路由只放在详情中，不冒充已完成响应。
- 任务配置、模型选择器、普通日志中的 `model=` 和回复中的自我介绍都不会用作上游模型证据。

**当前 Windows Codex 的默认记录通常不包含这类响应标识，使用 WebSocket 的任务也可能无法取得。** 此时主界面正常显示任务模型，悬停提示来源为任务设置，不宣称已验证上游。本功能不会开启全量日志、抓包、修改请求或额外调用模型，不能保证发现隐藏灰测。

识别结果按任务和轮次隔离，不把上一轮模型带到新一轮；只保留少量模型名、时间和响应 ID，不复制完整响应正文或请求头。

字段口径参考 [OpenAI Responses](https://developers.openai.com/api/reference/typescript/resources/responses/methods/retrieve) 和 [Codex Responses 解析](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)。
