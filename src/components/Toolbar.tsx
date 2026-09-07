import { useRef } from 'react'
import { exportLayout, useStore } from '../store'
import type { ThemeName } from '../store'
import type { LayoutFile } from '../types'
import { canvasCapture } from './Scene'

function download(filename: string, url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="tb-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </label>
  )
}

export function Toolbar() {
  const building = useStore((s) => s.building)
  const setBuilding = useStore((s) => s.setBuildingUndoable)
  const showGrid = useStore((s) => s.showGrid)
  const showLabels = useStore((s) => s.showLabels)
  const toggleGrid = useStore((s) => s.toggleGrid)
  const toggleLabels = useStore((s) => s.toggleLabels)
  const resetView = useStore((s) => s.resetView)
  const shellMode = useStore((s) => s.shell.mode)
  const eave = useStore((s) => s.shell.eave)
  const setEave = useStore((s) => s.setShellEaveUndoable)
  const cycleShell = useStore((s) => s.cycleShell)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const setPage = useStore((s) => s.setPage)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const viewPreset = useStore((s) => s.viewPreset)
  const setViewPreset = useStore((s) => s.setViewPreset)
  const lightMood = useStore((s) => s.lightMood)
  const setLightMood = useStore((s) => s.setLightMood)
  const clayMode = useStore((s) => s.clayMode)
  const toggleClay = useStore((s) => s.toggleClay)
  const realMode = useStore((s) => s.realMode)
  const toggleReal = useStore((s) => s.toggleReal)
  const applyTheme = useStore((s) => s.applyTheme)
  const floor = useStore((s) => s.floor)
  const setFloor = useStore((s) => s.setFloor)
  const measuring = useStore((s) => s.measuring)
  const toggleMeasure = useStore((s) => s.toggleMeasure)
  const addShot = useStore((s) => s.addShot)
  const clearAll = useStore((s) => s.clearAll)

  const takeShot = () => {
    const el = canvasCapture.el
    if (el) addShot(el.toDataURL('image/png'))
  }
  const importLayout = useStore((s) => s.importLayout)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportLayout(), null, 2)], { type: 'application/json' })
    download('gym-layout.json', URL.createObjectURL(blob))
  }

  const exportPng = () => {
    const el = canvasCapture.el
    if (!el) return
    download('gym-layout.png', el.toDataURL('image/png'))
  }

  const onImportFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as LayoutFile
      importLayout(data)
    } catch {
      alert('Invalid layout JSON file')
    }
  }

  return (
    <header className="toolbar">
      <div className="tb-title">
        🧗 Gym Layout Planner
      </div>
      <div className="tb-group">
        <NumberField label="Width (m)" value={building.width} min={2} max={200} onChange={(v) => setBuilding({ width: v })} />
        <NumberField label="Length (m)" value={building.length} min={2} max={300} onChange={(v) => setBuilding({ length: v })} />
        <label className="tb-field">
          <span>Grid (m)</span>
          <select value={building.cell} onChange={(e) => setBuilding({ cell: parseFloat(e.target.value) })}>
            <option value={0.5}>0.5</option>
            <option value={1}>1</option>
          </select>
        </label>
        <NumberField label="Apron (m)" value={building.apron} min={0} max={50} onChange={(v) => setBuilding({ apron: v })} />
        <NumberField label="Ceiling (m)" value={eave} min={3} max={20} step={0.5} onChange={setEave} />
      </div>
      <div className="tb-group">
        <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          ↶ Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">
          ↷ Redo
        </button>
        <div className="view-seg" role="group" title="Camera views — zoom follows the cursor / finger">
          {(
            [
              ['iso', '3D'],
              ['top', 'Top'],
              ['front', 'Front'],
              ['side', 'Side'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={viewMode === 'iso' && viewPreset === v ? 'on' : ''}
              onClick={() => setViewPreset(v)}
            >
              {label}
            </button>
          ))}
          <button
            className={viewMode === 'walk' ? 'on' : ''}
            onClick={() => setViewMode(viewMode === 'walk' ? 'iso' : 'walk')}
            title="First-person view: walk through the gym at eye level"
          >
            🚶 Walk
          </button>
        </div>
        <label className="tb-field">
          <span>Light</span>
          <select value={lightMood} onChange={(e) => setLightMood(e.target.value as 'day' | 'golden' | 'night')}>
            <option value="day">☀ Day</option>
            <option value="golden">🌇 Sunset</option>
            <option value="night">🌙 Night</option>
          </select>
        </label>
        <button className={clayMode ? 'on' : ''} onClick={toggleClay} title="Architect clay-model render style">
          🏛 Clay
        </button>
        <button
          className={realMode ? 'on' : ''}
          onClick={toggleReal}
          title="Realistic render: real sky, soft shadows, polished reflective floor"
        >
          ✨ Real
        </button>
        <label className="tb-field">
          <span>Theme</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) applyTheme(e.target.value as ThemeName)
              e.target.value = ''
            }}
            title="One-tap color & material scheme for walls, zones, mats and floor (undoable)"
          >
            <option value="">Apply…</option>
            <option value="teal">Teal + Concrete</option>
            <option value="birch">Birch + Pastel</option>
            <option value="mono">Mono White</option>
          </select>
        </label>
        <label className="tb-field">
          <span>Floor</span>
          <select
            value={floor.material}
            onChange={(e) => setFloor({ material: e.target.value as typeof floor.material })}
            title="Hall floor finish"
          >
            <option value="paint">Painted</option>
            <option value="concrete">Concrete</option>
            <option value="birch">Birch wood</option>
            <option value="epdm">EPDM rubber</option>
          </select>
        </label>
        <button
          className={measuring ? 'on' : ''}
          onClick={toggleMeasure}
          title="Measuring tape: tap two points on the floor; repeat for more runs"
        >
          📏 Measure
        </button>
        <button onClick={takeShot} title="Capture the current view into the shot gallery">
          📸 Shot
        </button>
        <button onClick={resetView} title="Return to the default isometric view">Reset view</button>
        <button className={showGrid ? 'on' : ''} onClick={toggleGrid} title="G">Grid</button>
        <button className={showLabels ? 'on' : ''} onClick={toggleLabels} title="L">Labels</button>
        <button
          className={shellMode > 0 ? 'on' : ''}
          onClick={cycleShell}
          title="Cycle the warehouse shell: off → transparent → complete building with doors and windows"
        >
          {shellMode === 0 ? '🏭 Shell: Off' : shellMode === 1 ? '🏭 Shell: Clear' : '🏭 Shell: Solid'}
        </button>
      </div>
      <div className="tb-group">
        <button onClick={() => setPage('wall')} title="Design a custom climbing wall">
          🧱 Wall Design
        </button>
        <button className="save" onClick={exportJson}>💾 Save JSON</button>
        <button onClick={() => fileRef.current?.click()}>Import JSON</button>
        <button onClick={exportPng}>Export PNG</button>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Clear the entire layout?')) clearAll()
          }}
        >
          New / Clear
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
