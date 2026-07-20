import { useEffect } from 'react'
import { Scene } from './components/Scene'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Inspector } from './components/Inspector'
import { StatsPanel } from './components/StatsPanel'
import { useStore } from './store'

export default function App() {
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
        </div>
        <div className="right">
          <Inspector />
          <StatsPanel />
        </div>
      </div>
    </div>
  )
}
