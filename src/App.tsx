import { useEffect } from 'react'
import { Scene } from './components/Scene'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Inspector } from './components/Inspector'
import { StatsPanel } from './components/StatsPanel'
import { useStore } from './store'

export default function App() {
  const panelRight = useStore((s) => s.panelRight)
  const setPanelLeft = useStore((s) => s.setPanelLeft)
  const setPanelRight = useStore((s) => s.setPanelRight)
  const panelLeft = useStore((s) => s.panelLeft)
  const selectedId = useStore((s) => s.selectedId)
  const placing = useStore((s) => s.placingDef !== null)
  const rotate = useStore((s) => s.rotate)
  const removeSelected = useStore((s) => s.removeSelected)
  const cancelPlacing = useStore((s) => s.cancelPlacing)

  // Global keyboard shortcuts: R rotate, Delete remove, Esc cancel/deselect, G grid, L labels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const s = useStore.getState()
      switch (e.key) {
        case 'r':
        case 'R':
          s.rotate()
          break
        case 'Delete':
        case 'Backspace':
          s.removeSelected()
          break
        case 'Escape':
          if (s.placingDef) s.cancelPlacing()
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
          {/* mobile-only: quick actions for the selected object (no keyboard on touch) */}
          {selectedId && !placing && (
            <div className="quick-actions">
              <button onClick={rotate}>↻ Rotate</button>
              <button onClick={() => setPanelRight(true)}>✎ Edit</button>
              <button className="danger" onClick={removeSelected}>
                🗑 Delete
              </button>
            </div>
          )}
          {placing && (
            <button className="placing-hint" onClick={cancelPlacing}>
              Tap the floor to place · tap here to cancel
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
