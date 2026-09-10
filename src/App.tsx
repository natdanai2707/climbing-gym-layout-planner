import { useEffect, useRef } from 'react'
import { Scene, captureStill, walkInput, walkLook } from './components/Scene'
import { ThumbnailFactory } from './components/Thumbnails'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Inspector } from './components/Inspector'
import { StatsPanel } from './components/StatsPanel'
import { WallDesigner } from './components/WallDesigner'
import { BuildingDesigner } from './components/BuildingDesigner'
import { WindowDesigner } from './components/WindowDesigner'
import { useStore } from './store'
import { viewAxis, screenRight } from './viewAxis'
import { useWallStore } from './wall/wallStore'
import { fp } from './placement'

// On-screen joystick for touch devices: writes into a shared {x, y} target
// read by the walk rig every frame. Used twice — left stick walks
// (walkInput), right stick turns the view (walkLook).
function WalkJoystick({ target, look = false }: { target: { x: number; y: number }; look?: boolean }) {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const base = baseRef.current
    const knob = knobRef.current
    if (!base || !knob) return
    let pid = -1
    const R = 44
    const setKnob = (dx: number, dy: number) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const apply = (e: PointerEvent) => {
      const r = base.getBoundingClientRect()
      let dx = e.clientX - (r.left + r.width / 2)
      let dy = e.clientY - (r.top + r.height / 2)
      const l = Math.hypot(dx, dy)
      if (l > R) {
        dx = (dx / l) * R
        dy = (dy / l) * R
      }
      target.x = dx / R
      target.y = dy / R
      setKnob(dx, dy)
    }
    const down = (e: PointerEvent) => {
      pid = e.pointerId
      base.setPointerCapture(pid)
      apply(e) // react immediately, even to a tap-and-hold at the rim
      e.stopPropagation()
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      apply(e)
      e.stopPropagation()
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      pid = -1
      target.x = 0
      target.y = 0
      setKnob(0, 0)
    }
    base.addEventListener('pointerdown', down)
    base.addEventListener('pointermove', move)
    base.addEventListener('pointerup', up)
    base.addEventListener('pointercancel', up)
    return () => {
      target.x = 0
      target.y = 0
      base.removeEventListener('pointerdown', down)
      base.removeEventListener('pointermove', move)
      base.removeEventListener('pointerup', up)
      base.removeEventListener('pointercancel', up)
    }
  }, [target])
  return (
    <div ref={baseRef} className={`walk-joystick${look ? ' look' : ''}`}>
      <div ref={knobRef} className="walk-knob">
        {look ? '⟲' : '✥'}
      </div>
    </div>
  )
}

