import { MeshReflectorMaterial } from '@react-three/drei'
import { useStore } from '../store'
import { surfaceMap } from '../materials'

// Reflection strength per floor finish (polished concrete shines the most)
const MIRROR: Record<string, number> = { paint: 0.3, concrete: 0.35, birch: 0.16, epdm: 0.07 }

// One neutral ground slab for the whole working area, plus the warehouse
// floor that exactly matches the shell footprint (width × length at centerZ).
// The hall floor finish (painted / concrete / birch / EPDM) comes from the
// floor state, set directly or by a theme. In Realistic mode the hall floor
// becomes softly reflective, like a fresh polished slab.
export function BuildingFloor() {
  const { width: W, length: L, apron, centerZ } = useStore((s) => s.building)
  const floor = useStore((s) => s.floor)
  const real = useStore((s) => s.quality === 'high')
  const map = floor.material === 'paint' ? null : surfaceMap(floor.material, W, L)

  return (
    <group position={[0, 0, centerZ]}>
      {/* neutral ground (apron) slab */}
      <mesh position={[0, -0.13, 0]} receiveShadow>
        <boxGeometry args={[W + apron * 2, 0.18, L + apron * 2]} />
        <meshStandardMaterial color="#d6d2c8" roughness={1} />
      </mesh>
      {/* warehouse floor slab — follows the shell size. Roughness matches the
          finish: polished concrete is far glossier than rubber. */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[W, 0.2, L]} />
        <meshStandardMaterial
          key={floor.material} // map add/remove needs a fresh material
          color={floor.color}
          map={map ?? undefined}
          roughness={{ concrete: 0.35, paint: 0.5, birch: 0.45, epdm: 0.85 }[floor.material] ?? 0.6}
          metalness={0}
        />
      </mesh>
      {/* realistic mode: reflective finish layer over the hall floor */}
      {real && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]} receiveShadow>
          <planeGeometry args={[W, L]} />
          <MeshReflectorMaterial
            key={floor.material}
            color={floor.color}
            map={map ?? undefined}
            blur={[260, 80]}
            resolution={512}
            mixBlur={1}
            mixStrength={7}
            depthScale={0.8}
            minDepthThreshold={0.6}
            maxDepthThreshold={1.4}
            roughness={0.55}
            metalness={0.05}
            mirror={MIRROR[floor.material] ?? 0.25}
          />
        </mesh>
      )}
    </group>
  )
}
