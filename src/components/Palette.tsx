import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '../catalog'
import type { ObjectDef } from '../types'
import { useStore } from '../store'

function PaletteCard({ def }: { def: ObjectDef }) {
  const startPlacing = useStore((s) => s.startPlacing)
  const active = useStore((s) => s.placingDef?.id === def.id)
  return (
    <div
      className={`palette-card${active ? ' active' : ''}`}
      // Mouse: press starts a drag-to-place gesture. Touch: a plain tap (onClick)
      // starts sticky placing, so swipe-scrolling the list never picks up an item.
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return
        e.preventDefault()
        startPlacing(def)
      }}
      onClick={() => startPlacing(def)}
      title="Drag onto the floor, or tap then tap the scene to place (Esc cancels)"
    >
      <span className="swatch" style={{ background: def.color }} />
      <div className="pc-text">
        <div className="pc-label">{def.label}</div>
        <div className="pc-dims">
          {def.w} × {def.d} m · H {def.h} m
        </div>
      </div>
    </div>
  )
}

export function Palette() {
  const open = useStore((s) => s.panelLeft)
  const setPanelLeft = useStore((s) => s.setPanelLeft)
  return (
    <aside className={`palette${open ? ' open' : ''}`}>
      <button className="drawer-close" onClick={() => setPanelLeft(false)}>
        ✕ Close
      </button>
      <h2>Objects (tap to place)</h2>
      {CATEGORY_ORDER.map((cat) => {
        const defs = CATALOG.filter((d) => d.category === cat)
        if (defs.length === 0) return null
        return (
          <div key={cat} className="palette-group">
            <h3>{CATEGORY_LABELS[cat]}</h3>
            {defs.map((d) => (
              <PaletteCard key={d.id} def={d} />
            ))}
          </div>
        )
      })}
      <div className="palette-hint">
        <b>Shortcuts:</b> R rotate · Delete remove · Esc cancel/deselect · G grid · L labels
      </div>
    </aside>
  )
}
