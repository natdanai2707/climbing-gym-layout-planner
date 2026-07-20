import type { Building, Placed } from './types'

const EPS = 1e-4

// Effective axis-aligned footprint after rotation (rot is in 45° steps, 0..7)
export function fp(o: { w: number; d: number; rot: number }): { fw: number; fd: number } {
  const th = (o.rot * Math.PI) / 4
  const c = Math.abs(Math.cos(th))
  const s = Math.abs(Math.sin(th))
  return { fw: o.w * c + o.d * s, fd: o.w * s + o.d * c }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

// Snap the footprint's min-corner to the grid (grid origin = minEdge), return new center
function snapCenter(center: number, size: number, minEdge: number, cell: number) {
  const corner = center - size / 2 - minEdge
  return minEdge + Math.round(corner / cell) * cell + size / 2
}

// Clamp the footprint fully inside [min, max] (centered if it doesn't fit)
function clampInside(center: number, size: number, min: number, max: number) {
  if (size >= max - min) return (min + max) / 2
  const corner = clamp(center - size / 2, min, max - size)
  return corner + size / 2
}

export interface DropResult {
  x: number
  z: number
  rot: number
  valid: boolean
}

/**
 * Given a desired (raw) world position, compute where the object actually lands
 * according to its placement rule:
 *  - floor:   snapped to grid, clamped fully inside the building rectangle
 *  - edge:    snapped onto the nearest perimeter wall, rotation forced to match the wall
 *  - outdoor: snapped to grid in the apron; invalid if it leaves the apron or enters the building
 */
export function computeDrop(
  o: { w: number; d: number; rot: number; rule: Placed['rule'] },
  rawX: number,
  rawZ: number,
  b: Building,
): DropResult {
  const { width: W, length: L, cell, apron } = b
  const hw = W / 2
  const hl = L / 2

  if (o.rule === 'edge') {
    // Distance to each perimeter wall; attach to the nearest one
    const dN = Math.abs(rawZ + hl)
    const dS = Math.abs(rawZ - hl)
    const dW = Math.abs(rawX + hw)
    const dE = Math.abs(rawX - hw)
    const m = Math.min(dN, dS, dW, dE)
    if (m === dN || m === dS) {
      const z = m === dN ? -hl : hl
      let x = snapCenter(rawX, o.w, -hw, cell)
      x = clampInside(x, o.w, -hw, hw)
      return { x, z, rot: m === dN ? 0 : 4, valid: true }
    } else {
      const x = m === dW ? -hw : hw
      let z = snapCenter(rawZ, o.w, -hl, cell)
      z = clampInside(z, o.w, -hl, hl)
      return { x, z, rot: m === dW ? 2 : 6, valid: true }
    }
  }

  const { fw, fd } = fp(o)

  if (o.rule === 'outdoor') {
    const ow = hw + apron
    const ol = hl + apron
    let x = snapCenter(rawX, fw, -ow, cell)
    let z = snapCenter(rawZ, fd, -ol, cell)
    x = clampInside(x, fw, -ow, ow)
    z = clampInside(z, fd, -ol, ol)
    const inside =
      x - fw / 2 >= -ow - EPS && x + fw / 2 <= ow + EPS && z - fd / 2 >= -ol - EPS && z + fd / 2 <= ol + EPS
    // Overlap with the building interior makes the drop invalid
    const ox = Math.min(x + fw / 2, hw) - Math.max(x - fw / 2, -hw)
    const oz = Math.min(z + fd / 2, hl) - Math.max(z - fd / 2, -hl)
    const hitsBuilding = ox > EPS && oz > EPS
    return { x, z, rot: o.rot, valid: inside && !hitsBuilding }
  }

  // floor
  let x = snapCenter(rawX, fw, -hw, cell)
  let z = snapCenter(rawZ, fd, -hl, cell)
  x = clampInside(x, fw, -hw, hw)
  z = clampInside(z, fd, -hl, hl)
  return { x, z, rot: o.rot, valid: true }
}

// After a building resize, try to keep an outdoor object in the apron by pushing it
// out of the building along the shortest axis.
export function resolveAfterResize(o: Placed, b: Building): { x: number; z: number; rot: number } {
  const r = computeDrop(o, o.x, o.z, b)
  if (r.valid || o.rule !== 'outdoor') return { x: r.x, z: r.z, rot: r.rot }
  const { fw, fd } = fp(o)
  const hw = b.width / 2
  const hl = b.length / 2
  const candidates: Array<[number, number]> = [
    [o.x, -hl - fd / 2], // north
    [o.x, hl + fd / 2], // south
    [-hw - fw / 2, o.z], // west
    [hw + fw / 2, o.z], // east
  ]
  let best: DropResult | null = null
  let bestDist = Infinity
  for (const [cx, cz] of candidates) {
    const c = computeDrop(o, cx, cz, b)
    if (!c.valid) continue
    const dist = (c.x - o.x) ** 2 + (c.z - o.z) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  return best ? { x: best.x, z: best.z, rot: best.rot } : { x: r.x, z: r.z, rot: r.rot }
}

// Objects tinted red: only outdoor objects violating the apron rule.
// (Overlapping items are allowed by design — layouts layer zones, mats and gear.)
export function getWarningIds(objects: Placed[], b: Building): Set<string> {
  const warn = new Set<string>()
  for (const o of objects) {
    if (o.rule === 'outdoor' && !computeDrop(o, o.x, o.z, b).valid) warn.add(o.id)
  }
  return warn
}

// Height an object sits at: objects marked 'upper' rest on the first mezzanine
// whose footprint contains their center.
export function elevationFor(o: Pick<Placed, 'x' | 'z' | 'level'>, objects: Placed[]): number {
  if (o.level !== 'upper') return 0
  for (const m of objects) {
    if (m.category !== 'mezzanine') continue
    const { fw, fd } = fp(m)
    if (Math.abs(o.x - m.x) <= fw / 2 + EPS && Math.abs(o.z - m.z) <= fd / 2 + EPS) return m.h
  }
  return 0
}
