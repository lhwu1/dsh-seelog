import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { FlowLayout, VisualLane, VisualNode } from './model.ts'
import { describeNode } from './semantic.ts'

interface Props {
  readonly layout: FlowLayout
  readonly selectedId: string | null
  readonly onSelect: (node: VisualNode) => void
  readonly onViewportDragEnd: () => void
}

function colorFor(node: VisualNode): number {
  if (node.node.status === 'error') return 0xf0646b
  switch (node.node.kind) {
    case 'input': return 0x5ea8ff
    case 'model': return 0x7a7cff
    case 'tool': return 0x42d7b0
    case 'turn': return 0x9aafd1
    case 'error': return 0xf0646b
  }
}

function tube(curve: THREE.Curve<THREE.Vector3>, color: number, radius: number, opacity = 1): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 24, radius, 9, false),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.14, metalness: 0.52, roughness: 0.24, transparent: opacity < 1, opacity }),
  )
}

function htmlLabel(text: string, className: string, interactive = false): HTMLElement {
  const element = interactive ? document.createElement('button') : document.createElement('div')
  if (interactive) (element as HTMLButtonElement).type = 'button'
  element.className = className
  element.textContent = text
  element.style.pointerEvents = interactive ? 'auto' : 'none'
  return element
}

function positionForTime(nodes: readonly VisualNode[], value: number): number {
  const ordered = [...nodes].sort((left, right) => left.node.time - right.node.time || left.node.seq - right.node.seq)
  const first = ordered[0]
  const last = ordered.at(-1)
  if (first === undefined || last === undefined) return 32
  if (value <= first.node.time) return first.x
  if (value >= last.node.time) return last.x
  for (let index = 1; index < ordered.length; index += 1) {
    const right = ordered[index]!
    const left = ordered[index - 1]!
    if (value > right.node.time) continue
    const elapsed = Math.max(1, right.node.time - left.node.time)
    return left.x + (right.x - left.x) * (value - left.node.time) / elapsed
  }
  return last.x
}

interface OverviewTimeline {
  readonly element: HTMLElement
  update(pan: number, width: number): void
}

function createOverview(layout: FlowLayout, navigate: (x: number) => void): OverviewTimeline {
  const nodes = [
    ...layout.root.nodes,
    ...layout.children.flatMap(lane => lane.nodes),
  ].sort((left, right) => left.node.time - right.node.time || left.node.seq - right.node.seq)
  const element = document.createElement('div')
  element.className = 'seelogOverview'
  const rail = document.createElement('div')
  rail.className = 'seelogOverviewRail'
  const windowMarker = document.createElement('div')
  windowMarker.className = 'seelogOverviewWindow'
  rail.append(windowMarker)
  element.append(rail)
  const first = nodes[0]
  const last = nodes.at(-1)
  if (first !== undefined && last !== undefined) {
    const span = Math.max(1, last.node.time - first.node.time)
    const formatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    for (let index = 0; index < 5; index += 1) {
      const ratio = index / 4
      const time = first.node.time + span * ratio
      const tick = document.createElement('button')
      tick.type = 'button'
      tick.className = 'seelogOverviewTick'
      tick.textContent = formatter.format(time)
      tick.style.left = `${String(ratio * 100)}%`
      tick.addEventListener('click', () => { navigate(positionForTime(nodes, time)) })
      rail.append(tick)
    }
    rail.addEventListener('pointerdown', event => {
      if (event.target instanceof HTMLButtonElement) return
      const box = rail.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
      navigate(positionForTime(nodes, first.node.time + span * ratio))
    })
  }
  return {
    element,
    update(pan, width) {
      const visible = Math.min(1, width / layout.width)
      const start = Math.max(0, Math.min(1 - visible, -pan / layout.width))
      windowMarker.style.left = `${String(start * 100)}%`
      windowMarker.style.width = `${String(visible * 100)}%`
    },
  }
}

