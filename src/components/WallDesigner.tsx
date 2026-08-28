import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useStore } from '../store'
import { useWallStore } from '../wall/wallStore'
import { WallModel } from '../wall/WallModel'
import { designDepth, designWidth, vertexPos, type PresetName } from '../wall/profile'
import { export3MF, exportDAE, exportSTL } from '../wall/exporters'
import { ArrowHandle } from './gizmo'

function Num({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <label className="insp-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </label>
  )
}

const PRESETS: Array<{ name: PresetName; label: string }> = [
  { name: 'flat', label: 'Flat' },
  { name: 'prow', label: 'Prow' },
  { name: 'cave', label: 'Cave' },
  { name: 'bulge', label: 'Bulge' },
  { name: 'ridge', label: 'Ridge' },
  { name: 'boulder', label: 'Boulder' },
  { name: 'random', label: 'Random rock' },
]

// Screen-linear axis drag: at grab time we measure how many pixels one meter
// along the axis spans at the handle, then map cursor movement through that
// fixed ratio. (Ray/axis closest-point math is not used because it blows up
// hyperbolically as the cursor nears the axis' vanishing point in a
// perspective view — a short drag would explode the value.)
interface AxisDragMap {
  ux: number // screen-space unit vector along the axis
  uy: number
  ppm: number // pixels per meter along the axis at the handle
  sx: number // pointer position at grab time
  sy: number
}

function metersDragged(map: AxisDragMap, clientX: number, clientY: number): number {
  return ((clientX - map.sx) * map.ux + (clientY - map.sy) * map.uy) / map.ppm
}

const AXES: Array<{ axis: 'ox' | 'oy' | 'z'; dir: [number, number, number]; rot: [number, number, number]; color: string }> = [
  { axis: 'ox', dir: [1, 0, 0], rot: [0, 0, -Math.PI / 2], color: '#dc2626' },
  { axis: 'oy', dir: [0, 1, 0], rot: [0, 0, 0], color: '#16a34a' },
  { axis: 'z', dir: [0, 0, 1], rot: [Math.PI / 2, 0, 0], color: '#2563eb' },
]

