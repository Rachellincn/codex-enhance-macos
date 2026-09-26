// Interpret observable outcomes without turning every nonzero process exit into
// a broken Codex tool service. No commands, outputs or credentials are retained.
export function commandBody(value) {
  if (Array.isArray(value)) {
    const index = value.findIndex(v => /^-(?:command|c)$/i.test(String(v)));
    return index >= 0 ? String(value[index + 1] ?? '') : value.map(String).join(' ');
  }
  return String(value ?? '').trim();
}

function diagnosticText(item) {
  const pieces = [typeof item.error === 'string' ? item.error : item.error?.message, item.stderr, item.stdout,
    item.aggregated_output, item.aggregatedOutput];
  for (const part of item.result?.content ?? []) if (part.type === 'text' || part.type === 'Text') pieces.push(part.text);
  return pieces.filter(p => typeof p === 'string').map(p => p.slice(0, 2000) + p.slice(-8000)).join('\n');
}

export function classifyFailure(item, exitCode) {
  const type = String(item.type ?? '').toLowerCase();
  const command = commandBody(item.command);
  const detail = diagnosticText(item);
  const isCommand = type === 'commandexecution';
  const isConnector = /mcp|dynamictoolcall/.test(type);
  const single = command && !/[;\r\n|&]/.test(command);
  const stderr = String(item.stderr ?? '').trim();

  // Only documented, unambiguous single-command outcomes are normalized.
  // Compound shell snippets never inherit the semantics of one embedded command.
  if (isCommand && exitCode === 1 && single && !stderr) {
    if (/^(?:"[^"\r\n]*[\\/]|[^\s"']*[\\/])?rg(?:\.exe)?"?(?:\s|$)/i.test(command))
      return { status: 'completed', severity: 'info', category: 'expected_result', reason: '未找到匹配', detail: '检索正常结束，没有匹配项。', quality: 'available', resultSummary: '未找到匹配' };
    if (/^git(?:\.exe)?\s+diff\b/i.test(command) && /(?:^|\s)--(?:exit-code|quiet)(?:\s|$)/.test(command))
      return { status: 'completed', severity: 'info', category: 'expected_result', reason: '检测到差异', detail: '比较正常完成，退出码 1 表示存在差异。', quality: 'available', resultSummary: '存在差异' };
  }
  if (isConnector && /(?:win(?:32)?error|os error)\D{0,12}267|directory name is invalid|目录名称无效/i.test(detail))
    return { status: 'failed', severity: 'critical', category: 'tool_startup', reason: '工具服务启动失败', detail: '启动目录无效（系统错误 267）；需核对服务路径。仅凭此错误不能确定是更新造成的。' };
  if (isConnector && /spawn.{0,80}ENOENT|failed to (?:start|spawn)|could not (?:start|spawn)|(?:startup|initializ|handshake).{0,60}(?:fail|error)/i.test(detail))
    return { status: 'failed', severity: 'critical', category: 'tool_startup', reason: '工具服务未启动', detail: '调用所需的工具服务启动或初始化失败。' };
  if (isConnector && /unknown tool|method not found/i.test(detail))
    return { status: 'failed', severity: 'error', category: 'tool_capability', reason: '请求的工具不可用', detail: '服务没有提供所请求的工具，不能据此判定整个服务不可用。' };
  if (isConnector && /transport.{0,30}closed|connection (?:closed|refused|reset)|ECONNREFUSED|EPIPE|broken pipe/i.test(detail))
    return { status: 'failed', severity: 'error', category: 'tool_connection', reason: '工具连接不可用', detail: '工具连接已断开，或该服务没有提供所请求的工具。' };
  if (/permission denied|access is denied|unauthorized|forbidden|HTTP\s*(?:401|403)|(?:needs?|requires?).{0,80}scope|权限不足|拒绝访问/i.test(detail))
    return { status: 'failed', severity: 'error', category: 'access', reason: '访问权限不足', detail: '本次操作被目标服务或系统的权限限制阻止，不等于工具服务失效。' };
  if (isCommand && /Could not resolve to a Repository|gh: Not Found \(HTTP 404\)/i.test(detail))
    return { status: 'failed', severity: 'info', category: 'query_unavailable', reason: '查询目标不可见', detail: '查询未取得目标资源；资源可能不存在或当前账户不可见。' };
  if (/timed? out|ETIMEDOUT|请求超时|连接超时/i.test(detail))
    return { status: 'failed', severity: 'warning', category: 'timeout', reason: '调用超时', detail: '调用结果明确报告超时；等待时长本身不会触发这个判断。' };
  if (isCommand) {
    const knownError = /Traceback \(most recent call last\)|(?:ModuleNotFound|FileNotFound|Syntax|Permission)Error|ParserError\s*:|error\s+[A-Z]{1,6}\d+|CMake Error|npm (?:ERR!|error)|^Error:|fatal:|cannot find (?:path|module)|is not recognized|\bWinError\s*\d+|\bos error\s*\d+|无法找到|找不到路径/im.test(detail) || Boolean(item.error);
    if (knownError) return { status: 'failed', severity: 'error', category: 'command_error', reason: '命令执行出错', detail: '命令输出包含明确错误，详情保留原始退出码；不代表 Codex 工具服务失效。' };
    return { status: 'failed', severity: 'info', category: 'unclassified_exit', reason: '非零退出 · 待核实', detail: `记录到退出码 ${exitCode ?? '未知'}，现有输出不足以确定原因。` };
  }
  return { status: 'failed', severity: 'error', category: 'tool_call', reason: '本次调用未成功', detail: '该次调用报告错误；没有足够证据判断整个工具服务是否失效。' };
}