export default function App() {
  const page = useStore((s) => s.page)
  const panelRight = useStore((s) => s.panelRight)
  const setPanelLeft = useStore((s) => s.setPanelLeft)
  const setPanelRight = useStore((s) => s.setPanelRight)
  const panelLeft = useStore((s) => s.panelLeft)
  const selectedId = useStore((s) => s.selectedId)
  const placing = useStore((s) => s.placingDef !== null)
  const pendingId = useStore((s) => s.pendingId)
  const objects = useStore((s) => s.objects)
  const rotate = useStore((s) => s.rotate)
  const removeSelected = useStore((s) => s.removeSelected)
  const cancelPlacing = useStore((s) => s.cancelPlacing)
  const confirmPending = useStore((s) => s.confirmPending)
  const cancelPending = useStore((s) => s.cancelPending)
  const updateObject = useStore((s) => s.updateObject)
  const moveArmed = useStore((s) => s.moveArmed)
  const setMoveArmed = useStore((s) => s.setMoveArmed)
  const walking = useStore((s) => s.viewMode === 'walk')
  const setViewMode = useStore((s) => s.setViewMode)
  const measuring = useStore((s) => s.measuring)
  const shots = useStore((s) => s.shots)
  const addShot = useStore((s) => s.addShot)
  const clearShots = useStore((s) => s.clearShots)

  const takeShot = () => captureStill((url) => addShot(url))
  const downloadShot = (url: string, i: number) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `gym-walkthrough-${String(i + 1).padStart(2, '0')}.png`
    a.click()
  }
  const downloadAllShots = () => {
    shots.forEach((url, i) => setTimeout(() => downloadShot(url, i), i * 350))
  }

  const pending = objects.find((o) => o.id === pendingId)
  // a selected placed custom wall can be reshaped on the Wall Design page
  const selObj = objects.find((o) => o.id === selectedId)
  const shapeDesignId = selObj?.category === 'wall_custom' ? selObj.defId.replace(/^custom:/, '') : null
  const canShape = useWallStore((s) => (shapeDesignId ? s.designs.some((d) => d.id === shapeDesignId) : false))
  const openShape = () => {
    if (!shapeDesignId) return
    useWallStore.getState().loadDesign(shapeDesignId)
    useStore.getState().setPage('wall')
  }
  // is the pending object over a mezzanine (so it could be lifted onto it)?
  const overMezz =
    pending &&
    pending.category !== 'mezzanine' &&
    objects.some((m) => {
      if (m.category !== 'mezzanine') return false
      const { fw, fd } = fp(m)
      return Math.abs(pending.x - m.x) <= fw / 2 && Math.abs(pending.z - m.z) <= fd / 2
    })

  // Global keyboard shortcuts: R rotate 45°, Enter confirm, Delete remove,
  // Esc cancel/deselect, G grid, L labels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const s = useStore.getState()
      if (s.page === 'wall') return
      if (s.viewMode === 'walk') {
        // walking uses WASD/arrows for movement; Esc steps back out
        if (e.key === 'Escape') s.setViewMode('iso')
        return
      }
      if (s.measuring && e.key === 'Escape') {
        s.toggleMeasure()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        s.redo()
        return
      }
      // Arrow keys nudge the selected item once Move is armed (or while a
      // freshly dropped item is still pending). Steps follow the screen, not
      // the world: ↑ pushes away from the camera whichever way it is orbited.
      if (e.key.startsWith('Arrow') && s.selectedId && (s.moveArmed || s.pendingId === s.selectedId)) {
        e.preventDefault()
        const step = e.shiftKey ? 0.1 : s.building.cell
        const f = viewAxis
        const r = screenRight()
        const d = {
          ArrowUp: [f.fx, f.fz],
          ArrowDown: [-f.fx, -f.fz],
          ArrowRight: [r.x, r.z],
          ArrowLeft: [-r.x, -r.z],
        }[e.key]
        if (d) s.nudge(d[0] * step, d[1] * step)
        return
      }
      switch (e.key) {
        case 'r':
        case 'R':
          s.rotate()
          break
        case 'Enter':
          if (s.pendingId) s.confirmPending()
          break
        case 'Delete':
        case 'Backspace':
          s.removeSelected()
          break
        case 'Escape':
          if (s.pendingId) s.cancelPending()
          else if (s.placingDef) s.cancelPlacing()
          else s.select(null)
          break
        case 'g':
        case 'G':
          s.toggleGrid()
          break
        case 'l':
        case 'L':
          s.toggleLabels()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (page === 'wall') return <WallDesigner />
  if (page === 'building') return <BuildingDesigner />
  if (page === 'window') return <WindowDesigner />

  return (
    <div className="app">
      <ThumbnailFactory />
      <Toolbar />
      <div className="main">
        <Palette />
        <div className="canvas-wrap">
          <Scene />
          {/* first-person walk overlay */}
          {walking && (
            <>
              <button className="walk-exit" onClick={() => setViewMode('iso')}>
                ✕ Exit walk (Esc)
              </button>
              <button className="walk-shot" onClick={takeShot} title="Capture this view for the presentation set">
                📸
              </button>
              <div className="walk-hint">Left stick / WASD walk · right stick or drag to look · 📸 snap</div>
              <WalkJoystick target={walkInput} />
              <WalkJoystick target={walkLook} look />
            </>
          )}
          {measuring && !walking && (
            <div className="measure-hint">📏 Tap two points on the floor · Esc or the button to finish</div>
          )}
          {/* walkthrough shot gallery */}
          {shots.length > 0 && (
            <div className="shots-panel">
              <div className="shots-head">
                <b>📸 {shots.length} shot{shots.length > 1 ? 's' : ''}</b>
                <button onClick={downloadAllShots}>⬇ All</button>
                <button className="danger" onClick={clearShots}>
                  ✕
                </button>
              </div>
              <div className="shots-strip">
                {shots.map((url, i) => (
                  <img key={i} src={url} alt={`shot ${i + 1}`} title="Tap to download" onClick={() => downloadShot(url, i)} />
                ))}
              </div>
            </div>
          )}
          {/* mobile-only: drawer toggles */}
          {!walking && (
            <div className="fab-row">
              <button onClick={() => setPanelLeft(!panelLeft)}>☰ Objects</button>
              <button onClick={() => setPanelRight(!panelRight)}>📋 Edit / Stats</button>
            </div>
          )}
          {/* quick actions for a selected (already confirmed) object — all devices.
              Move must be armed explicitly so accidental touches can't shift items. */}
          {!walking && selectedId && !placing && !pending && (
            <div className="quick-actions">
              <button className={moveArmed ? 'on' : ''} onClick={() => setMoveArmed(!moveArmed)}>
                ✥ Move{moveArmed ? ': ON' : ''}
              </button>
              <button onClick={rotate}>↻ 45°</button>
              {canShape && <button onClick={openShape}>🧱 Shape</button>}
              <button onClick={() => setPanelRight(true)}>✎ Edit</button>
              <button className="danger" onClick={removeSelected}>
                🗑 Delete
              </button>
            </div>
          )}
          {!walking && moveArmed && selectedId && !pending && (
            <div className="move-hint">Drag the highlighted item — or nudge it with ← ↑ → ↓ (Shift = 10 cm)</div>
          )}
          {/* pending placement: adjust with the arrows, then confirm (all devices) */}
          {!walking && pending && (
            <div className="pending-bar">
              <span className="pb-hint">Drag arrows to resize · drag body to move</span>
              <div className="pb-buttons">
                <button className="ok" onClick={confirmPending}>
                  ✓ Place
                </button>
                <button onClick={rotate}>↻ 45°</button>
                {overMezz && (
                  <button
                    onClick={() =>
                      updateObject(pending.id, { level: pending.level === 'upper' ? 'ground' : 'upper' })
                    }
                  >
                    {pending.level === 'upper' ? '⬇ To ground' : '⬆ On mezzanine'}
                  </button>
                )}
                <button className="danger" onClick={cancelPending}>
                  ✕ Cancel
                </button>
              </div>
            </div>
          )}
          {placing && (
            <button className="placing-hint" onClick={cancelPlacing}>
              Tap the floor to drop · tap here to cancel
            </button>
          )}
        </div>
        <div className={`right${panelRight ? ' open' : ''}`}>
          <button className="drawer-close" onClick={() => setPanelRight(false)}>
            ✕ Close
          </button>
          <Inspector />
          <StatsPanel />
        </div>
      </div>
    </div>
  )
}