/** Control-vertex spheres + 3-axis drag arrows for the selected vertex. */
function SculptHandles() {
  const draft = useWallStore((s) => s.draft)
  const selected = useWallStore((s) => s.selected)
  const setSelected = useWallStore((s) => s.setSelected)
  const setVertex = useWallStore((s) => s.setVertex)
  const setDraft = useWallStore((s) => s.setDraft)
  const { camera, gl, controls } = useThree()
  const dragRef = useRef<null | {
    axis: 'ox' | 'oy' | 'z' | 'width' | 'height'
    k: number
    start: number
    map: AxisDragMap
  }>(null)

  const depth = designDepth(draft)
  const zShift = -depth / 2 + draft.skeletonDepth

  // debugging / automated UI tests
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__wallCam = camera
    ;(window as unknown as Record<string, unknown>).__wallCanvas = gl.domElement
  }, [camera, gl])

  const screenOf = (p: THREE.Vector3) => {
    const rect = gl.domElement.getBoundingClientRect()
    const v = p.clone().project(camera)
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
  }

  // fixed screen-space mapping for a drag along `dir` starting at `origin`
  const makeDragMap = (origin: THREE.Vector3, dir: THREE.Vector3, e: ThreeEvent<PointerEvent>): AxisDragMap => {
    const p0 = screenOf(origin)
    const p1 = screenOf(origin.clone().add(dir))
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const len = Math.max(4, Math.hypot(dx, dy)) // guard: axis nearly head-on to the camera
    return { ux: dx / len, uy: dy / len, ppm: len, sx: e.nativeEvent.clientX, sy: e.nativeEvent.clientY }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      const dm = metersDragged(d.map, e.clientX, e.clientY)
      if (d.axis === 'width') {
        // wall stays centered, so the dragged edge moves twice the width delta
        const w = Math.round((d.start + 2 * dm) * 10) / 10
        setDraft({ width: Math.min(30, Math.max(1, w)) })
        return
      }
      if (d.axis === 'height') {
        const h = Math.round((d.start + dm) * 10) / 10
        setDraft({ height: Math.min(20, Math.max(1, h)) })
        return
      }
      const snapped = Math.round((d.start + dm) * 20) / 20 // 5 cm steps
      if (d.axis === 'z') setVertex(d.k, { z: Math.min(6, Math.max(0.05, snapped)) })
      else setVertex(d.k, { [d.axis]: Math.min(4, Math.max(-4, snapped)) })
    }
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = null
      const oc = controls as unknown as { enabled: boolean } | null
      if (oc) oc.enabled = true
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, controls, setVertex, setDraft])

  // whole-wall size arrows (width from either side edge, height from the top)
  const startSizeDrag = (axis: 'width' | 'height', origin: [number, number, number], dir: [number, number, number]) => (
    e: ThreeEvent<PointerEvent>,
  ) => {
    e.stopPropagation()
    const map = makeDragMap(new THREE.Vector3(...origin), new THREE.Vector3(...dir), e)
    dragRef.current = { axis, k: -1, start: axis === 'width' ? draft.width : draft.height, map }
    const oc = controls as unknown as { enabled: boolean } | null
    if (oc) oc.enabled = false
  }

  const startDrag = (axis: 'ox' | 'oy' | 'z', dir: [number, number, number]) => (e: ThreeEvent<PointerEvent>) => {
    if (selected === null) return
    e.stopPropagation()
    const d = draft
    const i = selected % d.nx
    const j = Math.floor(selected / d.nx)
    const [x, y, z] = vertexPos(d, i, j)
    const map = makeDragMap(new THREE.Vector3(x, y, z + zShift), new THREE.Vector3(...dir), e)
    const start = axis === 'ox' ? d.ox[selected] : axis === 'oy' ? d.oy[selected] : d.z[selected]
    dragRef.current = { axis, k: selected, start, map }
    const oc = controls as unknown as { enabled: boolean } | null
    if (oc) oc.enabled = false
  }

  const handles = useMemo(() => {
    const list: Array<{ k: number; pos: [number, number, number] }> = []
    for (let j = 0; j < draft.ny; j++)
      for (let i = 0; i < draft.nx; i++) {
        const [x, y, z] = vertexPos(draft, i, j)
        list.push({ k: j * draft.nx + i, pos: [x, y, z + zShift] })
      }
    return list
  }, [draft, zShift])

  const selPos = selected !== null ? handles.find((h) => h.k === selected)?.pos : undefined

  return (
    <group>
      {handles.map((h) => (
        <mesh
          key={h.k}
          position={h.pos}
          renderOrder={5}
          onPointerDown={(e) => {
            e.stopPropagation()
            setSelected(h.k === selected ? null : h.k)
          }}
        >
          <sphereGeometry args={[h.k === selected ? 0.14 : 0.09, 12, 10]} />
          <meshBasicMaterial color={h.k === selected ? '#f59e0b' : '#ffffff'} depthTest={false} transparent opacity={0.92} />
        </mesh>
      ))}
      {selPos &&
        AXES.map((a) => (
          <ArrowHandle key={a.axis} color={a.color} pos={selPos} rot={a.rot} size={0.85} onDown={startDrag(a.axis, a.dir)} />
        ))}
      {/* whole-wall size arrows (orange, like the warehouse shell) */}
      <ArrowHandle
        color="#f97316"
        pos={[draft.width / 2 + 0.4, draft.height * 0.5, zShift]}
        rot={[0, 0, -Math.PI / 2]}
        size={1.1}
        onDown={startSizeDrag('width', [draft.width / 2, draft.height * 0.5, zShift], [1, 0, 0])}
      />
      <ArrowHandle
        color="#f97316"
        pos={[-draft.width / 2 - 0.4, draft.height * 0.5, zShift]}
        rot={[0, 0, Math.PI / 2]}
        size={1.1}
        onDown={startSizeDrag('width', [-draft.width / 2, draft.height * 0.5, zShift], [-1, 0, 0])}
      />
      <ArrowHandle
        color="#f97316"
        pos={[0, draft.height + 0.3, zShift]}
        rot={[0, 0, 0]}
        size={1.1}
        onDown={startSizeDrag('height', [0, draft.height, zShift], [0, 1, 0])}
      />
    </group>
  )
}

