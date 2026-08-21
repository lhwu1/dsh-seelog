import { describe, expect, it } from 'vitest'
import type { SessionFlowSnapshot } from '../src/shared/flow.ts'
import { eventCount, layoutSnapshot } from '../src/client/model.ts'

function snapshot(): SessionFlowSnapshot {
  return {
    version: 1, capturedAt: 1_700_000_000_000, rootSessionId: 'root', truncated: false,
    sessions: [
      { id: 'child-later', parentId: 'root', title: 'later', createdAt: 30, seedLength: 0, sourceEventCount: 0, capturedThroughSeq: 1, omittedEvents: 0, nodes: [] },
      { id: 'root', title: 'lead', createdAt: 10, seedLength: 0, sourceEventCount: 2, capturedThroughSeq: 2, omittedEvents: 0, nodes: [
        { id: 'root:0', sessionId: 'root', seq: 0, time: 10, kind: 'input', title: 'input', status: 'completed' },
        { id: 'root:1', sessionId: 'root', seq: 1, time: 20, kind: 'tool', title: 'shell', status: 'completed' },
      ] },
      { id: 'child-first', parentId: 'root', title: 'first', createdAt: 20, seedLength: 0, sourceEventCount: 1, capturedThroughSeq: 1, omittedEvents: 0, nodes: [
        { id: 'child:0', sessionId: 'child-first', seq: 0, time: 20, kind: 'model', title: 'response', status: 'completed' },
      ] },
    ],
  }
}

describe('session map layout', () => {
  it('keeps the root on the execution spine and orders parallel lanes by creation time', () => {
    const layout = layoutSnapshot(snapshot())
    expect(layout.root.session.id).toBe('root')
    expect(layout.root.lane).toBe(0)
    expect(layout.children.map(lane => lane.session.id)).toEqual(['child-first', 'child-later'])
    expect(layout.children.map(lane => lane.lane)).toEqual([1, 2])
    expect(layout.children.map(lane => lane.sceneY)).toEqual([68, 154])
    expect(layout.root.nodes[1]?.x).toBe(layout.children[0]?.nodes[0]?.x)
    expect((layout.root.nodes[1]?.x ?? 0) - (layout.root.nodes[0]?.x ?? 0)).toBeGreaterThanOrEqual(132)
  })

  it('counts all retained semantic facts independently of the display layout', () => {
    expect(eventCount(snapshot())).toBe(3)
  })
})
