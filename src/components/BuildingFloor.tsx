import { useStore } from '../store'

// One neutral ground slab for the whole working area, plus the warm wood
// warehouse floor that exactly matches the shell footprint (width × length at
// centerZ). No fixed perimeter walls — the warehouse shell defines the walls.
export function BuildingFloor() {
  const { width: W, length: L, apron, centerZ } = useStore((s) => s.building)

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
        <meshStandardMaterial color="#e4c9a3" roughness={0.95} />
      </mesh>
    </group>
  )
}
