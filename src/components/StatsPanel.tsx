import { useMemo } from 'react'
import { useStore } from '../store'
import { CATEGORY_LABELS } from '../catalog'
import { usedStrip } from '../placement'
import type { Category } from '../types'

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

export function StatsPanel() {
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)

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
    </section>
  )
}
