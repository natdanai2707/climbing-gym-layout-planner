import { useStore } from '../store'
import type { Placed } from '../types'

function Field({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="insp-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        step={step ?? 0.5}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </label>
  )
}

export function Inspector() {
  const selected = useStore((s) => s.objects.find((o) => o.id === s.selectedId) ?? null)
  const updateObject = useStore((s) => s.updateObject)
  const rotate = useStore((s) => s.rotate)
  const removeSelected = useStore((s) => s.removeSelected)

  if (!selected) {
    return (
      <section className="inspector">
        <h2>วัตถุที่เลือก</h2>
        <p className="muted">คลิกวัตถุในฉากเพื่อแก้ไขขนาด ตำแหน่ง สี และชื่อ</p>
      </section>
    )
  }

  const set = (patch: Partial<Placed>) => updateObject(selected.id, patch)

  return (
    <section className="inspector">
      <h2>วัตถุที่เลือก</h2>
      <label className="insp-field wide">
        <span>ชื่อ</span>
        <input type="text" value={selected.label} onChange={(e) => set({ label: e.target.value })} />
      </label>
      <div className="insp-grid">
        <Field label="กว้าง W (m)" value={selected.w} min={0.1} onChange={(v) => set({ w: v })} />
        <Field label="ลึก D (m)" value={selected.d} min={0.1} onChange={(v) => set({ d: v })} />
        <Field label="สูง H (m)" value={selected.h} min={0.05} onChange={(v) => set({ h: v })} />
        <label className="insp-field">
          <span>หมุน</span>
          <div className="rot-row">
            <span className="rot-val">{selected.rot * 90}°</span>
            <button onClick={rotate} disabled={selected.rule === 'edge'} title="R">
              ↻ 90°
            </button>
          </div>
        </label>
        <Field label="ตำแหน่ง X (m)" value={selected.x} onChange={(v) => set({ x: v })} />
        <Field label="ตำแหน่ง Z (m)" value={selected.z} onChange={(v) => set({ z: v })} />
      </div>
      <label className="insp-field wide">
        <span>สี</span>
        <input type="color" value={selected.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      <div className="insp-meta muted">
        ประเภท: {selected.category} · กติกา: {selected.rule}
      </div>
      <button className="danger wide" onClick={removeSelected}>
        ลบวัตถุนี้ (Delete)
      </button>
    </section>
  )
}
