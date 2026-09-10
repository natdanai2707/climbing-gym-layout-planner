import { useStore } from '../store'
import { FIXED_SIZE_DEFS } from '../catalog'
import type { Placed } from '../types'
import { NumInput } from './NumInput'

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
      <NumInput value={value} step={step ?? 0.5} min={min} onCommit={onChange} />
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
        <h2>Selected Object</h2>
        <p className="muted">Tap an object in the scene to edit its size, position, color and name.</p>
      </section>
    )
  }

  const set = (patch: Partial<Placed>) => updateObject(selected.id, patch)
  const fixedSize = FIXED_SIZE_DEFS.has(selected.defId)

  return (
    <section className="inspector">
      <h2>Selected Object</h2>
      <label className="insp-field wide">
        <span>Name</span>
        <input type="text" value={selected.label} onChange={(e) => set({ label: e.target.value })} />
      </label>
      <div className="insp-grid">
        {/* a fixed module is a known size — show it, but don't offer to change it */}
        {fixedSize ? (
          <label className="insp-field wide">
            <span>Size (fixed)</span>
            <span className="muted">
              {selected.w} × {selected.d} m
            </span>
          </label>
        ) : (
          <>
            <Field label="Width W (m)" value={selected.w} min={0.1} onChange={(v) => set({ w: v })} />
            <Field label="Depth D (m)" value={selected.d} min={0.1} onChange={(v) => set({ d: v })} />
            <Field label="Height H (m)" value={selected.h} min={0.05} onChange={(v) => set({ h: v })} />
          </>
        )}
        <label className="insp-field">
          <span>Rotation</span>
          <div className="rot-row">
            <span className="rot-val">{selected.rot * 45}°</span>
            <button onClick={rotate} disabled={selected.rule === 'edge'} title="R">
              ↻ 45°
            </button>
          </div>
        </label>
        <Field label="Position X (m)" value={selected.x} onChange={(v) => set({ x: v })} />
        <Field label="Position Z (m)" value={selected.z} onChange={(v) => set({ z: v })} />
      </div>
      <label className="insp-field wide">
        <span>Color</span>
        <input type="color" value={selected.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      {(selected.category === 'partition' || selected.defId === 'bulkhead') && (
        <label className="insp-field wide">
          <span>Finish</span>
          <select
            value={selected.material === 'glass' ? 'glass' : ''}
            onChange={(e) => set({ material: (e.target.value || undefined) as Placed['material'] })}
          >
            <option value="">Solid panel</option>
            <option value="glass">Clear glass</option>
          </select>
        </label>
      )}
      {selected.defId === 'signage' && (
        <>
          <label className="insp-field wide">
            <span>Sign text</span>
            <input
              type="text"
              value={selected.text ?? ''}
              maxLength={40}
              placeholder="CLIMBING GYM"
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
          <Field
            label="Letter thickness (m)"
            value={selected.thick ?? 0.08}
            step={0.01}
            min={0.01}
            onChange={(v) => set({ thick: v })}
          />
          <Field
            label="Height above floor (m)"
            value={selected.sill ?? 3.5}
            step={0.1}
            min={0}
            onChange={(v) => set({ sill: v })}
          />
        </>
      )}
      {selected.defId === 'shed' && (
        <Field
          label="Eave height (m)"
          value={selected.eave ?? 6}
          step={0.1}
          min={0.3}
          onChange={(v) => set({ eave: v })}
        />
      )}
      {selected.category === 'window' && (
        <Field
          label="Sill height (m)"
          value={selected.sill ?? 0.9}
          step={0.1}
          min={0}
          onChange={(v) => set({ sill: v })}
        />
      )}
      {selected.defId === 'bulkhead' && (
        <Field
          label="Panel drop below hangers (m)"
          value={selected.drop ?? 1.5}
          min={0.3}
          onChange={(v) => set({ drop: v })}
        />
      )}
      {(selected.category === 'zone' || selected.category === 'mat') && (
        <label className="insp-field wide">
          <span>Surface material</span>
          <select
            value={selected.material ?? ''}
            onChange={(e) => set({ material: (e.target.value || undefined) as Placed['material'] })}
          >
            <option value="">Plain color</option>
            <option value="epdm">EPDM rubber (tinted by color)</option>
            <option value="concrete">Concrete</option>
            <option value="birch">Birch plywood</option>
          </select>
        </label>
      )}
      {selected.category !== 'mezzanine' && selected.rule === 'floor' && (
        <label className="insp-field wide">
          <span>Level</span>
          <select
            value={selected.level ?? 'ground'}
            onChange={(e) => set({ level: e.target.value as 'ground' | 'upper' })}
          >
            <option value="ground">Ground floor</option>
            <option value="upper">On mezzanine</option>
          </select>
        </label>
      )}
      <div className="insp-meta muted">
        Type: {selected.category} · Rule: {selected.rule}
      </div>
      <button className="danger wide" onClick={removeSelected}>
        Delete Object
      </button>
    </section>
  )
}
