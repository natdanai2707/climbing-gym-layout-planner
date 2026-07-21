import { useMemo } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { useStore } from '../store'
import { ArrowHandle } from './gizmo'

// Roof pitch of the gable (rise over half-width). ~15°.
export const ROOF_PITCH = Math.tan((15 * Math.PI) / 180)

/**
 * Gable-roof warehouse shell around the building. The gable (triangle) sits on
 * the SHORT ends, so the ridge runs along the building's length. Width follows
 * the building (20 m by default); length and eave height are adjustable with
 * the orange arrows. Modes: 1 = transparent ghost, 2 = solid with a solar roof.
 */
export function WarehouseShell() {
  const shell = useStore((s) => s.shell)
  const building = useStore((s) => s.building)
  const setShellResizing = useStore((s) => s.setShellResizing)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  const W = building.width
  const L = shell.length ?? building.length
  const eave = shell.eave
  const rise = (W / 2) * ROOF_PITCH
  const ridge = eave + rise
  const t = 0.15

  const gable = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-W / 2, 0)
    s.lineTo(W / 2, 0)
    s.lineTo(W / 2, eave)
    s.lineTo(0, ridge)
    s.lineTo(-W / 2, eave)
    s.closePath()
    return s
  }, [W, eave, ridge])

  if (shell.mode === 0) return null
  const transparent = shell.mode === 1

  const wallMat = transparent
    ? { color: '#8fb0cc', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }
    : { color: '#eef0f2', side: THREE.DoubleSide }
  const roofMat = transparent
    ? { color: '#7fa3c4', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }
    : { color: '#cfd6dd', side: THREE.DoubleSide }

  const slope = Math.atan2(rise, W / 2)
  const roofLen = Math.hypot(W / 2, rise) + 0.3

  const startResize = (which: 'length' | 'height') => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    setShellResizing(which)
  }

  // solar panel grid for one roof plane (local coords of the rotated roof group)
  const solarPanels = (keyPrefix: string) => {
    const cols = Math.max(1, Math.floor((L - 1.5) / 2.3))
    const rows = Math.max(1, Math.floor((roofLen - 1.2) / 2.1))
    const out: ReactNode[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push(
          <mesh
            key={`${keyPrefix}-${r}-${c}`}
            position={[
              -roofLen / 2 + 0.8 + (r + 0.5) * ((roofLen - 1.2) / rows),
              0.12,
              -L / 2 + 0.9 + (c + 0.5) * ((L - 1.5) / cols),
            ]}
          >
            <boxGeometry args={[(roofLen - 1.2) / rows - 0.25, 0.07, (L - 1.5) / cols - 0.25]} />
            <meshStandardMaterial color="#16283f" roughness={0.35} metalness={0.4} />
          </mesh>,
        )
      }
    }
    return out
  }

  return (
    <group>
      {/* long side walls */}
      <mesh position={[-W / 2 - t / 2, eave / 2, 0]}>
        <boxGeometry args={[t, eave, L]} />
        <meshStandardMaterial {...wallMat} />
        {transparent && <Edges color="#5c7fa6" />}
      </mesh>
      <mesh position={[W / 2 + t / 2, eave / 2, 0]}>
        <boxGeometry args={[t, eave, L]} />
        <meshStandardMaterial {...wallMat} />
        {transparent && <Edges color="#5c7fa6" />}
      </mesh>
      {/* gable end walls (short sides) */}
      <mesh position={[0, 0, -L / 2 - t / 2]}>
        <shapeGeometry args={[gable]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[0, 0, L / 2 + t / 2]}>
        <shapeGeometry args={[gable]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      {/* roof planes */}
      <group position={[-W / 4, (eave + ridge) / 2, 0]} rotation-z={slope}>
        <mesh>
          <boxGeometry args={[roofLen, 0.12, L + 0.4]} />
          <meshStandardMaterial {...roofMat} />
          {transparent && <Edges color="#5c7fa6" />}
        </mesh>
        {!transparent && solarPanels('l')}
      </group>
      <group position={[W / 4, (eave + ridge) / 2, 0]} rotation-z={-slope}>
        <mesh>
          <boxGeometry args={[roofLen, 0.12, L + 0.4]} />
          <meshStandardMaterial {...roofMat} />
          {transparent && <Edges color="#5c7fa6" />}
        </mesh>
        {!transparent && solarPanels('r')}
      </group>
      {/* ridge beam */}
      <mesh position={[0, ridge + 0.05, 0]}>
        <boxGeometry args={[0.3, 0.14, L + 0.4]} />
        <meshStandardMaterial color={transparent ? '#5c7fa6' : '#aab3bc'} transparent={transparent} opacity={transparent ? 0.5 : 1} />
      </mesh>
      {/* adjustment arrows: shell length (orange, at the far gable) + eave height (orange, at the ridge) */}
      <ArrowHandle color="#f97316" pos={[0, 1.2, L / 2 + 0.6]} rot={[Math.PI / 2, 0, 0]} onDown={startResize('length')} size={1.4} />
      <ArrowHandle color="#f97316" pos={[0, ridge + 0.4, 0]} rot={[0, 0, 0]} onDown={startResize('height')} size={1.4} />
    </group>
  )
}
