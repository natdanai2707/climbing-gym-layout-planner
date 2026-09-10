import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  normalizedPts,
  presetPts,
  useWindowStore,
  windowSize,
  type WindowPreset,
} from '../window/windowStore'
import { NumInput } from './NumInput'

const PRESETS: Array<{ id: WindowPreset; label: string }> = [
  { id: 'rect', label: '▭ Rectangle' },
  { id: 'arch', label: '⌒ Arch head' },
  { id: 'gable', label: '⌂ Gable light' },
  { id: 'rake', label: '◺ Raked' },
  { id: 'round', label: '◯ Oval' },
  { id: 'porthole', label: '⬤ Porthole' },
]

const SWATCHES = ['#6b7280', '#2f3237', '#8f979f', '#b45341', '#c9a06c', '#f6f3ed']
const GLASS = ['#9ec8d8', '#aed3e4', '#bcd7cf', '#c8cfd8', '#8fb0c4', '#d8e4ea']

/**
 * Window Design page: draw the outline of a glazed opening on a metre grid,
 * then save it to the library. Saved windows show up in the object palette and
 * drop onto the building shell or an interior partition like any other item.
 */
export function WindowDesigner() {
  const setPage = useStore((s) => s.setPage)
  const draft = useWindowStore((s) => s.draft)
  const designs = useWindowStore((s) => s.designs)
  const selected = useWindowStore((s) => s.selected)
  const setSelected = useWindowStore((s) => s.setSelected)
  const setDraft = useWindowStore((s) => s.setDraft)
  const movePoint = useWindowStore((s) => s.movePoint)
  const addPointAfter = useWindowStore((s) => s.addPointAfter)
  const removePoint = useWindowStore((s) => s.removePoint)
  const applyPreset = useWindowStore((s) => s.applyPreset)
  const scaleTo = useWindowStore((s) => s.scaleTo)
  const saveDraft = useWindowStore((s) => s.saveDraft)
  const loadDesign = useWindowStore((s) => s.loadDesign)
  const newDraft = useWindowStore((s) => s.newDraft)
  const deleteDesign = useWindowStore((s) => s.deleteDesign)

  const [panelOpen, setPanelOpen] = useState(false)
  const [snap, setSnap] = useState(0.1)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragging = useRef<number | null>(null)

  const size = windowSize(draft)
  const pts = useMemo(() => normalizedPts(draft), [draft])

  // one shared mapping between metres and the drawing area
  const PAD = 0.6
  const vw = size.w + PAD * 2
  const vh = size.h + PAD * 2
  const toSvg = (x: number, y: number) => [x + PAD, size.h - y + PAD] as [number, number]
  const fromSvg = (sx: number, sy: number) => [sx - PAD, size.h - (sy - PAD)] as [number, number]

  const pointerMetres = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * vw
    const sy = ((e.clientY - r.top) / r.height) * vh
    const [x, y] = fromSvg(sx, sy)
    const q = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v)
    return [q(x), q(y)] as [number, number]
  }

  const onMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return
    const m = pointerMetres(e)
    if (m) movePoint(dragging.current, m[0], m[1])
  }

  // grid lines every metre across the drawing area
  const gridX = Array.from({ length: Math.floor(size.w) + 1 }, (_, i) => i)
  const gridY = Array.from({ length: Math.floor(size.h) + 1 }, (_, i) => i)

  const outline = pts.map((p) => toSvg(p[0], p[1]).join(',')).join(' ')

  const onSave = () => {
    const prev = useWindowStore.getState().designs.find((d) => d.id === draft.id)
    saveDraft()
    if (prev) {
      // refit copies already placed in the layout — both the facade and the
      // partition variant of this design
      const before = windowSize(prev)
      for (const [pfx, depth] of [
        ['win', 0.3],
        ['winp', 0.15],
      ] as const) {
        useStore
          .getState()
          .syncDesignDims(
            `${pfx}:${draft.id}`,
            { w: before.w, d: depth, h: before.h },
            { w: size.w, d: depth, h: size.h },
          )
      }
    }
  }

  return (
    <div className="wall-page">
      <header className="toolbar">
        <div className="tb-title">🪟 Window Design</div>
        <div className="tb-group">
          <label className="tb-field">
            <span>Name</span>
            <input type="text" className="wd-name" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
          </label>
          <button className="save" onClick={onSave} title="Save to the window library — placed copies in the layout update too">
            💾 Save to library
          </button>
          <button onClick={newDraft}>＋ New window</button>
        </div>
        <div className="tb-group">
          <button onClick={() => setPage('layout')}>← Back to layout</button>
        </div>
      </header>

      <div className="main">
        <aside className={`palette wall-params${panelOpen ? ' open' : ''}`}>
          <button className="drawer-close" onClick={() => setPanelOpen(false)}>
            ✕ Close
          </button>

          <h2 className="wd-sec-title">Start from a shape</h2>
          <div className="wd-presets">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>

          <h2 className="wd-sec-title">Size</h2>
          <div className="insp-grid">
            <label>
              <span>Width (m)</span>
              <NumInput value={size.w} step={0.1} min={0.2} onCommit={(v) => scaleTo(v, size.h)} />
            </label>
            <label>
              <span>Height (m)</span>
              <NumInput value={size.h} step={0.1} min={0.2} onCommit={(v) => scaleTo(size.w, v)} />
            </label>
            <label>
              <span>Default sill (m)</span>
              <NumInput value={draft.sill} step={0.1} min={0} onCommit={(v) => setDraft({ sill: v })} />
            </label>
            <label>
              <span>Snap (m)</span>
              <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
                <option value={0}>off</option>
                <option value={0.05}>0.05</option>
                <option value={0.1}>0.1</option>
                <option value={0.25}>0.25</option>
                <option value={0.5}>0.5</option>
              </select>
            </label>
          </div>

          <h2 className="wd-sec-title">Frame &amp; glazing</h2>
          <div className="insp-grid">
            <label>
              <span>Frame width (m)</span>
              <NumInput value={draft.frameW} step={0.01} min={0} onCommit={(v) => setDraft({ frameW: v })} />
            </label>
            <label>
              <span>Vertical bars</span>
              <NumInput value={draft.barsX} step={1} min={0} onCommit={(v) => setDraft({ barsX: Math.round(v) })} />
            </label>
            <label>
              <span>Horizontal bars</span>
              <NumInput value={draft.barsY} step={1} min={0} onCommit={(v) => setDraft({ barsY: Math.round(v) })} />
            </label>
          </div>
          <div className="wd-dots">
            <span className="muted">Frame</span>
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`dot${draft.frame === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setDraft({ frame: c })}
              />
            ))}
          </div>
          <div className="wd-dots">
            <span className="muted">Glass</span>
            {GLASS.map((c) => (
              <button
                key={c}
                className={`dot${draft.glass === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setDraft({ glass: c })}
              />
            ))}
          </div>

          {selected !== null && (
            <>
              <h2 className="wd-sec-title">Corner {selected + 1}</h2>
              <div className="insp-grid">
                <label>
                  <span>X (m)</span>
                  <NumInput
                    value={pts[selected]?.[0] ?? 0}
                    step={0.05}
                    onCommit={(v) => movePoint(selected, v, pts[selected]?.[1] ?? 0)}
                  />
                </label>
                <label>
                  <span>Y (m)</span>
                  <NumInput
                    value={pts[selected]?.[1] ?? 0}
                    step={0.05}
                    onCommit={(v) => movePoint(selected, pts[selected]?.[0] ?? 0, v)}
                  />
                </label>
              </div>
              <div className="wd-presets">
                <button onClick={() => addPointAfter(selected)}>＋ Add corner after</button>
                <button className="danger" onClick={() => removePoint(selected)}>
                  ✕ Remove corner
                </button>
              </div>
            </>
          )}

          <h2 className="wd-sec-title">Window library</h2>
          {designs.length === 0 && <p className="muted">Nothing saved yet — draw a shape and press Save.</p>}
          {designs.map((d) => {
            const s = windowSize(d)
            return (
              <div key={d.id} className="wd-lib-row">
                <button className="wd-lib-load" onClick={() => loadDesign(d.id)} title="Load into the editor">
                  <span className="swatch" style={{ background: d.glass }} />
                  {d.name} · {s.w} × {s.h} m
                </button>
                <button className="danger" onClick={() => deleteDesign(d.id)}>
                  ✕
                </button>
              </div>
            )
          })}
          <p className="muted">
            Saved windows appear in the palette under <b>Glass Openings</b> — one to drop on the building shell, one for
            interior partitions.
          </p>
        </aside>

        <div className="canvas-wrap">
          <svg
            ref={svgRef}
            className="win-canvas"
            viewBox={`0 0 ${vw} ${vh}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={onMove}
            onPointerUp={() => (dragging.current = null)}
            onPointerLeave={() => (dragging.current = null)}
          >
            <rect x={0} y={0} width={vw} height={vh} fill="#f2efe9" />
            {/* metre grid over the window's own extent */}
            <g stroke="#cfc8bb" strokeWidth={0.008}>
              {gridX.map((i) => (
                <line key={`x${i}`} x1={toSvg(i, 0)[0]} y1={toSvg(0, 0)[1]} x2={toSvg(i, 0)[0]} y2={toSvg(0, size.h)[1]} />
              ))}
              {gridY.map((i) => (
                <line key={`y${i}`} x1={toSvg(0, 0)[0]} y1={toSvg(0, i)[1]} x2={toSvg(size.w, 0)[0]} y2={toSvg(0, i)[1]} />
              ))}
            </g>
            {/* the opening: frame band drawn as a thick stroke, glass inside */}
            <polygon
              points={outline}
              fill={draft.glass}
              fillOpacity={0.55}
              stroke={draft.frame}
              strokeWidth={Math.max(0.02, draft.frameW * 2)}
              strokeLinejoin="round"
            />
            {/* glazing bars, clipped to the shape by drawing them under the outline stroke */}
            <g stroke={draft.frame} strokeWidth={0.03} opacity={0.85}>
              {Array.from({ length: draft.barsX }, (_, i) => {
                const x = (size.w * (i + 1)) / (draft.barsX + 1)
                return <line key={`bx${i}`} x1={toSvg(x, 0)[0]} y1={toSvg(0, 0)[1]} x2={toSvg(x, 0)[0]} y2={toSvg(0, size.h)[1]} />
              })}
              {Array.from({ length: draft.barsY }, (_, i) => {
                const y = (size.h * (i + 1)) / (draft.barsY + 1)
                return <line key={`by${i}`} x1={toSvg(0, 0)[0]} y1={toSvg(0, y)[1]} x2={toSvg(size.w, 0)[0]} y2={toSvg(0, y)[1]} />
              })}
            </g>
            {/* corner handles: drag to reshape, tap to select */}
            {pts.map((p, i) => {
              const [cx, cy] = toSvg(p[0], p[1])
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={selected === i ? 0.1 : 0.075}
                  fill={selected === i ? '#f97316' : '#ffffff'}
                  stroke="#4b5563"
                  strokeWidth={0.02}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    dragging.current = i
                    setSelected(i)
                  }}
                  onDoubleClick={() => removePoint(i)}
                />
              )
            })}
          </svg>
          <div className="fab-row">
            <button className="fab" onClick={() => setPanelOpen(true)}>
              ⚙ Shape
            </button>
          </div>
          <div className="wd-hint">
            Drag a corner to reshape · tap one to add or remove corners · double-tap removes
          </div>
        </div>
      </div>
    </div>
  )
}

// starting outline for a brand-new design, exported for tests/tools
export const STARTER_OUTLINE = presetPts('rect', 3, 2)
