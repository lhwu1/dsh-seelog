import type { FlowNode } from '../shared/flow.ts'

/** A Chinese interpretation of one durable event without altering its raw data. */
export interface SemanticDescription {
  readonly title: string
  readonly summary: string
}

const TOOL_NAMES: Readonly<Record<string, string>> = {
  web_search: '网页搜索', web_fetch: '网页读取', shell: '终端命令', bash: '终端命令', pwsh: 'PowerShell 命令',
  read_file: '读取文件', write_file: '写入文件', edit_file: '编辑文件', list_dir: '列出目录',
  search_files: '搜索文件', subagent: '启动子 Agent', subagent_fork: '派生子 Agent',
  todo_write: '更新任务清单', apply_patch: '应用补丁', imagegen: '生成图片',
  exec_command: '执行命令', write_stdin: '终端输入', read_mcp_resource: '读取 MCP 资源',
  list_mcp_resources: '列出 MCP 资源', list_mcp_resource_templates: '列出 MCP 模板',
}

const ERROR_CODES: Readonly<Record<string, string>> = {
  WEB_PROVIDER_CREDENTIAL_MISSING: '未配置网页服务凭据',
  TOOL_TIMEOUT: '工具执行超时',
  TOOL_NOT_FOUND: '未找到工具',
  PERMISSION_DENIED: '权限被拒绝',
  UNKNOWN: '未分类错误',
}

/** Converts a stable tool identifier to a readable Chinese action name. */
export function toolName(value: string): string {
  if (TOOL_NAMES[value] !== undefined) return TOOL_NAMES[value]
  if (value.startsWith('mcp__')) return 'MCP 工具调用'
  return '工具调用'
}

/** Converts a known execution failure code while retaining unknown codes verbatim. */
export function errorName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return ERROR_CODES[value] ?? `执行失败：${value}`
}

/** Produces the UI's Chinese title and semantic summary for one node. */
export function describeNode(node: FlowNode): SemanticDescription {
  switch (node.kind) {
    case 'input': return { title: '用户输入', summary: '一条用户消息或系统注入内容进入本轮会话。' }
    case 'model': return { title: '模型回复', summary: '模型已完成本步骤的回复。' }
    case 'turn': return { title: `第 ${String(node.turn ?? '?')} 轮开始`, summary: 'Agent 开始处理一轮新的任务。' }
    case 'tool': return { title: toolName(node.title), summary: node.status === 'running' ? '工具仍在执行。' : '工具已完成执行。' }
    case 'error': return { title: `${toolName(node.title)}失败`, summary: errorName(node.detail) ?? '本步骤或工具执行失败。' }
  }
}

/** Describes an original event type in Chinese for the raw-log inspector. */
export function eventTypeName(type: string): string {
  const labels: Readonly<Record<string, string>> = {
    'turn/start': '轮次开始', 'turn/end': '轮次结束', 'step/start': '步骤开始', 'step/end': '步骤结束',
    'user/message': '用户消息', 'assistant/message': '模型回复', 'assistant/chunk': '模型流式片段',
    'tool/call': '工具调用', 'tool/result': '工具结果', 'request/header': '模型请求配置',
    'request/context': '模型路由信息', 'todo/write': '任务清单更新', 'session/title': '会话标题更新',
  }
  return labels[type] ?? type
}
