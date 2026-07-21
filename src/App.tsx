import { useEffect } from 'react'
import { Scene } from './components/Scene'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Inspector } from './components/Inspector'
import { StatsPanel } from './components/StatsPanel'
import { useStore } from './store'
import { fp } from './placement'

export default function App() {
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

  const pending = objects.find((o) => o.id === pendingId)
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

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Palette />
        <div className="canvas-wrap">
          <Scene />
          {/* mobile-only: drawer toggles */}
          <div className="fab-row">
            <button onClick={() => setPanelLeft(!panelLeft)}>☰ Objects</button>
            <button onClick={() => setPanelRight(!panelRight)}>📋 Edit / Stats</button>
          </div>
          {/* quick actions for a selected (already confirmed) object — all devices.
              Move must be armed explicitly so accidental touches can't shift items. */}
          {selectedId && !placing && !pending && (
            <div className="quick-actions">
              <button className={moveArmed ? 'on' : ''} onClick={() => setMoveArmed(!moveArmed)}>
                ✥ Move{moveArmed ? ': ON' : ''}
              </button>
              <button onClick={rotate}>↻ 45°</button>
              <button onClick={() => setPanelRight(true)}>✎ Edit</button>
              <button className="danger" onClick={removeSelected}>
                🗑 Delete
              </button>
            </div>
          )}
          {moveArmed && selectedId && !pending && <div className="move-hint">Drag the highlighted item to move it</div>}
          {/* pending placement: adjust with the arrows, then confirm (all devices) */}
          {pending && (
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
