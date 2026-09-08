import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useStore } from '../store'
import type { CanopyDef, FacadePanel, FacadeSide, ShellDesign, ShellSegment } from '../types'
import { SegmentedShell, defaultShellDesign, segmentSpans } from './SegmentedShell'
import { NumInput } from './NumInput'

/**
 * Building Design page: shape the shell as ZONES with independent heights,
 * roof types and slopes; add canopies (posts or hung) on any side; and draw
 * free-shape glazing panels directly on each facade. Edits apply live to the
 * layout's building shell and are saved with the layout.
 */

const SIDE_LABELS: Record<FacadeSide, string> = { N: 'North end (-Z)', S: 'South end (+Z)', E: 'East side (+X)', W: 'West side (-X)' }
const SHEET_COLORS = ['#dfe3e7', '#b9c0c7', '#7c828a', '#3f454d', '#274156', '#4e6e58', '#8a2f2b', '#d8cdb8', '#e8e4da', '#22262b']

function ColorDots({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <span className="bd-dots">
      {SHEET_COLORS.map((c) => (
        <button
          key={c}
          className={`bd-dot${value === c ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
          title={c}
        />
      ))}
      <input type="color" value={value} onChange={(e) => onPick(e.target.value)} title="Custom color" />
    </span>
  )
}

export function BuildingDesigner() {
  const setPage = useStore((s) => s.setPage)
  const building = useStore((s) => s.building)
  const eave = useStore((s) => s.shell.eave)
  const stored = useStore((s) => s.shellDesign)
  const setShellDesign = useStore((s) => s.setShellDesign)
  const design: ShellDesign = stored ?? defaultShellDesign(building.length, eave, building.width)
  const [side, setSide] = useState<FacadeSide>('E')
  const [draft, setDraft] = useState<Array<[number, number]>>([])
  const [draftKind, setDraftKind] = useState<FacadePanel['kind']>('glass')
  const [selPanel, setSelPanel] = useState<number | null>(null)
  const dragRef = useRef<{ panel: number; pt: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const patch = (p: Partial<ShellDesign>) => setShellDesign({ ...design, ...p })
  const setSeg = (i: number, p: Partial<ShellSegment>) =>
    patch({ segments: design.segments.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  const setCan = (i: number, p: Partial<CanopyDef>) =>
    patch({ canopies: design.canopies.map((c, k) => (k === i ? { ...c, ...p } : c)) })

  // ---- facade editor geometry ----
  const wallLen = side === 'E' || side === 'W' ? building.length : building.width
  const spans = useMemo(() => segmentSpans(design, building.length), [design, building.length])
  const maxH = Math.max(...design.segments.map((s) => s.eave + s.rise), 4)
  const PPM = Math.min(560 / (wallLen + 1), 200 / (maxH + 1)) // px per meter
  const svgW = (wallLen + 1) * PPM
  const svgH = (maxH + 1) * PPM
  const sx = (u: number) => (u + 0.5) * PPM
  const sy = (y: number) => (maxH + 0.5 - y) * PPM
  const fromEvent = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const u = ((e.clientX - r.left) / r.width) * (wallLen + 1) - 0.5
    const y = maxH + 0.5 - ((e.clientY - r.top) / r.height) * (maxH + 1)
    const snap = (v: number) => Math.round(v * 4) / 4
    return [Math.max(0, Math.min(wallLen, snap(u))), Math.max(0, Math.min(maxH, snap(y)))]
  }

  // wall silhouette for the selected side
  const silhouette = useMemo(() => {
    if (side === 'E' || side === 'W') {
      const pts: Array<[number, number]> = [[0, 0]]
      for (const s of spans) {
        const u0 = s.z0 + building.length / 2
        const u1 = s.z1 + building.length / 2
        pts.push([u0, s.eave], [u1, s.eave])
      }
      pts.push([wallLen, 0])
      return pts
    }
    const seg = side === 'N' ? spans[0] : spans[spans.length - 1]
    if (!seg) return []
    const W = building.width
    if (seg.roof === 'gable')
      return [[0, 0], [0, seg.eave], [W / 2, seg.eave + seg.rise], [W, seg.eave], [W, 0]] as Array<[number, number]>
    if (seg.roof === 'slopeL') return [[0, 0], [0, seg.eave + seg.rise], [W, seg.eave], [W, 0]] as Array<[number, number]>
    if (seg.roof === 'slopeR') return [[0, 0], [0, seg.eave], [W, seg.eave + seg.rise], [W, 0]] as Array<[number, number]>
    return [[0, 0], [0, seg.eave], [W, seg.eave], [W, 0]] as Array<[number, number]>
  }, [side, spans, building.length, building.width, wallLen])

  const sidePanels = design.panels.map((p, i) => ({ p, i })).filter(({ p }) => p.side === side)

  const commitDraft = () => {
    if (draft.length < 3) return
    patch({ panels: [...design.panels, { side, pts: draft, kind: draftKind }] })
    setDraft([])
  }

  const onSvgClick = (e: React.MouseEvent) => {
    if (dragRef.current) return
    setDraft((d) => [...d, fromEvent(e)])
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const [u, y] = fromEvent(e)
    patch({
      panels: design.panels.map((p, i) =>
        i === drag.panel ? { ...p, pts: p.pts.map((pt, k) => (k === drag.pt ? ([u, y] as [number, number]) : pt)) } : p,
      ),
    })
  }

  const fillFor = (k: FacadePanel['kind']) => (k === 'glass' ? 'rgba(120,180,220,0.55)' : k === 'clear' ? 'rgba(240,246,250,0.75)' : 'rgba(90,100,110,0.8)')

  return (
    <div className="wall-designer bd-page">
      <div className="wd-toolbar">
        <button onClick={() => setPage('layout')}>← Back to layout</button>
        <b>🏗 Building Design</b>
        <span className="muted">zones · roofs · canopies · free-shape glazing — applies live, saved with the layout</span>
        <button
          className="danger"
          onClick={() => setShellDesign(null)}
          title="Remove the custom design and go back to the simple shell"
        >
          ↺ Reset to simple shell
        </button>
      </div>
      <div className="bd-main">
        <div className="bd-preview">
          <Canvas shadows camera={{ position: [30, 22, 34], fov: 40 }} style={{ background: '#eceae4' }}>
            <ambientLight intensity={0.75} />
            <directionalLight position={[30, 50, 20]} intensity={1.3} castShadow />
            <hemisphereLight intensity={0.3} groundColor="#c8bfae" />
            <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, building.centerZ]} receiveShadow>
              <planeGeometry args={[building.width + 40, building.length + 40]} />
              <meshStandardMaterial color="#d9d4c9" />
            </mesh>
            <SegmentedShell force />
            <OrbitControls target={[0, 4, building.centerZ]} />
          </Canvas>
        </div>
        <div className="bd-panel">
          <h3>1 · Building zones (front → back)</h3>
          <p className="muted small">Each zone has its own height, roof shape, slope and skin. Zone lengths scale to fill the building ({building.length} m).</p>
          {design.segments.map((s, i) => (
            <div key={i} className="bd-row">
              <label>Len <NumInput value={s.len} min={1} step={1} onCommit={(v) => setSeg(i, { len: Math.max(1, v) })} /></label>
              <label>H <NumInput value={s.eave} min={2.5} max={20} step={0.5} onCommit={(v) => setSeg(i, { eave: v })} /></label>
              <select value={s.roof} onChange={(e) => setSeg(i, { roof: e.target.value as ShellSegment['roof'] })}>
                <option value="gable">⌂ Gable</option>
                <option value="slopeL">◺ Slope ←high</option>
                <option value="slopeR">◿ Slope high→</option>
                <option value="flat">▭ Flat</option>
              </select>
              <label>Rise <NumInput value={s.rise} min={0} max={8} step={0.25} onCommit={(v) => setSeg(i, { rise: v })} /></label>
              <label className="bd-check">
                <input type="checkbox" checked={!!s.clear} onChange={(e) => setSeg(i, { clear: e.target.checked })} /> clear
              </label>
              <ColorDots value={s.color} onPick={(c) => setSeg(i, { color: c })} />
              {design.segments.length > 1 && (
                <button className="danger" onClick={() => patch({ segments: design.segments.filter((_, k) => k !== i) })}>✕</button>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              patch({ segments: [...design.segments, { ...design.segments[design.segments.length - 1], len: 8 }] })
            }
          >
            + Add zone
          </button>

          <h3>2 · Canopies / awnings (กันสาด)</h3>
          {design.canopies.map((c, i) => (
            <div key={i} className="bd-row">
              <select value={c.side} onChange={(e) => setCan(i, { side: e.target.value as FacadeSide })}>
                {(['N', 'S', 'E', 'W'] as FacadeSide[]).map((sd) => (
                  <option key={sd} value={sd}>{sd}</option>
                ))}
              </select>
              <label>From <NumInput value={c.u0} min={0} step={0.5} onCommit={(v) => setCan(i, { u0: v })} /></label>
              <label>Len <NumInput value={c.len} min={1} step={0.5} onCommit={(v) => setCan(i, { len: v })} /></label>
              <label>Deep <NumInput value={c.depth} min={0.5} max={8} step={0.25} onCommit={(v) => setCan(i, { depth: v })} /></label>
              <label>H <NumInput value={c.h} min={2} max={6} step={0.1} onCommit={(v) => setCan(i, { h: v })} /></label>
              <select value={c.support} onChange={(e) => setCan(i, { support: e.target.value as CanopyDef['support'] })}>
                <option value="posts">on posts</option>
                <option value="hung">hung (rods)</option>
              </select>
              <select value={c.material} onChange={(e) => setCan(i, { material: e.target.value as CanopyDef['material'] })}>
                <option value="metal">metal</option>
                <option value="canvas">canvas</option>
                <option value="clear">clear</option>
              </select>
              <ColorDots value={c.color} onPick={(cl) => setCan(i, { color: cl })} />
              <button className="danger" onClick={() => patch({ canopies: design.canopies.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <button
            onClick={() =>
              patch({
                canopies: [
                  ...design.canopies,
                  { side: 'S', u0: 1, len: Math.min(6, building.width - 2), depth: 2.5, h: 2.8, support: 'posts', material: 'metal', color: '#b9c0c7' },
                ],
              })
            }
          >
            + Add canopy
          </button>

          <h3>3 · Facade glazing — draw any shape</h3>
          <div className="bd-row">
            {(['N', 'S', 'E', 'W'] as FacadeSide[]).map((sd) => (
              <button key={sd} className={side === sd ? 'on' : ''} onClick={() => { setSide(sd); setDraft([]); setSelPanel(null) }}>
                {SIDE_LABELS[sd]}
              </button>
            ))}
          </div>
          <p className="muted small">
            Tap on the wall to drop polygon points (any shape — triangles, slants, chevrons…), then Add panel. Drag the dots of a
            selected panel to reshape it.
          </p>
          <div className="bd-row">
            <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as FacadePanel['kind'])}>
              <option value="glass">See-through glass</option>
              <option value="clear">Translucent daylight sheet</option>
              <option value="solid">Accent metal patch</option>
            </select>
            <button className="ok" onClick={commitDraft} disabled={draft.length < 3}>✓ Add panel ({draft.length} pts)</button>
            <button onClick={() => setDraft([])} disabled={draft.length === 0}>↺ Clear points</button>
            {selPanel !== null && (
              <button
                className="danger"
                onClick={() => {
                  patch({ panels: design.panels.filter((_, k) => k !== selPanel) })
                  setSelPanel(null)
                }}
              >
                🗑 Delete selected panel
              </button>
            )}
          </div>
          <svg
            ref={svgRef}
            className="bd-svg"
            width={svgW}
            height={svgH}
            onClick={onSvgClick}
            onPointerMove={onPointerMove}
            onPointerUp={() => (dragRef.current = null)}
            onPointerLeave={() => (dragRef.current = null)}
          >
            {/* wall silhouette */}
            <polygon points={silhouette.map(([u, y]) => `${sx(u)},${sy(y)}`).join(' ')} fill="#e6e1d6" stroke="#8a8378" strokeWidth={2} />
            {/* meter grid */}
            {Array.from({ length: Math.floor(wallLen) + 1 }, (_, i) => (
              <line key={`g${i}`} x1={sx(i)} y1={sy(0)} x2={sx(i)} y2={sy(maxH)} stroke="rgba(0,0,0,0.06)" />
            ))}
            {Array.from({ length: Math.floor(maxH) + 1 }, (_, i) => (
              <line key={`h${i}`} x1={sx(0)} y1={sy(i)} x2={sx(wallLen)} y2={sy(i)} stroke="rgba(0,0,0,0.06)" />
            ))}
            {/* existing panels on this side */}
            {sidePanels.map(({ p, i }) => (
              <g key={i}>
                <polygon
                  points={p.pts.map(([u, y]) => `${sx(u)},${sy(y)}`).join(' ')}
                  fill={fillFor(p.kind)}
                  stroke={selPanel === i ? '#2563eb' : '#5c7fa6'}
                  strokeWidth={selPanel === i ? 3 : 1.5}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelPanel(selPanel === i ? null : i)
                  }}
                />
                {selPanel === i &&
                  p.pts.map(([u, y], k) => (
                    <circle
                      key={k}
                      cx={sx(u)}
                      cy={sy(y)}
                      r={7}
                      fill="#2563eb"
                      stroke="#fff"
                      strokeWidth={2}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        ;(e.target as SVGCircleElement).setPointerCapture(e.pointerId)
                        dragRef.current = { panel: i, pt: k }
                      }}
                    />
                  ))}
              </g>
            ))}
            {/* draft polygon */}
            {draft.length > 0 && (
              <>
                <polygon points={draft.map(([u, y]) => `${sx(u)},${sy(y)}`).join(' ')} fill="rgba(37,99,235,0.15)" stroke="#2563eb" strokeDasharray="6 4" strokeWidth={2} />
                {draft.map(([u, y], k) => (
                  <circle key={k} cx={sx(u)} cy={sy(y)} r={5} fill="#2563eb" />
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  )
}
