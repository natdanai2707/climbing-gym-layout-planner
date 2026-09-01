import { useMemo } from 'react'
import { useStore } from '../store'
import { CATEGORY_LABELS } from '../catalog'
import { usedStrip } from '../placement'
import { ROOF_PITCH } from './WarehouseShell'
import type { Category } from '../types'

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })
const fmt0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

export function StatsPanel() {
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)
  const eave = useStore((s) => s.shell.eave)
  const setEave = useStore((s) => s.setShellEaveUndoable)
  const coolFactor = useStore((s) => s.coolFactor)
  const setCoolFactor = useStore((s) => s.setCoolFactor)

  const stats = useMemo(() => {
    const buildingArea = building.width * building.length
    const outerArea = (building.width + building.apron * 2) * (building.length + building.apron * 2)
    const apronArea = outerArea - buildingArea

    let mezzanineArea = 0
    const byCategory = new Map<Category, { area: number; count: number }>()
    let parkingCount = 0
    let parkingArea = 0

    for (const o of objects) {
      const area = o.w * o.d
      if (o.category === 'parking') {
        parkingCount++
        parkingArea += area
      }
      // mezzanines add extra floor above rather than consuming ground area
      if (o.category === 'mezzanine') mezzanineArea += area
      const e = byCategory.get(o.category) ?? { area: 0, count: 0 }
      e.area += area
      e.count++
      byCategory.set(o.category, e)
    }

    // ground use = full building width × the length the layout occupies
    const strip = usedStrip(objects, building)
    const usedArea = strip.area

    return {
      buildingArea,
      apronArea,
      usedArea,
      usedLength: strip.length,
      mezzanineArea,
      usedPct: buildingArea > 0 ? (usedArea / buildingArea) * 100 : 0,
      freeArea: Math.max(0, buildingArea - usedArea),
      byCategory,
      parkingCount,
      parkingArea,
    }
  }, [building, objects])

  return (
    <section className="stats">
      <h2>Area Stats</h2>
      <div className="stat-row">
        <span>Building area</span>
        <b>{fmt(stats.buildingArea)} m²</b>
      </div>
      <div className="stat-row">
        <span>Apron (outdoor) area</span>
        <b>{fmt(stats.apronArea)} m²</b>
      </div>
      <div className="stat-row">
        <span>Used length</span>
        <b>
          {fmt(stats.usedLength)} m of {fmt(building.length)} m
        </b>
      </div>
      <div className="stat-row">
        <span>Ground covered ({fmt(building.width)} m × {fmt(stats.usedLength)} m)</span>
        <b>
          {fmt(stats.usedArea)} m² ({stats.usedPct.toFixed(1)}%)
        </b>
      </div>
      <div className="stat-row">
        <span>Free floor area</span>
        <b>{fmt(stats.freeArea)} m²</b>
      </div>
      {stats.mezzanineArea > 0 && (
        <div className="stat-row">
          <span>Mezzanine (extra floor)</span>
          <b>{fmt(stats.mezzanineArea)} m²</b>
        </div>
      )}
      {stats.byCategory.size > 0 && (
        <>
          <h3>By category (footprint sums)</h3>
          {[...stats.byCategory.entries()].map(([cat, e]) => (
            <div className="stat-row small" key={cat}>
              <span>
                {CATEGORY_LABELS[cat]} × {e.count}
              </span>
              <b>{fmt(e.area)} m²</b>
            </div>
          ))}
        </>
      )}
      <div className="stat-row">
        <span>Parking</span>
        <b>
          {stats.parkingCount} cars · {fmt(stats.parkingArea)} m²
        </b>
      </div>

      {/* the hall is a gable prism: cross-section = W·eave + W·rise/2 */}
      {(() => {
        const rise = (building.width / 2) * ROOF_PITCH
        const ridge = eave + rise
        const volume = building.length * (building.width * eave + (building.width * rise) / 2)
        const btu = volume * coolFactor
        return (
          <>
            <h3>Air conditioning</h3>
            <div className="stat-row">
              <span>Ceiling height (eave)</span>
              <span className="stat-input">
                <input
                  type="number"
                  value={eave}
                  min={3}
                  max={20}
                  step={0.5}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setEave(v)
                  }}
                />
                m
              </span>
            </div>
            <div className="stat-row small">
              <span>Ridge height (roof peak)</span>
              <b>{fmt(ridge)} m</b>
            </div>
            <div className="stat-row">
              <span>Hall air volume</span>
              <b>{fmt0(volume)} m³</b>
            </div>
            <div className="stat-row small">
              <span>Cooling factor (BTU/m³)</span>
              <span className="stat-input">
                <input
                  type="number"
                  value={coolFactor}
                  min={50}
                  max={1000}
                  step={10}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setCoolFactor(v)
                  }}
                />
              </span>
            </div>
            <div className="stat-row">
              <span>Estimated cooling load</span>
              <b>{fmt0(btu)} BTU/hr</b>
            </div>
            <div className="stat-row small">
              <span>≈ capacity needed</span>
              <b>
                {fmt(btu / 12000)} tons · {fmt(btu / 3412)} kW
              </b>
            </div>
            <p className="muted stat-note">
              Rough sizing only: volume × factor. ~200–250 BTU/m³ suits an insulated hall; raise it for hot climates,
              big glass areas or crowded sessions. Get a full heat-load calc before buying equipment.
            </p>
          </>
        )
      })()}
    </section>
  )
}
