import { useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { GROUND_Y } from '../placement'

const EPS = 1e-6

// The snapping grid spans the whole working area, but the site around the
// building lies a plinth height below the hall floor — so each grid line is
// split at the building edge and the outdoor part is dropped to ground level.
// Otherwise the apron grid floats a metre above the ground it belongs to.
function makeGridGeometry(W: number, L: number, cell: number, apron: number) {
  const pts: number[] = []
  const hw = W / 2
  const hl = L / 2
  const ow = hw + apron
  const ol = hl + apron
  const inY = 0.012 // just above the hall floor slab
  const outY = GROUND_Y + 0.012 // just above the site slab

  // one grid line, split into the runs that lie inside vs. outside the
  // building along its own axis. `cross` is the half-extent of the building
  // across that axis; when the line misses the building it stays outdoors.
  const line = (fixed: number, from: number, to: number, cross: number, along: 'x' | 'z') => {
    const push = (a: number, b: number, y: number) => {
      if (b - a < EPS) return
      if (along === 'x') pts.push(a, y, fixed, b, y, fixed)
      else pts.push(fixed, y, a, fixed, y, b)
    }
    if (Math.abs(fixed) > cross + EPS) {
      push(from, to, outY)
      return
    }
    const c = along === 'x' ? hw : hl
    push(from, -c, outY)
    push(-c, c, inY)
    push(c, to, outY)
  }

  // lines of constant x, running along z
  for (let x = -ow; x <= ow + EPS; x += cell) line(x, -ol, ol, hw, 'z')
  // lines of constant z, running along x
  for (let z = -ol; z <= ol + EPS; z += cell) line(z, -ow, ow, hl, 'x')

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return geo
}

// One uniform snapping grid across the whole working area — it does not mark
// out the building; the warehouse shell/floor shows the actual footprint.
export function GridOverlay() {
  const building = useStore((s) => s.building)
  const showGrid = useStore((s) => s.showGrid)
  const { width: W, length: L, cell, apron, centerZ } = building

  const grid = useMemo(() => makeGridGeometry(W, L, cell, apron), [W, L, cell, apron])

  if (!showGrid) return null
  return (
    <lineSegments geometry={grid} position={[0, 0, centerZ]}>
      <lineBasicMaterial color="#aaa294" transparent opacity={0.4} />
    </lineSegments>
  )
}