/**
 * "Wall Design" page: a freeform rock-shaping wall designer. The wall is a
 * grid of control vertices over a back plane — tap a sphere, then pull its
 * three axis arrows to sculpt the faceted surface like shaping rock. Presets
 * give quick starting shapes; save the model to the library (it becomes a
 * placeable item in the layout planner), and export STL / 3MF /
 * COLLADA-for-SketchUp files.
 */
export function WallDesigner() {
  const setPage = useStore((s) => s.setPage)
  const draft = useWallStore((s) => s.draft)
  const designs = useWallStore((s) => s.designs)
  const selected = useWallStore((s) => s.selected)
  const setSelected = useWallStore((s) => s.setSelected)
  const setDraft = useWallStore((s) => s.setDraft)
  const setVertex = useWallStore((s) => s.setVertex)
  const setGridSize = useWallStore((s) => s.setGridSize)
  const applyPreset = useWallStore((s) => s.applyPreset)
  const saveDraft = useWallStore((s) => s.saveDraft)
  const loadDesign = useWallStore((s) => s.loadDesign)
  const newDraft = useWallStore((s) => s.newDraft)
  const deleteDesign = useWallStore((s) => s.deleteDesign)

  const [panelOpen, setPanelOpen] = useState(false)

  const W = designWidth(draft)
  const depth = designDepth(draft)
  const camDist = Math.max(W, draft.height) * 1.1 + 4

  return (
    <div className="wall-page">
      <header className="toolbar">
        <div className="tb-title">🧱 Wall Design</div>
        <div className="tb-group">
          <label className="tb-field">
            <span>Name</span>
            <input
              type="text"
              className="wd-name"
              value={draft.name}
              onChange={(e) => setDraft({ name: e.target.value })}
            />
          </label>
          <button className="save" onClick={saveDraft} title="Save to the wall library — it becomes a placeable item">
            💾 Save to library
          </button>
          <button onClick={newDraft}>＋ New wall</button>
        </div>
        <div className="tb-group">
          <button onClick={() => exportSTL(draft)} title="Binary STL in millimeters — for 3D printing">
            ⬇ STL
          </button>
          <button onClick={() => export3MF(draft)} title="3MF package in millimeters — for 3D printing">
            ⬇ 3MF
          </button>
          <button onClick={() => exportDAE(draft)} title="COLLADA (.dae) — open in SketchUp via File → Import">
            ⬇ SketchUp (DAE)
          </button>
        </div>
        <div className="tb-group">
          <button onClick={() => setPage('layout')}>← Back to Layout</button>
        </div>
      </header>

      <div className="main">
        <aside className={`palette wall-params${panelOpen ? ' open' : ''}`}>
          <button className="drawer-close" onClick={() => setPanelOpen(false)}>
            ✕ Close
          </button>
          <h2>Wall dimensions</h2>
          <div className="insp-grid">
            <Num label="Width (m)" value={draft.width} min={1} max={30} onChange={(v) => setDraft({ width: Math.max(1, v) })} />
            <Num label="Height (m)" value={draft.height} min={1} max={20} onChange={(v) => setDraft({ height: Math.max(1, v) })} />
            <Num label="Columns" value={draft.nx} step={1} min={2} max={15} onChange={(v) => setGridSize(v, draft.ny)} />
            <Num label="Rows" value={draft.ny} step={1} min={2} max={12} onChange={(v) => setGridSize(draft.nx, v)} />
            <Num
              label="Space behind wall (m)"
              value={draft.skeletonDepth}
              min={0.6}
              max={5}
              onChange={(v) => setDraft({ skeletonDepth: Math.max(0.6, v) })}
            />
            <Num label="Mat depth (m)" value={draft.matDepth} min={0} max={10} onChange={(v) => setDraft({ matDepth: v })} />
            <Num label="Mat thickness (m)" value={draft.matThick} step={0.05} min={0.1} max={1} onChange={(v) => setDraft({ matThick: v })} />
            <label className="insp-field">
              <span>Wall color</span>
              <input type="color" value={draft.color} onChange={(e) => setDraft({ color: e.target.value })} />
            </label>
          </div>
          <div className="insp-meta muted">
            Total: {W.toFixed(1)} m wide · {depth.toFixed(1)} m deep · {draft.height.toFixed(1)} m high
          </div>

          <h2 className="wd-sec-title">Start from a shape</h2>
          <div className="wd-presets">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => applyPreset(p.name)}>
                {p.label}
              </button>
            ))}
          </div>

          <h2 className="wd-sec-title">Sculpt</h2>
          {selected === null ? (
            <p className="muted">
              Tap a white control point on the wall, then pull its red / green / blue arrows to shape the rock — sideways,
              up-down, and in-out. Or type exact offsets here after selecting.
            </p>
          ) : (
            <div className="wd-section">
              <div className="wd-sec-head">
                <b>
                  Point {(selected % draft.nx) + 1} / {Math.floor(selected / draft.nx) + 1}
                </b>
                <button onClick={() => setSelected(null)}>Done</button>
              </div>
              <div className="insp-grid">
                <Num label="Sideways (m)" value={draft.ox[selected] ?? 0} step={0.05} min={-4} max={4} onChange={(v) => setVertex(selected, { ox: v })} />
                <Num label="Up / down (m)" value={draft.oy[selected] ?? 0} step={0.05} min={-4} max={4} onChange={(v) => setVertex(selected, { oy: v })} />
                <Num label="Depth out (m)" value={draft.z[selected] ?? 0.15} step={0.05} min={0.05} max={6} onChange={(v) => setVertex(selected, { z: v })} />
              </div>
            </div>
          )}

          <h2 className="wd-sec-title">Wall library</h2>
          {designs.length === 0 && <p className="muted">No saved walls yet. Save one and it appears as a placeable item in the layout planner.</p>}
          {designs.map((d) => (
            <div key={d.id} className="wd-lib-row">
              <button className="wd-lib-load" onClick={() => loadDesign(d.id)} title="Load into the editor">
                {d.name}
              </button>
              <button className="danger" onClick={() => deleteDesign(d.id)} title="Delete from library">
                ✕
              </button>
            </div>
          ))}
        </aside>

        <div className="canvas-wrap">
          <Canvas shadows dpr={[1, 2]} style={{ background: '#eceae4' }}>
            <PerspectiveCamera makeDefault position={[camDist * 0.8, camDist * 0.55, camDist]} fov={40} />
            <OrbitControls makeDefault target={[0, draft.height / 2.5, 0]} />
            <ambientLight intensity={0.7} />
            <directionalLight
              position={[10, 18, 8]}
              intensity={1.3}
              castShadow
              shadow-mapSize={[1024, 1024]}
              shadow-camera-left={-20}
              shadow-camera-right={20}
              shadow-camera-top={20}
              shadow-camera-bottom={-20}
            />
            <mesh position={[0, -0.06, 0]} receiveShadow>
              <boxGeometry args={[Math.max(W, depth) + 10, 0.1, Math.max(W, depth) + 10]} />
              <meshStandardMaterial color="#d6d2c8" roughness={1} />
            </mesh>
            <WallModel design={draft} holds={false} />
            <SculptHandles />
          </Canvas>
          <div className="fab-row">
            <button onClick={() => setPanelOpen((v) => !v)}>⚙ Wall settings</button>
          </div>
          <div className="wd-hint">Tap a point · pull arrows to sculpt · orange arrows resize the wall</div>
        </div>
      </div>
    </div>
  )
}
