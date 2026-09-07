import { useStore } from '../store'
import { surfaceMap } from '../materials'

// One neutral ground slab for the whole working area, plus the warehouse
// floor that exactly matches the shell footprint (width × length at centerZ).
// The hall floor finish (painted / concrete / birch / EPDM) comes from the
// floor state, set directly or by a theme.
export function BuildingFloor() {
  const { width: W, length: L, apron, centerZ } = useStore((s) => s.building)
  const floor = useStore((s) => s.floor)
  const map = floor.material === 'paint' ? null : surfaceMap(floor.material, W, L)

  return (
    <group position={[0, 0, centerZ]}>
      {/* neutral ground (apron) slab */}
      <mesh position={[0, -0.13, 0]} receiveShadow>
        <boxGeometry args={[W + apron * 2, 0.18, L + apron * 2]} />
        <meshStandardMaterial color="#d6d2c8" roughness={1} />
      </mesh>
      {/* warehouse floor slab — follows the shell size */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[W, 0.2, L]} />
        <meshStandardMaterial
          key={floor.material} // map add/remove needs a fresh material
          color={floor.color}
          map={map ?? undefined}
          roughness={0.95}
        />
      </mesh>
    </group>
  )
}
