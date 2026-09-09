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
  y0: number // bottom of the hole above the host's floor (0 for a door)
  y1: number // top of the hole
  glass?: boolean // a glazed opening, not a walk-through doorway
}

// Doors and glass openings placed on a wall cut a hole automatically. A door
// is a hole down to the floor; a window is a band starting at its sill, so
// the wall keeps a spandrel below it and a head above.
// The wall is described in the HOST's local frame: center (cx,cz), running
// along local 'x' or 'z', length len, thickness t. Shared by the renderers
// (walls open up around them) and the walk-mode collision (doorways let you
// through, glazing does not).
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
    const glass = d.category === 'window'
    const y0 = glass ? clamp(d.sill ?? 0.9, 0, Math.max(0, host.h - 0.2)) : 0
    res.push({ c: u, w: d.w + 0.02, y0, y1: Math.min(y0 + d.h, host.h - 0.02), glass })
  }
  return res
}

/**
 * Entrance steps and ramps end on a level landing at the door, not on the last
 * tread. This is how much of their depth that landing takes — kept in one
 * place so the renderers and the walk-mode support test agree.
 */
export function landingDepth(d: number): number {
  return clamp(Math.min(1.4, d * 0.4), 0.6, Math.max(0.3, d - 0.6))
}

/**
 * Split a wall (length `len`, height `h`) into the solid rectangles that are
 * left after cutting `openings` out of it: the full-height runs between the
 * holes, plus the spandrel under and head over each raised hole. Shared by the
 * interior walls and the building shell so both open up the same way.
 */
export function wallPanels(
  len: number,
  h: number,
  openings: Opening[],
): Array<{ u0: number; u1: number; y0: number; y1: number }> {
  const cuts = openings
    .map((o) => [Math.max(-len / 2, o.c - o.w / 2), Math.min(len / 2, o.c + o.w / 2), o.y0, Math.min(o.y1, h)] as const)
    .filter((c) => c[1] - c[0] > 0.02 && c[3] - c[2] > 0.05) // misses this wall entirely
    .map((c) => [...c] as [number, number, number, number])
    .sort((p, q) => p[0] - q[0])
  // overlapping holes open over the union of their bands, so the wall is never
  // left with a sliver wedged between two windows
  const merged: Array<[number, number, number, number]> = []
  for (const c of cuts) {
    const last = merged[merged.length - 1]
    if (last && c[0] <= last[1] + 0.01) {
      last[1] = Math.max(last[1], c[1])
      last[2] = Math.min(last[2], c[2])
      last[3] = Math.max(last[3], c[3])
    } else merged.push(c)
  }
  const res: Array<{ u0: number; u1: number; y0: number; y1: number }> = []
  let cursor = -len / 2
  for (const [x0, x1] of merged) {
    if (x0 - cursor > 0.04) res.push({ u0: cursor, u1: x0, y0: 0, y1: h })
    cursor = Math.max(cursor, x1)
  }
  if (len / 2 - cursor > 0.04) res.push({ u0: cursor, u1: len / 2, y0: 0, y1: h })
  for (const [x0, x1, y0, y1] of merged) {
    if (y0 > 0.04) res.push({ u0: x0, u1: x1, y0: 0, y1: y0 })
    if (y1 < h - 0.04) res.push({ u0: x0, u1: x1, y0: y1, y1: h })
  }
  return res
}

/**
 * Glass openings and doors placed on the building perimeter, resolved onto one
 * shell wall. `rotWant` is the rotation an edge item takes on that wall
 * (0 = north/-z, 4 = south/+z, 2 = west/-x, 6 = east/+x) and `centerZ` shifts
 * the long walls into the shell's local frame. Doors cut to the floor; glass
 * openings start at their sill. Both leave a real hole for the placed item to
 * sit in, so the facade shows the actual door or window, not a painted panel.
 */
export function shellOpenings(objects: Placed[], rotWant: number, centerZ: number, wallH: number): Opening[] {
  const res: Opening[] = []
  for (const o of objects) {
    const glass = o.category === 'window'
    if ((!glass && o.category !== 'door') || o.rule !== 'edge' || o.rot !== rotWant) continue
    const c = rotWant === 0 || rotWant === 4 ? o.x : o.z - centerZ
    const y0 = glass ? clamp(o.sill ?? 0.9, 0, Math.max(0, wallH - 0.2)) : 0
    res.push({ c, w: o.w + (glass ? 0 : 0.12), y0, y1: Math.min(y0 + o.h, wallH - 0.02), glass })
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
