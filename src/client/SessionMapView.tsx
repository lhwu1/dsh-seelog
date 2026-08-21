import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FlowNode, SessionFlowSnapshot } from '../shared/flow.ts'
import { FlowScene } from './FlowScene.tsx'
import { durationLabel, eventCount, kindLabel, layoutSnapshot, type VisualNode } from './model.ts'
import { describeNode, errorName, eventTypeName } from './semantic.ts'
import { ensureStyles } from './styles.ts'

interface EventLogDetail {
  readonly target: { readonly type: string, readonly seq: number, readonly time: number, readonly data: unknown }
  readonly context: readonly { readonly type: string, readonly seq: number, readonly time: number, readonly data: unknown }[]
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)
}

function detailFor(node: FlowNode): readonly [string, string | undefined][] {
  return [
    ['类别', kindLabel(node.kind)], ['状态', node.status === 'error' ? '失败' : node.status === 'running' ? '执行中' : '完成'],
    ['时间', timeLabel(node.time)], ['耗时', durationLabel(node)], ['会话', node.sessionId.slice(0, 16)],
    ['日志位置', `seq ${String(node.seq)}`], ['轮次', node.turn === undefined ? undefined : String(node.turn)],
    ['步骤', node.step === undefined ? undefined : String(node.step)], ['结果', errorName(node.detail) ?? node.detail],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined)
}

/** On-demand, topology-aware map view mounted in the ordinary conversation tab ring. */
export function SessionMapView({ sessionId }: ConvViewProps) {
  const [snapshot, setSnapshot] = useState<SessionFlowSnapshot | null>(null)
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(null)
  const [eventDetail, setEventDetail] = useState<EventLogDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshSequence = useRef(0)
  useEffect(() => { ensureStyles() }, [])
  useEffect(() => {
    if (selectedNode === null) {
      setEventDetail(null)
      setDetailLoading(false)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void fetch(`/dsh-seelog/event?sessionId=${encodeURIComponent(selectedNode.node.sessionId)}&seq=${String(selectedNode.node.seq)}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`无法读取原始日志 (${String(response.status)})`)
        return await response.json() as EventLogDetail
      })
      .then(value => { if (!cancelled) setEventDetail(value) })
      .catch((reason: unknown) => { if (!cancelled) setDetailError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedNode])
  const layout = useMemo(() => snapshot === null ? null : layoutSnapshot(snapshot), [snapshot])
  const refresh = useCallback(async (): Promise<void> => {
    const sequence = refreshSequence.current + 1
    refreshSequence.current = sequence
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/dsh-seelog/snapshot?sessionId=${encodeURIComponent(String(sessionId))}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`无法刷新会话图 (${String(response.status)})`)
      const nextSnapshot = await response.json() as SessionFlowSnapshot
      if (sequence !== refreshSequence.current) return
      setSnapshot(nextSnapshot)
    } catch (reason: unknown) {
      if (sequence === refreshSequence.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (sequence === refreshSequence.current) setLoading(false)
    }
  }, [sessionId])
  useEffect(() => {
    setSnapshot(null)
    setSelectedNode(null)
    setEventDetail(null)
    setError(null)
  }, [sessionId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const selectNode = useCallback((node: VisualNode): void => { setSelectedNode(node) }, [])
  const displayedCount = snapshot === null ? 0 : eventCount(snapshot)
  return <main className="seelogRoot">
    <header className="seelogHeader">
      <div><p className="seelogEyebrow">会话地图 / 按需刷新</p><h1>会话执行图</h1><p className="seelogMeta">进入视图和结束横向拖动时刷新；其余时间保持当前图。</p></div>
    </header>
    {snapshot !== null && <section className="seelogStats" aria-label="会话图概览"><div><b>{String(snapshot.sessions.reduce((total, session) => total + (session.sourceEventCount ?? session.nodes.length), 0))}</b><span>原始日志事件</span></div><div><b>{String(displayedCount)}</b><span>语义节点</span></div><div><b>{String(snapshot.sessions.length)}</b><span>会话与子 Agent</span></div><div><b>{timeLabel(snapshot.capturedAt)}</b><span>刷新时间</span></div></section>}
    {loading && snapshot !== null && <p className="seelogLoading">正在同步当前会话图...</p>}
    {error !== null && <p className="seelogError">{error}</p>}
    {snapshot === null && <p className="seelogEmpty">{loading ? '正在读取当前会话图...' : '暂无可显示的会话日志。'}</p>}
    {layout !== null && <section className="seelogLayout">
      <div className="seelogMap"><FlowScene layout={layout} selectedId={selectedNode?.node.id ?? null} onSelect={selectNode} onViewportDragEnd={refresh} /></div>
      <aside className="seelogSide"><h2>节点检查器</h2>{selectedNode === null ? <p className="seelogEmpty">点击画布节点或标签查看语义信息。</p> : <div className="seelogDetail"><b>{describeNode(selectedNode.node).title}</b><p>{describeNode(selectedNode.node).summary}</p>{detailFor(selectedNode.node).map(([label, value]) => <p key={label}>{label}<br /><b>{value}</b></p>)}{detailLoading && <p className="seelogLoading">正在读取完整原始日志...</p>}{detailError !== null && <p className="seelogError">{detailError}</p>}{eventDetail !== null && <details className="seelogRaw"><summary>{eventTypeName(eventDetail.target.type)} · 原始日志 #{String(eventDetail.target.seq)}</summary><pre>{JSON.stringify(eventDetail.target, null, 2)}</pre><p>相邻日志</p><ul>{eventDetail.context.map(event => <li key={event.seq}>{eventTypeName(event.type)} · seq {String(event.seq)}</li>)}</ul></details>}</div>}</aside>
    </section>}
    {snapshot?.truncated === true && <p className="seelogNotice">会话数量已达到部署上限，图中未包含其余子会话。</p>}
  </main>
}
