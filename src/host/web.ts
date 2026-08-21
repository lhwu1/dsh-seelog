/** Read-only Session Map snapshot endpoint. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionLineageNode } from '@deepseek-ai/dsh-session-query'
import type { FlowNode, FlowSession, SessionFlowSnapshot } from '../shared/flow.ts'

/** Plugin config limiting the read-only graph materialized for one browser request. */
export interface Config {
  /** Maximum number of lineage sessions represented by one snapshot. */
  maxSessions: number
  /** Maximum tail events retained for any one session. */
  maxEventsPerSession: number
}

/** Validated deployment limits for the snapshot endpoint. */
export const Config: z<Config> = z.object({
  maxSessions: z.natural().min(1).max(512).default(128),
  maxEventsPerSession: z.natural().min(100).max(20_000).default(20_000),
})

/** Stable Cordis plugin name. */
export const name = 'dsh-seelog-web'
/** Services required to read durable events and publish the local web route. */
export const inject = ['webServer', 'sessionQuery']

interface MutableFlowNode {
  id: string
  sessionId: string
  seq: number
  time: number
  endTime?: number
  kind: FlowNode['kind']
  title: string
  status: FlowNode['status']
  turn?: number
  step?: number
  callId?: string
  detail?: string
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined
}

function labelForSession(events: readonly SessionEvent[], fallback: string): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'session/title') return stringField(event.data, 'title') ?? fallback
  }
  return fallback
}

function eventNodeId(sessionId: string, seq: number): string {
  return `${sessionId}:${String(seq)}`
}

function nodeFor(event: SessionEvent, sessionId: string, node: Omit<MutableFlowNode, 'id' | 'sessionId' | 'seq' | 'time'>): MutableFlowNode {
  return { id: eventNodeId(sessionId, event.seq), sessionId, seq: event.seq, time: event.time, ...node }
}

function projectEvents(sessionId: string, events: readonly SessionEvent[], maximum: number): Pick<FlowSession, 'nodes' | 'omittedEvents'> {
  const omittedEvents = Math.max(0, events.length - maximum)
  const tail = events.slice(omittedEvents)
  const nodes: MutableFlowNode[] = []
  const calls = new Map<string, MutableFlowNode>()

  for (const event of tail) {
    switch (event.type) {
      case 'turn/start':
        nodes.push(nodeFor(event, sessionId, {
          kind: 'turn', title: `Turn ${String(event.data.turn)}`, status: 'completed', turn: event.data.turn,
        }))
        break
      case 'user/message':
        nodes.push(nodeFor(event, sessionId, {
          kind: 'input', title: event.data.source.kind === 'user' ? 'User input' : 'Injected context', status: 'completed',
        }))
        break
      case 'assistant/message':
        nodes.push(nodeFor(event, sessionId, {
          kind: 'model', title: 'Model response', status: 'completed', turn: event.data.turn, step: event.data.step,
        }))
        break
      case 'tool/call': {
        const callId = String(event.data.callId)
        const node = nodeFor(event, sessionId, {
          kind: 'tool', title: event.data.name, status: 'running', turn: event.data.turn, step: event.data.step, callId,
        })
        calls.set(callId, node)
        nodes.push(node)
        break
      }
      case 'tool/result': {
        const callId = String(event.data.message.source.callId)
        const prior = calls.get(callId)
        const error = event.data.error !== undefined
        if (prior !== undefined) {
          prior.endTime = event.time
          prior.status = error ? 'error' : 'completed'
          prior.kind = error ? 'error' : 'tool'
          prior.detail = error ? event.data.error?.code ?? 'Tool returned an error' : undefined
          break
        }
        nodes.push(nodeFor(event, sessionId, {
          kind: error ? 'error' : 'tool', title: 'Tool result', status: error ? 'error' : 'completed', callId,
          detail: error ? event.data.error?.code ?? 'Tool returned an error' : undefined,
        }))
        break
      }
      case 'turn/end':
        if (event.data.reason.kind === 'error') {
          nodes.push(nodeFor(event, sessionId, {
            kind: 'error', title: 'Turn failed', status: 'error', turn: event.data.turn, detail: event.data.reason.error.code,
          }))
        }
        break
      default:
        break
    }
  }
  return { nodes, omittedEvents }
}

function descendantIds(nodes: readonly SessionLineageNode[]): string[] {
  const ids: string[] = []
  const pending = [...nodes]
  for (const node of pending) {
    ids.push(String(node.session.header.id))
    pending.push(...node.descendants)
  }
  return ids
}

async function snapshot(ctx: Context, sessionId: string, config: Config): Promise<SessionFlowSnapshot> {
  const rootId = SessionId(sessionId)
  const lineage = await ctx.sessionQuery.traceSession(rootId)
  const ids = [String(lineage.target.header.id), ...descendantIds(lineage.descendants)]
  const selected = ids.slice(0, config.maxSessions)
  const sessions = await Promise.all(selected.map(async (id): Promise<FlowSession> => {
    const log = await ctx.sessionQuery.readSession(SessionId(id))
    const projected = projectEvents(id, log.events.slice(log.session.seedLength ?? 0), config.maxEventsPerSession)
    return {
      id,
      ...(log.session.parentSession === undefined ? {} : { parentId: String(log.session.parentSession) }),
      title: labelForSession(log.events, id.slice(0, 12)),
      createdAt: log.session.createdAt,
      seedLength: log.session.seedLength ?? 0,
      sourceEventCount: log.events.length,
      capturedThroughSeq: log.events.at(-1)?.seq ?? null,
      ...projected,
    }
  }))
  return {
    version: 1,
    capturedAt: Date.now(),
    rootSessionId: String(lineage.target.header.id),
    sessions,
    truncated: selected.length !== ids.length,
  }
}

function requestSessionId(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? '/', 'http://dsh.internal')
  const sessionId = url.searchParams.get('sessionId')
  return sessionId === null || sessionId.length === 0 || sessionId.length > 512 ? undefined : sessionId
}

function requestEventLocation(request: IncomingMessage): { sessionId: string, seq: number } | undefined {
  const url = new URL(request.url ?? '/', 'http://dsh.internal')
  const sessionId = url.searchParams.get('sessionId')
  const sequence = url.searchParams.get('seq')
  if (sessionId === null || sessionId.length === 0 || sessionId.length > 512 || sequence === null) return undefined
  const seq = Number(sequence)
  return Number.isSafeInteger(seq) && seq >= 0 ? { sessionId, seq } : undefined
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Mount the same-origin endpoint serving a frozen topology-aware log projection. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-seelog/snapshot',
    async handler(request, response) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      const sessionId = requestSessionId(request)
      if (sessionId === undefined) {
        sendJson(response, 400, { error: 'sessionId is required.' })
        return
      }
      try {
        sendJson(response, 200, await snapshot(ctx, sessionId, config))
      } catch (error: unknown) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-seelog: snapshot endpoint')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-seelog/event',
    async handler(request, response) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      const location = requestEventLocation(request)
      if (location === undefined) {
        sendJson(response, 400, { error: 'sessionId and a non-negative seq are required.' })
        return
      }
      try {
        const event = await ctx.sessionQuery.readEvent({
          sessionId: SessionId(location.sessionId), seq: location.seq, before: 2, after: 2,
        })
        sendJson(response, 200, { target: event.target, context: event.events })
      } catch (error: unknown) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-seelog: event endpoint')
}
