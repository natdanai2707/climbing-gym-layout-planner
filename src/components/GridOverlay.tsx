import { useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

function makeGridGeometry(w: number, l: number, cell: number) {
  const pts: number[] = []
  const hw = w / 2
  const hl = l / 2
  for (let x = -hw; x <= hw + 1e-6; x += cell) pts.push(x, 0, -hl, x, 0, hl)
  for (let z = -hl; z <= hl + 1e-6; z += cell) pts.push(-hw, 0, z, hw, 0, z)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return geo
}

// Grid lines over the building floor (stronger) and the apron (fainter)
export function GridOverlay() {
  const building = useStore((s) => s.building)
  const showGrid = useStore((s) => s.showGrid)
  const { width: W, length: L, cell, apron } = building

  const inner = useMemo(() => makeGridGeometry(W, L, cell), [W, L, cell])
  const outer = useMemo(() => makeGridGeometry(W + apron * 2, L + apron * 2, cell), [W, L, cell, apron])

  if (!showGrid) return null
  return (
    <group>
      <lineSegments geometry={outer} position={[0, -0.035, 0]}>
        <lineBasicMaterial color="#b9b5aa" transparent opacity={0.35} />
      </lineSegments>
      <lineSegments geometry={inner} position={[0, 0.012, 0]}>
        <lineBasicMaterial color="#a2865f" transparent opacity={0.45} />
      </lineSegments>
    </group>
  )
}
