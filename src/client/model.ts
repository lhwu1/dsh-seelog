import type { FlowNode, FlowSession, SessionFlowSnapshot } from '../shared/flow.ts'

/** One lightweight point used by the scene and the DOM execution ledger. */
export interface VisualNode {
  readonly node: FlowNode
  readonly x: number
  readonly y: number
  readonly lane: number
  /** Tool and failure records leave the root spine as local visual branches. */
  readonly isBranch: boolean
}

/** A session lane positioned beneath the root execution spine. */
export interface VisualLane {
  readonly session: FlowSession
  readonly lane: number
  readonly sceneY: number
  /** Horizontal point where this lane leaves its parent execution line. */
  readonly branchX: number
  /** Horizontal point where this lane has completed its own visible work. */
  readonly mergeX: number
  readonly nodes: readonly VisualNode[]
}

/** Layout data for a frozen session snapshot. */
export interface FlowLayout {
  readonly root: VisualLane
  readonly children: readonly VisualLane[]
  readonly width: number
  readonly height: number
}

const ROOT_Y = -120
const LANE_STEP = 86
const MAX_VISIBLE_NODES = 400
const MIN_TIME_GAP_PX = 132
const MAX_TIME_GAP_PX = 248

function orderedNodes(nodes: readonly FlowNode[]): readonly FlowNode[] {
  return [...nodes].sort((left, right) => left.time - right.time || left.seq - right.seq)
}

function visibleNodes(nodes: readonly FlowNode[]): readonly FlowNode[] {
  const ordered = orderedNodes(nodes)
  if (ordered.length <= MAX_VISIBLE_NODES) return ordered
  const keep = new Set<number>([0, ordered.length - 1])
  for (const [index, node] of ordered.entries()) {
    if (node.kind === 'error' || node.kind === 'input' || node.kind === 'model') keep.add(index)
  }
  const stride = Math.max(1, Math.ceil(ordered.length / MAX_VISIBLE_NODES))
  for (let index = 0; index < ordered.length; index += stride) keep.add(index)
  return [...keep].sort((left, right) => left - right).slice(0, MAX_VISIBLE_NODES).map(index => ordered[index]!).filter(Boolean)
}

function laneFor(
  session: FlowSession,
  lane: number,
  sceneY: number,
  positions: ReadonlyMap<number, number>,
): VisualLane {
  const nodes = visibleNodes(session.nodes).map((node, index) => ({
    node,
    x: positions.get(node.time) ?? 96,
    y: sceneY,
    lane,
    isBranch: false,
  }))
  const lastTime = nodes.at(-1)?.node.endTime ?? nodes.at(-1)?.node.time ?? session.createdAt
  return {
    session, lane, sceneY,
    branchX: positions.get(session.createdAt) ?? 48,
    mergeX: positions.get(lastTime) ?? positions.get(session.createdAt) ?? 48,
    nodes,
  }
}

/**
 * Assigns the root session to the execution spine and descendant sessions to
 * compact, non-overlapping parallel lanes.
 */
export function layoutSnapshot(snapshot: SessionFlowSnapshot): FlowLayout {
  const rootSession = snapshot.sessions.find(session => session.id === snapshot.rootSessionId)
    ?? snapshot.sessions[0]
  const sessions = snapshot.sessions
  const eventTimes = [...new Set(sessions.flatMap(session => [
    session.createdAt,
    ...visibleNodes(session.nodes).flatMap(node => node.endTime === undefined ? [node.time] : [node.time, node.endTime]),
  ]))].sort((left, right) => left - right)
  const positions = new Map<number, number>()
  let x = 96
  for (const [index, time] of eventTimes.entries()) {
    if (index > 0) {
      const prior = eventTimes[index - 1]!
      const deltaSeconds = Math.max(0, (time - prior) / 1_000)
      x += Math.min(MAX_TIME_GAP_PX, MIN_TIME_GAP_PX + Math.log1p(deltaSeconds) * 14)
    }
    positions.set(time, x)
  }
  const width = Math.max(720, x + 96)
  const root = laneFor(rootSession ?? {
    id: snapshot.rootSessionId,
    title: snapshot.rootSessionId.slice(0, 12),
    createdAt: snapshot.capturedAt,
    seedLength: 0,
    sourceEventCount: 0,
    capturedThroughSeq: null,
    omittedEvents: 0,
    nodes: [],
  }, 0, ROOT_Y, positions)
  const children = sessions
    .filter(session => session.id !== root.session.id)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((session, index) => {
      return laneFor(session, index + 1, 68 + index * LANE_STEP, positions)
    })
  return {
    root,
    children,
    width,
    height: Math.max(360, 184 + children.length * LANE_STEP),
  }
}

/** Human-facing label for a semantic event category. */
export function kindLabel(kind: FlowNode['kind']): string {
  switch (kind) {
    case 'input': return '输入'
    case 'model': return '模型'
    case 'tool': return '工具'
    case 'error': return '错误'
    case 'turn': return '轮次'
  }
}

/** Formats a duration without leaking raw event payloads. */
export function durationLabel(node: FlowNode): string | undefined {
  if (node.endTime === undefined) return undefined
  const milliseconds = Math.max(0, node.endTime - node.time)
  return milliseconds < 1_000 ? `${String(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(1)} s`
}

/** Serializable cached capture, retained only in the browser. */
export interface StoredSnapshot {
  readonly id: string
  readonly snapshot: SessionFlowSnapshot
  readonly capturedAt: number
  readonly addedEvents: number
}

const STORAGE_PREFIX = 'dsh-seelog:snapshots:'
const MAX_STORED = 24

function storageKey(sessionId: string): string { return `${STORAGE_PREFIX}${sessionId}` }

/** Reads snapshot history for one root session from local browser storage. */
export function readSnapshots(sessionId: string): readonly StoredSnapshot[] {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value as readonly StoredSnapshot[] : []
  } catch { return [] }
}

/** Stores a bounded frozen capture and reports its incremental event count. */
export function storeSnapshot(snapshot: SessionFlowSnapshot): StoredSnapshot {
  const prior = readSnapshots(snapshot.rootSessionId)
  const previousCount = prior[0] === undefined ? 0 : eventCount(prior[0].snapshot)
  const item: StoredSnapshot = {
    id: `${String(snapshot.capturedAt)}-${Math.random().toString(36).slice(2, 8)}`,
    snapshot,
    capturedAt: snapshot.capturedAt,
    addedEvents: Math.max(0, eventCount(snapshot) - previousCount),
  }
  try { window.localStorage.setItem(storageKey(snapshot.rootSessionId), JSON.stringify([item, ...prior].slice(0, MAX_STORED))) } catch { /* Storage is optional. */ }
  return item
}

/** Counts the lightweight facts in a projection. */
export function eventCount(snapshot: SessionFlowSnapshot): number {
  return snapshot.sessions.reduce((total, session) => total + session.nodes.length, 0)
}