function addNode(group: THREE.Group, targets: THREE.Object3D[], labelLayer: HTMLElement, node: VisualNode, y: number, selectedId: string | null, cardY: number, select: (node: VisualNode) => void): void {
  const selected = node.node.id === selectedId
  const color = colorFor(node)
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(selected ? 9.5 : 7, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: selected ? 0.62 : 0.22, metalness: 0.52, roughness: 0.2 }),
  )
  marker.position.set(node.x, y, 4)
  marker.rotation.z = Math.PI / 4
  marker.userData.node = node
  group.add(marker)
  targets.push(marker)
  const direction = cardY > y ? 1 : -1
  const cardEdgeY = cardY - direction * 14
  const leader = new THREE.CubicBezierCurve3(
    new THREE.Vector3(node.x, y + direction * 8, 1),
    new THREE.Vector3(node.x + 7, y + direction * 24, 1),
    new THREE.Vector3(node.x - 7, cardEdgeY - direction * 18, 1),
    new THREE.Vector3(node.x, cardEdgeY, 1),
  )
  group.add(tube(leader, color, selected ? 2.25 : 1.9, 0.96))
  const knot = new THREE.Mesh(
    new THREE.TorusGeometry(selected ? 5.8 : 4.8, 1.25, 7, 18),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.32, metalness: 0.58, roughness: 0.18 }),
  )
  knot.position.set(node.x, y + direction * 15, 3)
  knot.rotation.x = Math.PI / 2
  group.add(knot)
  const card = htmlLabel(describeNode(node.node).title, selected ? 'seelogEventCard seelogEventCardSelected' : 'seelogEventCard')
  card.style.left = `${String(node.x)}px`
  card.style.top = `${String(cardY)}px`
  card.style.pointerEvents = 'auto'
  card.addEventListener('click', () => { select(node) })
  labelLayer.append(card)
}

function laneY(index: number, total: number, rootY: number, height: number): number {
  const first = rootY + 84
  const last = height - 52
  return total <= 1 ? Math.min(first, last) : first + (last - first) * index / (total - 1)
}

function addChildLane(group: THREE.Group, targets: THREE.Object3D[], labelLayer: HTMLElement, lane: VisualLane, index: number, total: number, rootY: number, height: number, selectedId: string | null, select: (node: VisualNode) => void): void {
  const y = laneY(index, total, rootY, height)
  const start = lane.branchX
  const end = Math.max(start + 84, lane.mergeX + 44)
  group.add(tube(new THREE.CubicBezierCurve3(
    new THREE.Vector3(start, rootY, 0), new THREE.Vector3(start + 30, rootY, 0),
    new THREE.Vector3(start + 34, y, 0), new THREE.Vector3(start + 70, y, 0),
  ), 0x43d4d2, 3.1, 0.98))
  group.add(tube(new THREE.LineCurve3(new THREE.Vector3(start + 70, y, 0), new THREE.Vector3(end, y, 0)), 0x43d4d2, 3.1, 0.98))
  group.add(tube(new THREE.CubicBezierCurve3(
    new THREE.Vector3(end, y, 0), new THREE.Vector3(end + 28, y, 0),
    new THREE.Vector3(end + 34, rootY, 0), new THREE.Vector3(end + 66, rootY, 0),
  ), 0x43d4d2, 3.1, 0.92))
  const title = htmlLabel(`子智能体 ${String(lane.lane)} · ${lane.session.title}`, 'seelogLaneLabel')
  title.style.left = `${String(start + 158)}px`
  title.style.top = `${String(y - 25)}px`
  labelLayer.append(title)
  for (const node of lane.nodes) addNode(group, targets, labelLayer, node, y, selectedId, y > height - 92 ? y - 62 : y + 64, select)
}

