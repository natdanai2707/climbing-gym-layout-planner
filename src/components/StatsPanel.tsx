import { useMemo } from 'react'
import { useStore } from '../store'
import { CATEGORY_LABELS } from '../catalog'
import type { Category } from '../types'

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

export function StatsPanel() {
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)

  const stats = useMemo(() => {
    const buildingArea = building.width * building.length
    const outerArea = (building.width + building.apron * 2) * (building.length + building.apron * 2)
    const apronArea = outerArea - buildingArea

    let usedArea = 0
    const byCategory = new Map<Category, { area: number; count: number }>()
    let parkingCount = 0
    let parkingArea = 0

    for (const o of objects) {
      const area = o.w * o.d
      if (o.category === 'parking') {
        parkingCount++
        parkingArea += area
      }
      if (o.rule === 'floor') usedArea += area
      const e = byCategory.get(o.category) ?? { area: 0, count: 0 }
      e.area += area
      e.count++
      byCategory.set(o.category, e)
    }

    return {
      buildingArea,
      apronArea,
      usedArea,
      usedPct: buildingArea > 0 ? (usedArea / buildingArea) * 100 : 0,
      freeArea: Math.max(0, buildingArea - usedArea),
      byCategory,
      parkingCount,
      parkingArea,
    }
  }, [building, objects])

  return (
    <section className="stats">
      <h2>สถิติพื้นที่</h2>
      <div className="stat-row">
        <span>พื้นที่อาคาร</span>
        <b>{fmt(stats.buildingArea)} m²</b>
      </div>
      <div className="stat-row">
        <span>พื้นที่ apron (นอกอาคาร)</span>
        <b>{fmt(stats.apronArea)} m²</b>
      </div>
      <div className="stat-row">
        <span>ใช้พื้นที่ในอาคาร</span>
        <b>
          {fmt(stats.usedArea)} m² ({stats.usedPct.toFixed(1)}%)
        </b>
      </div>
      <div className="stat-row">
        <span>พื้นที่ว่างคงเหลือ</span>
        <b>{fmt(stats.freeArea)} m²</b>
      </div>
      {stats.byCategory.size > 0 && (
        <>
          <h3>แยกตามประเภท</h3>
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
        <span>ที่จอดรถ</span>
        <b>
          {stats.parkingCount} คัน · {fmt(stats.parkingArea)} m²
        </b>
      </div>
    </section>
  )
}
