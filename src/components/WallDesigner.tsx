import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useStore } from '../store'
import { useWallStore } from '../wall/wallStore'
import { WallModel } from '../wall/WallModel'
import { designDepth, designWidth } from '../wall/profile'
import { export3MF, exportDAE, exportSTL } from '../wall/exporters'

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

/**
 * "Wall Design" page: a parametric climbing-wall designer. Adjust the shape
 * (per-section angles with an optional break point), dimensions, the free
 * space behind the panels and the landing mat, preview in 3D, save the model
 * to the library (it becomes a placeable item in the layout planner), and
 * export STL / 3MF / COLLADA-for-SketchUp files.
 */
export function WallDesigner() {
  const setPage = useStore((s) => s.setPage)
  const draft = useWallStore((s) => s.draft)
  const designs = useWallStore((s) => s.designs)
  const setDraft = useWallStore((s) => s.setDraft)
  const setSection = useWallStore((s) => s.setSection)
  const addSection = useWallStore((s) => s.addSection)
  const removeSection = useWallStore((s) => s.removeSection)
  const saveDraft = useWallStore((s) => s.saveDraft)
  const loadDesign = useWallStore((s) => s.loadDesign)
  const newDraft = useWallStore((s) => s.newDraft)
  const deleteDesign = useWallStore((s) => s.deleteDesign)

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
        <aside className="palette wall-params">
          <h2>Wall dimensions</h2>
          <div className="insp-grid">
            <Num label="Height (m)" value={draft.height} min={1} max={20} onChange={(v) => setDraft({ height: v })} />
            <Num label="Panel thickness (m)" value={draft.thickness} step={0.01} min={0.02} max={0.5} onChange={(v) => setDraft({ thickness: v })} />
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
              <span>Panel color</span>
              <input type="color" value={draft.color} onChange={(e) => setDraft({ color: e.target.value })} />
            </label>
          </div>
          <div className="insp-meta muted">
            Total: {W.toFixed(1)} m wide · {depth.toFixed(1)} m deep · {draft.height.toFixed(1)} m high
          </div>

          <h2 className="wd-sec-title">Sections (left → right)</h2>
          {draft.sections.map((sec, i) => (
            <div key={i} className="wd-section">
              <div className="wd-sec-head">
                <b>Section {i + 1}</b>
                <button className="danger" onClick={() => removeSection(i)} disabled={draft.sections.length <= 1}>
                  ✕
                </button>
              </div>
              <div className="insp-grid">
                <Num label="Width (m)" value={sec.width} min={0.5} max={20} onChange={(v) => setSection(i, { width: v })} />
                <Num label="Kicker height (m)" value={sec.kickerH} min={0} max={3} onChange={(v) => setSection(i, { kickerH: v })} />
                <Num
                  label="Angle (°, + overhang)"
                  value={sec.angle1}
                  step={1}
                  min={-30}
                  max={70}
                  onChange={(v) => setSection(i, { angle1: v })}
                />
                <Num
                  label="Break at height (m)"
                  value={sec.breakH}
                  min={0}
                  max={draft.height}
                  onChange={(v) => setSection(i, { breakH: v })}
                />
                <Num
                  label="Angle above break (°)"
                  value={sec.angle2}
                  step={1}
                  min={-30}
                  max={70}
                  onChange={(v) => setSection(i, { angle2: v })}
                />
              </div>
            </div>
          ))}
          <button className="wide" onClick={addSection}>
            ＋ Add section
          </button>

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
            <WallModel design={draft} />
          </Canvas>
          <div className="wd-hint">Drag to orbit · scroll to zoom · edit parameters on the left</div>
        </div>
      </div>
    </div>
  )
}
