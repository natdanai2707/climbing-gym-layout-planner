import { CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '../catalog'
import type { ObjectDef } from '../types'
import { useStore } from '../store'

function PaletteCard({ def }: { def: ObjectDef }) {
  const startPlacing = useStore((s) => s.startPlacing)
  const active = useStore((s) => s.placingDef?.id === def.id)
  return (
    <div
      className={`palette-card${active ? ' active' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        startPlacing(def)
      }}
      title="ลากไปวางบนผัง หรือคลิกแล้วไปคลิกวางในฉาก (Esc ยกเลิก)"
    >
      <span className="swatch" style={{ background: def.color }} />
      <div className="pc-text">
        <div className="pc-label">{def.label}</div>
        <div className="pc-dims">
          {def.w} × {def.d} m · สูง {def.h} m
        </div>
      </div>
    </div>
  )
}

export function Palette() {
  return (
    <aside className="palette">
      <h2>วัตถุ (ลากไปวาง)</h2>
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
        <b>คีย์ลัด:</b> R หมุน · Delete ลบ · Esc ยกเลิก/เลิกเลือก · G ตาราง · L ป้ายชื่อ
      </div>
    </aside>
  )
}
