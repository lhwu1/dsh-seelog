import { describe, expect, it } from 'vitest'
import { describeNode, errorName, toolName } from '../src/client/semantic.ts'

describe('Chinese semantic labels', () => {
  it('maps common tool and failure identifiers to user-facing Chinese', () => {
    expect(toolName('web_search')).toBe('网页搜索')
    expect(errorName('WEB_PROVIDER_CREDENTIAL_MISSING')).toBe('未配置网页服务凭据')
  })

  it('keeps unknown tool identifiers out of the graph label language', () => {
    expect(toolName('mcp__internal__opaque_call')).toBe('MCP 工具调用')
  })

  it('turns a tool failure into a concise Chinese execution summary', () => {
    expect(describeNode({
      id: 's:1', sessionId: 's', seq: 1, time: 1, kind: 'error', title: 'web_search',
      status: 'error', detail: 'WEB_PROVIDER_CREDENTIAL_MISSING',
    })).toEqual({ title: '网页搜索失败', summary: '未配置网页服务凭据' })
  })
})
