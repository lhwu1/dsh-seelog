import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FlowNode, SessionFlowSnapshot } from '../shared/flow.ts'
import { FlowScene } from './FlowScene.tsx'
import { durationLabel, eventCount, kindLabel, layoutSnapshot, readSnapshots, storeSnapshot, type StoredSnapshot, type VisualNode } from './model.ts'
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

/** Frozen, topology-aware map view mounted in the ordinary conversation tab ring. */
export function SessionMapView({ sessionId }: ConvViewProps) {
  const [snapshots, setSnapshots] = useState<readonly StoredSnapshot[]>(() => readSnapshots(String(sessionId)))
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(snapshots[0]?.id ?? null)
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(null)
  const [eventDetail, setEventDetail] = useState<EventLogDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { ensureStyles() }, [])
  useEffect(() => {
    const history = readSnapshots(String(sessionId))
    setSnapshots(history)
    setSelectedSnapshotId(history[0]?.id ?? null)
    setSelectedNode(null)
    setEventDetail(null)
    setError(null)
  }, [sessionId])
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
  const selected = snapshots.find(item => item.id === selectedSnapshotId) ?? null
  const layout = useMemo(() => selected === null ? null : layoutSnapshot(selected.snapshot), [selected])
  const capture = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/dsh-seelog/snapshot?sessionId=${encodeURIComponent(String(sessionId))}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`无法下载会话快照 (${String(response.status)})`)
      const snapshot = await response.json() as SessionFlowSnapshot
      const stored = storeSnapshot(snapshot)
      const history = readSnapshots(String(sessionId))
      setSnapshots(history)
      setSelectedSnapshotId(stored.id)
      setSelectedNode(null)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setLoading(false) }
  }, [sessionId])
  const selectNode = useCallback((node: VisualNode): void => { setSelectedNode(node) }, [])
  const displayedCount = selected === null ? 0 : eventCount(selected.snapshot)
  return <main className="seelogRoot">
    <header className="seelogHeader">
      <div><p className="seelogEyebrow">会话地图 / 冻结快照</p><h1>会话执行图</h1><p className="seelogMeta">主执行线与并行子智能体轨道。图只在下载快照时更新。</p></div>
      <div className="seelogActions"><button type="button" className="seelogPrimary" onClick={() => { void capture() }} disabled={loading}>{loading ? '正在下载...' : '下载并生成快照'}</button></div>
    </header>
    {selected !== null && <section className="seelogStats" aria-label="快照概览"><div><b>{String(selected.snapshot.sessions.reduce((total, session) => total + (session.sourceEventCount ?? session.nodes.length), 0))}</b><span>原始日志事件</span></div><div><b>{String(displayedCount)}</b><span>语义节点</span></div><div><b>{String(selected.snapshot.sessions.length)}</b><span>会话与子 Agent</span></div><div><b>+{String(selected.addedEvents)}</b><span>相对上次新增</span></div><div><b>{timeLabel(selected.capturedAt)}</b><span>捕获时间</span></div></section>}
    {error !== null && <p className="seelogError">{error}</p>}
    {selected === null && !loading && <p className="seelogEmpty">还没有已下载的图。下载后将保留当前会话的冻结版本。</p>}
    {layout !== null && <section className="seelogLayout">
      <div className="seelogMap"><FlowScene layout={layout} selectedId={selectedNode?.node.id ?? null} onSelect={selectNode} /></div>
      <aside className="seelogSide"><h2>节点检查器</h2>{selectedNode === null ? <p className="seelogEmpty">点击画布节点或下方事件查看语义信息。</p> : <div className="seelogDetail"><b>{describeNode(selectedNode.node).title}</b><p>{describeNode(selectedNode.node).summary}</p>{detailFor(selectedNode.node).map(([label, value]) => <p key={label}>{label}<br /><b>{value}</b></p>)}{detailLoading && <p className="seelogLoading">正在读取完整原始日志...</p>}{detailError !== null && <p className="seelogError">{detailError}</p>}{eventDetail !== null && <details className="seelogRaw"><summary>{eventTypeName(eventDetail.target.type)} · 原始日志 #{String(eventDetail.target.seq)}</summary><pre>{JSON.stringify(eventDetail.target, null, 2)}</pre><p>相邻日志</p><ul>{eventDetail.context.map(event => <li key={event.seq}>{eventTypeName(event.type)} · seq {String(event.seq)}</li>)}</ul></details>}</div>}
        <div className="seelogSnapshots"><h2>已下载的可视化图</h2>{snapshots.length === 0 ? <p className="seelogEmpty">暂无快照</p> : <ul>{snapshots.map(item => <li key={item.id}><button type="button" aria-pressed={item.id === selectedSnapshotId} onClick={() => { setSelectedSnapshotId(item.id); setSelectedNode(null) }}>{timeLabel(item.capturedAt)} · {String(eventCount(item.snapshot))} 事件 · +{String(item.addedEvents)}</button></li>)}</ul>}</div>
      </aside>
    </section>}
    {selected?.snapshot.truncated === true && <p className="seelogNotice">会话数量已达到部署上限，图中未包含其余子会话。</p>}
  </main>
}