/** Draws a horizontally navigable execution graph without rebuilding during panning. */
export function FlowScene({ layout, selectedId, onSelect, onViewportDragEnd }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const selectRef = useRef(onSelect)
  const viewportPanRef = useRef(0)
  selectRef.current = onSelect

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -30, 30)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const labelLayer = document.createElement('div')
    labelLayer.className = 'seelogCssLabels'
    const overview = createOverview(layout, x => { targetPan = clampPan(width / 2 - x) })
    element.replaceChildren(renderer.domElement, labelLayer, overview.element)
    const ambient = new THREE.HemisphereLight(0xdbe8ff, 0x08111c, 2.5)
    const key = new THREE.DirectionalLight(0xffffff, 2.7)
    key.position.set(-0.5, -0.4, 8)
    const rim = new THREE.PointLight(0x56d5ff, 18, 520)
    rim.position.set(0, 50, 80)
    scene.add(ambient, key, rim)
    const graph = new THREE.Group()
    scene.add(graph)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const targets: THREE.Object3D[] = []
    let width = 1
    let height = 1
    let minPan = 0
    let pan = viewportPanRef.current
    let targetPan = viewportPanRef.current
    let frame = 0
    let dragging: { readonly x: number, readonly pan: number, moved: boolean } | null = null

    const disposeGraph = (): void => {
      graph.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material.dispose()
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose()
          object.material.dispose()
        }
      })
      graph.clear()
      targets.length = 0
      labelLayer.replaceChildren()
    }
    const render = (): void => {
      graph.position.x = pan
      labelLayer.style.transform = `translate3d(${String(pan)}px, 0, 0)`
      overview.update(pan, width)
      viewportPanRef.current = pan
      renderer.render(scene, camera)
    }
    const animate = (): void => {
      pan += (targetPan - pan) * 0.24
      if (Math.abs(targetPan - pan) < 0.1) pan = targetPan
      render()
      frame = requestAnimationFrame(animate)
    }
    const clampPan = (value: number): number => Math.max(minPan, Math.min(0, value))
    const rebuild = (): void => {
      disposeGraph()
      width = Math.max(360, element.clientWidth)
      height = Math.max(400, element.clientHeight)
      renderer.setSize(width, height)
      camera.left = 0; camera.right = width; camera.top = 0; camera.bottom = height
      camera.updateProjectionMatrix()
      minPan = Math.min(0, width - layout.width - 48)
      pan = clampPan(pan)
      targetPan = clampPan(targetPan)
      viewportPanRef.current = pan
      const rootY = Math.max(126, Math.min(154, height * 0.29))
      graph.add(tube(new THREE.LineCurve3(new THREE.Vector3(32, rootY, 0), new THREE.Vector3(layout.width + 14, rootY, 0)), 0x6b75ff, 4.8))
      for (const node of layout.root.nodes) {
        addNode(graph, targets, labelLayer, node, rootY, selectedId, rootY + 68, target => { selectRef.current(target) })
      }
      for (const [index, lane] of layout.children.entries()) addChildLane(graph, targets, labelLayer, lane, index, layout.children.length, rootY, height, selectedId, target => { selectRef.current(target) })
      render()
    }
    const observer = new ResizeObserver(rebuild)
    observer.observe(element)
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      targetPan = clampPan(targetPan - delta * 1.15)
    }
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return
      dragging = { x: event.clientX, pan: targetPan, moved: false }
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }
    const move = (event: PointerEvent): void => {
      if (dragging === null) return
      const offset = event.clientX - dragging.x
      dragging.moved ||= Math.abs(offset) > 2
      targetPan = clampPan(dragging.pan + offset)
    }
    const up = (event: PointerEvent): void => {
      const wasDrag = dragging?.moved === true
      dragging = null
      renderer.domElement.style.cursor = 'grab'
      if (wasDrag) {
        onViewportDragEnd()
        return
      }
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(targets, false)[0]?.object
      const target = hit?.userData.node as VisualNode | undefined
      if (target !== undefined) selectRef.current(target)
    }
    renderer.domElement.style.cursor = 'grab'
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    rebuild()
    frame = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('wheel', wheel)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      disposeGraph()
      renderer.dispose()
      element.replaceChildren()
    }
  }, [layout, selectedId, onViewportDragEnd])

  return <div className="seelogCanvas" aria-label="会话执行轨迹"><div className="seelogCanvasSurface" ref={host} /></div>
}
