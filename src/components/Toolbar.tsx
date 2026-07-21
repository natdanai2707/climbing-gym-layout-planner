import { useRef } from 'react'
import { exportLayout, useStore } from '../store'
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
  const setBuilding = useStore((s) => s.setBuilding)
  const showGrid = useStore((s) => s.showGrid)
  const showLabels = useStore((s) => s.showLabels)
  const toggleGrid = useStore((s) => s.toggleGrid)
  const toggleLabels = useStore((s) => s.toggleLabels)
  const resetView = useStore((s) => s.resetView)
  const shellMode = useStore((s) => s.shell.mode)
  const cycleShell = useStore((s) => s.cycleShell)
  const clearAll = useStore((s) => s.clearAll)
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
      </div>
      <div className="tb-group">
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
