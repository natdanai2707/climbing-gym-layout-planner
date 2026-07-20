import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import type { Placed } from '../types'
import { useStore } from '../store'
import { fp } from '../placement'
import { ObjectMesh } from './details'

// Height at which the floating label hovers, per category
function labelY(o: Placed): number {
  switch (o.category) {
    case 'zone':
    case 'parking':
      return 1.1
    case 'mat':
      return 1.0
    case 'mezzanine':
      return o.h + 1.7
    default:
      return o.h + 0.7
  }
}

export function PlacedObject({ o, warning }: { o: Placed; warning: boolean }) {
  const selected = useStore((s) => s.selectedId === o.id)
  const showLabels = useStore((s) => s.showLabels)
  const beginMove = useStore((s) => s.beginMove)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  const tint = warning ? '#e05252' : null
  const baseY = o.rule === 'outdoor' ? -0.04 : 0
  const { fw, fd } = fp(o)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    beginMove(o.id, e.point.x, e.point.z)
  }

  return (
    <group position={[o.x, baseY, o.z]}>
      <group rotation-y={(o.rot * Math.PI) / 2} onPointerDown={onPointerDown}>
        <ObjectMesh o={o} tint={tint} />
      </group>
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[fw + 0.7, fd + 0.7]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
      {showLabels && (
        <Html position={[0, labelY(o), 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`obj-label${selected ? ' sel' : ''}`}>{o.label}</div>
        </Html>
      )}
    </group>
  )
}
