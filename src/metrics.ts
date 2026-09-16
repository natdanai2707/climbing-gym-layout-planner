import type { Building, Category, Placed, ShellDesign } from './types'
import { roofHeightAt } from './components/SegmentedShell'

/**
 * Floor and air-volume metrics, measured by sampling the hall on a grid.
 *
 * Both numbers used to be estimated from bounding boxes, and both were wrong in
 * the same way: they added up rectangles that overlap. The "ground covered"
 * figure took the z-extent of every item and multiplied it by the full hall
 * width, so one item at each end read as 100% covered; the category sums added
 * every footprint whether or not it stood on the floor, which in the shipped
 * layout totalled 5,149 m² inside a 1,169 m² building.
 *
 * Sampling settles all of it. Each cell is counted once, so overlaps cannot
 * double-count, and each cell can ask its own questions: is anything standing
 * here, and how high is the air above it — up to a ceiling panel, or all the
 * way to the roof.
 */

const CELL = 0.5 // sampling grid (m); 0.25 m² per cell

/** Categories whose footprint is not floor space: they hang overhead, sit in a
 *  wall, or stand outside the hall. */
const NOT_ON_FLOOR = new Set<Category>(['ceiling', 'tech', 'hvac', 'door', 'window', 'person', 'site', 'parking'])

/** A mezzanine adds floor above; the ground beneath it is still usable. */
const occupiesFloor = (o: Placed) =>
  o.rule === 'floor' && o.level !== 'upper' && o.category !== 'mezzanine' && !NOT_ON_FLOOR.has(o.category)

/** Is (x, z) inside this item's own rotated rectangle? */
function covers(o: Placed, x: number, z: number): boolean {
  const th = (o.rot * Math.PI) / 4
  const c = Math.cos(th)
  const s = Math.sin(th)
  const dx = x - o.x
  const dz = z - o.z
  return Math.abs(dx * c - dz * s) <= o.w / 2 && Math.abs(dx * s + dz * c) <= o.d / 2
}

export interface HallMetrics {
  floorArea: number // the hall footprint
  occupiedArea: number // floor actually standing under something, counted once
  freeArea: number
  ceilingArea: number // floor with a ceiling panel over it
  volume: number // air: up to the lowest ceiling over each spot, else to the roof
  meanHeight: number // volume / floorArea — the average height of that air
}

export function hallMetrics(
  objects: Placed[],
  building: Building,
  eave: number,
  design: ShellDesign | null,
): HallMetrics {
  const floorArea = building.width * building.length
  const hw = building.width / 2
  const z0 = building.centerZ - building.length / 2
  const z1 = building.centerZ + building.length / 2

  // A ceiling panel's h is its mount height, so it caps the air below it. A
  // bulkhead hangs vertically and encloses nothing on its own.
  const caps = objects.filter((o) => o.category === 'ceiling' && o.defId === 'ceiling')
  const floorItems = objects.filter(occupiesFloor)

  let cells = 0
  let occupied = 0
  let capped = 0
  let heightSum = 0

  for (let x = -hw + CELL / 2; x < hw; x += CELL) {
    for (let z = z0 + CELL / 2; z < z1; z += CELL) {
      cells++
      let top = Infinity
      for (const c of caps) if (covers(c, x, z)) top = Math.min(top, c.h)
      if (top === Infinity) top = roofHeightAt(x, z, building, eave, design)
      else capped++
      heightSum += top
      if (floorItems.some((o) => covers(o, x, z))) occupied++
    }
  }

  if (cells === 0) return { floorArea, occupiedArea: 0, freeArea: floorArea, ceilingArea: 0, volume: 0, meanHeight: 0 }

  // The grid rarely divides the hall exactly, so scale the samples back onto
  // the real footprint instead of reporting the sampled one.
  const per = floorArea / cells
  const occupiedArea = occupied * per
  return {
    floorArea,
    occupiedArea,
    freeArea: Math.max(0, floorArea - occupiedArea),
    ceilingArea: capped * per,
    volume: heightSum * per,
    meanHeight: heightSum / cells,
  }
}

/** An item standing on a mezzanine — on a floor, just not the ground one. */
const onMezzanine = (o: Placed) =>
  o.rule === 'floor' && o.level === 'upper' && o.category !== 'mezzanine' && !NOT_ON_FLOOR.has(o.category)

type CatSums = Map<Category, { area: number; count: number }>

function sums(objects: Placed[], keep: (o: Placed) => boolean): CatSums {
  const m: CatSums = new Map()
  for (const o of objects) {
    if (!keep(o)) continue
    const e = m.get(o.category) ?? { area: 0, count: 0 }
    e.area += o.w * o.d
    e.count++
    m.set(o.category, e)
  }
  return m
}

/**
 * Footprint sums per category, for the items that stand on the ground floor.
 * Mezzanines are left out on purpose — they consume no ground and the panel
 * reports them on their own row as extra floor.
 */
export const floorByCategory = (objects: Placed[]): CatSums => sums(objects, occupiesFloor)

/** The same, for what is standing on a mezzanine. */
export const upperByCategory = (objects: Placed[]): CatSums => sums(objects, onMezzanine)

/** Everything else, by count only — their w × d is not floor area. */
export function otherByCategory(objects: Placed[]): Map<Category, number> {
  const m = new Map<Category, number>()
  for (const o of objects) {
    if (occupiesFloor(o) || onMezzanine(o) || o.category === 'mezzanine') continue
    m.set(o.category, (m.get(o.category) ?? 0) + 1)
  }
  return m
}
