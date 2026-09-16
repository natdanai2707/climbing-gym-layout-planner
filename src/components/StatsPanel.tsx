import { useMemo } from 'react'
import { useStore } from '../store'
import { CATEGORY_LABELS } from '../catalog'
import { usedStrip } from '../placement'
import { ROOF_PITCH } from './WarehouseShell'
import { designMaxHeight } from './SegmentedShell'
import { floorByCategory, hallMetrics, otherByCategory, upperByCategory } from '../metrics'
import { NumInput } from './NumInput'

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })
const fmt0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

export function StatsPanel() {
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)
  const eave = useStore((s) => s.shell.eave)
  const setEave = useStore((s) => s.setShellEaveUndoable)
  const coolFactor = useStore((s) => s.coolFactor)
  const design = useStore((s) => s.shellDesign)
  const setCoolFactor = useStore((s) => s.setCoolFactor)
  const setPage = useStore((s) => s.setPage)

  const stats = useMemo(() => {
    const outerArea = (building.width + building.apron * 2) * (building.length + building.apron * 2)

    // Measured on a grid, so overlapping items and overlapping ceilings are
    // each counted once — see metrics.ts.
    const m = hallMetrics(objects, building, eave, design)

    let mezzanineArea = 0
    let parkingBays = 0
    let parkingArea = 0
    let cars = 0
    for (const o of objects) {
      if (o.category === 'mezzanine') mezzanineArea += o.w * o.d
      if (o.category === 'parking') {
        parkingBays++
        parkingArea += o.w * o.d
      }
      // vehicles are site props, not parking bays, but they are what you count
      // when you look at the drawing
      if (o.defId === 'car' || o.defId === 'moto') cars++
    }

    return {
      ...m,
      apronArea: outerArea - m.floorArea,
      usedLength: usedStrip(objects, building).length,
      usedPct: m.floorArea > 0 ? (m.occupiedArea / m.floorArea) * 100 : 0,
      ceilingPct: m.floorArea > 0 ? (m.ceilingArea / m.floorArea) * 100 : 0,
      mezzanineArea,
      byCategory: floorByCategory(objects),
      upper: upperByCategory(objects),
      others: otherByCategory(objects),
      parkingBays,
      parkingArea,
      cars,
    }
  }, [building, objects, eave, design])

  return (
    <section className="stats">
      <h2>Area Stats</h2>
      <div className="stat-row">
        <span>Building area</span>
        <b>{fmt(stats.floorArea)} m²</b>
      </div>
      <div className="stat-row">
        <span>Apron (outdoor) area</span>
        <b>{fmt(stats.apronArea)} m²</b>
      </div>
      <div className="stat-row small">
        <span>Length the layout spans</span>
        <b>
          {fmt(stats.usedLength)} m of {fmt(building.length)} m
        </b>
      </div>
      <div className="stat-row">
        <span>Floor area used</span>
        <b>
          {fmt(stats.occupiedArea)} m² ({stats.usedPct.toFixed(1)}%)
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
      <div className="stat-row">
        <span>Parking</span>
        <b>
          {stats.parkingBays} bays · {fmt(stats.parkingArea)} m²
        </b>
      </div>
      {stats.cars > 0 && (
        <div className="stat-row small">
          <span>Vehicles drawn</span>
          <b>{stats.cars}</b>
        </div>
      )}
      {stats.byCategory.size > 0 && (
        <>
          <h3>Floor items by category</h3>
          {[...stats.byCategory.entries()].map(([cat, e]) => (
            <div className="stat-row small" key={cat}>
              <span>
                {CATEGORY_LABELS[cat]} × {e.count}
              </span>
              <b>{fmt(e.area)} m²</b>
            </div>
          ))}
          <p className="muted stat-note">
            Footprint sums, so overlapping items are counted twice here — "Floor area used" above is the one that
            counts each square metre once.
          </p>
        </>
      )}
      {stats.upper.size > 0 && (
        <>
          <h3>On the mezzanine</h3>
          {[...stats.upper.entries()].map(([cat, e]) => (
            <div className="stat-row small" key={cat}>
              <span>
                {CATEGORY_LABELS[cat]} × {e.count}
              </span>
              <b>{fmt(e.area)} m²</b>
            </div>
          ))}
        </>
      )}
      {stats.others.size > 0 && (
        <>
          <h3>Overhead, glazing &amp; outdoors</h3>
          {[...stats.others.entries()].map(([cat, n]) => (
            <div className="stat-row small" key={cat}>
              <span>{CATEGORY_LABELS[cat]}</span>
              <b>{n}</b>
            </div>
          ))}
        </>
      )}

      {/* Air volume comes from the grid: under a ceiling panel the air stops at
          the panel, elsewhere it goes up to the roof. Taking the whole shell
          instead ignored every ceiling in the layout. */}
      {(() => {
        const rise = (building.width / 2) * ROOF_PITCH
        const ridge = design ? designMaxHeight(design) : eave + rise
        const btu = stats.volume * coolFactor
        return (
          <>
            <h3>Air conditioning</h3>
            <div className="stat-row">
              <span>Ceiling height (eave)</span>
              {design ? (
                <button className="tb-linkish" onClick={() => setPage('building')} title="Set by the zones on the Building Design page">
                  per zone →
                </button>
              ) : (
                <span className="stat-input">
                  <NumInput value={eave} min={3} max={20} step={0.5} onCommit={setEave} />
                  m
                </span>
              )}
            </div>
            <div className="stat-row small">
              <span>Ridge height (roof peak)</span>
              <b>{fmt(ridge)} m</b>
            </div>
            {stats.ceilingArea > 0 && (
              <div className="stat-row small">
                <span>Under a ceiling</span>
                <b>
                  {fmt(stats.ceilingArea)} m² ({stats.ceilingPct.toFixed(0)}%)
                </b>
              </div>
            )}
            <div className="stat-row small">
              <span>Average height of the air</span>
              <b>{fmt(stats.meanHeight)} m</b>
            </div>
            <div className="stat-row">
              <span>Hall air volume</span>
              <b>{fmt0(stats.volume)} m³</b>
            </div>
            <div className="stat-row small">
              <span>Cooling factor (BTU/m³)</span>
              <span className="stat-input">
                <NumInput value={coolFactor} min={50} max={1000} step={10} onCommit={setCoolFactor} />
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
              Rough sizing only: volume × factor. Ceiling panels cap the air below them, so dropping a ceiling over a
              room cuts its load. ~200–250 BTU/m³ suits an insulated hall; raise it for hot climates, big glass areas
              or crowded sessions. Get a full heat-load calc before buying equipment.
            </p>
          </>
        )
      })()}
    </section>
  )
}
