/** Frozen, browser-safe projection of one session lineage. */

/** Semantic categories rendered by the Session Map. */
export type FlowNodeKind = 'input' | 'model' | 'tool' | 'error' | 'turn'

/** One rendered execution fact, always traceable to a durable log event. */
export interface FlowNode {
  readonly id: string
  readonly sessionId: string
  readonly seq: number
  readonly time: number
  readonly endTime?: number
  readonly kind: FlowNodeKind
  readonly title: string
  readonly status: 'running' | 'completed' | 'error'
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly detail?: string
}

/** One session's ordered execution facts and lineage identity. */
export interface FlowSession {
  readonly id: string
  readonly parentId?: string
  readonly title: string
  readonly createdAt: number
  /** Leading inherited events excluded from this session's own execution lane. */
  readonly seedLength: number
  /** Total durable event count before this plugin's semantic projection. */
  readonly sourceEventCount: number
  readonly capturedThroughSeq: number | null
  readonly omittedEvents: number
  readonly nodes: readonly FlowNode[]
}

/** A complete, frozen graph derived from one root session and its descendants. */
export interface SessionFlowSnapshot {
  readonly version: 1
  readonly capturedAt: number
  readonly rootSessionId: string
  readonly sessions: readonly FlowSession[]
  readonly truncated: boolean
}
