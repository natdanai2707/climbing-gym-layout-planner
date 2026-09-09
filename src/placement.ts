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
export function clampInside(center: number, size: number, min: number, max: number) {
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
 *  - outdoor: snapped to grid anywhere on the site (the apron ground grows to
 *             reach it); only overlapping the building itself is invalid
 */
export function computeDrop(
  o: { w: number; d: number; rot: number; rule: Placed['rule'] },
  rawX: number,
  rawZ: number,
  b: Building,
  snap = true, // grid-snap is for dragging; typed coordinates keep their exact value
): DropResult {
  const { width: W, length: L, cell, apron } = b
  const hw = W / 2
  const cz = b.centerZ ?? 0
  const minZ = cz - L / 2
  const maxZ = cz + L / 2

  if (o.rule === 'edge') {
    // Distance to each perimeter wall; attach to the nearest one
    const dN = Math.abs(rawZ - minZ)
    const dS = Math.abs(rawZ - maxZ)
    const dW = Math.abs(rawX + hw)
    const dE = Math.abs(rawX - hw)
    const m = Math.min(dN, dS, dW, dE)
    if (m === dN || m === dS) {
      const z = m === dN ? minZ : maxZ
      let x = snap ? snapCenter(rawX, o.w, -hw, cell) : rawX
      x = clampInside(x, o.w, -hw, hw)
      return { x, z, rot: m === dN ? 0 : 4, valid: true }
    } else {
      const x = m === dW ? -hw : hw
      let z = snap ? snapCenter(rawZ, o.w, minZ, cell) : rawZ
      z = clampInside(z, o.w, minZ, maxZ)
      return { x, z, rot: m === dW ? 2 : 6, valid: true }
    }
  }

  const { fw, fd } = fp(o)

  if (o.rule === 'outdoor') {
    const ow = hw + apron
    const oMinZ = minZ - apron
    const x = snap ? snapCenter(rawX, fw, -ow, cell) : rawX
    const z = snap ? snapCenter(rawZ, fd, oMinZ, cell) : rawZ
    // Overlap with the building interior makes the drop invalid; beyond that
    // an outdoor item may sit anywhere — the apron stretches out to meet it.
    const ox = Math.min(x + fw / 2, hw) - Math.max(x - fw / 2, -hw)
    const oz = Math.min(z + fd / 2, maxZ) - Math.max(z - fd / 2, minZ)
    const hitsBuilding = ox > EPS && oz > EPS
    return { x, z, rot: o.rot, valid: !hitsBuilding }
  }

  // floor
  let x = snap ? snapCenter(rawX, fw, -hw, cell) : rawX
  let z = snap ? snapCenter(rawZ, fd, minZ, cell) : rawZ
  x = clampInside(x, fw, -hw, hw)
  z = clampInside(z, fd, minZ, maxZ)
  return { x, z, rot: o.rot, valid: true }
}

// After a building resize, try to keep an outdoor object in the apron by pushing it
// out of the building along the shortest axis.
export function resolveAfterResize(o: Placed, b: Building): { x: number; z: number; rot: number } {
  const r = computeDrop(o, o.x, o.z, b, false)
  if (r.valid || o.rule !== 'outdoor') return { x: r.x, z: r.z, rot: r.rot }
  const { fw, fd } = fp(o)
  const hw = b.width / 2
  const cz = b.centerZ ?? 0
  const candidates: Array<[number, number]> = [
    [o.x, cz - b.length / 2 - fd / 2], // north
    [o.x, cz + b.length / 2 + fd / 2], // south
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
    if (o.rule === 'outdoor' && !computeDrop(o, o.x, o.z, b, false).valid) warn.add(o.id)
  }
  return warn
}

/**
 * Ground use measured the way a warehouse build-out is planned: the building is
 * always used across its FULL width, so what matters is how much of its LENGTH
 * the layout occupies. Returns the occupied length (z-extent of all indoor
 * items, mezzanines included) and area = building width × that length.
 */
export function usedStrip(objects: Placed[], b: Building): { length: number; area: number } {
  const cz = b.centerZ ?? 0
  const bMin = cz - b.length / 2
  const bMax = cz + b.length / 2
  let minZ = Infinity
  let maxZ = -Infinity
  for (const o of objects) {
    if (o.rule !== 'floor') continue
    const { fd } = fp(o)
    minZ = Math.min(minZ, Math.max(bMin, o.z - fd / 2))
    maxZ = Math.max(maxZ, Math.min(bMax, o.z + fd / 2))
  }
  if (minZ >= maxZ) return { length: 0, area: 0 }
  const length = maxZ - minZ
  return { length, area: b.width * length }
}

export interface Opening {
  c: number // center along the wall (wall-local x)
  w: number
  h: number
}

// Doors (room / glass doors) placed on a wall cut an opening automatically.
// The wall is described in the HOST's local frame: center (cx,cz), running
// along local 'x' or 'z', length len, thickness t. Shared by the renderers
// (walls open up around doors) and the walk-mode collision (walk through them).
export function wallOpenings(
  doors: Placed[],
  host: Placed,
  wall: { cx: number; cz: number; along: 'x' | 'z'; len: number; t: number },
): Opening[] {
  const a = (host.rot * Math.PI) / 4
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const res: Opening[] = []
  for (const d of doors) {
    if ((d.level ?? 'ground') !== (host.level ?? 'ground')) continue
    // door must run parallel to the wall (45° doors don't cut)
    const rel = (((d.rot - host.rot) % 8) + 8) % 8
    if (wall.along === 'x' ? rel % 4 !== 0 : rel % 4 !== 2) continue
    // door center in host-local coordinates (inverse of rotation-y = a)
    const wx = d.x - host.x
    const wz = d.z - host.z
    const lx = wx * cos - wz * sin
    const lz = wx * sin + wz * cos
    const u = wall.along === 'x' ? lx - wall.cx : lz - wall.cz
    const v = wall.along === 'x' ? lz - wall.cz : lx - wall.cx
    if (Math.abs(v) > wall.t / 2 + d.d / 2 + 0.15) continue // not on this wall
    if (Math.abs(u) > wall.len / 2 + d.w / 2 - 0.08) continue
    res.push({ c: u, w: d.w + 0.02, h: Math.min(d.h, host.h - 0.02) })
  }
  return res
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

/**
 * The hall floor sits on a 1 m plinth above the surrounding site, the way a
 * warehouse floor sits at truck-bed height. Interior coordinates keep y = 0
 * as the finished floor, so everything indoors is unchanged; the site around
 * it simply lies at GROUND_Y. Steps and ramps placed at the doors bridge it.
 */
export const GROUND_Y = -1
