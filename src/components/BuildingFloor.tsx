import { useStore } from '../store'
import { surfaceMap, surfaceNormal } from '../materials'
import { GROUND_Y } from '../placement'

// One neutral ground slab for the whole working area, plus the warehouse
// floor that exactly matches the shell footprint (width × length at centerZ).
// The hall floor finish (painted / concrete / birch / EPDM) comes from the
// floor state, set directly or by a theme. Gym floors are sealed, not
// mirror-polished, so roughness alone carries the finish — no reflections.
const PLINTH_TOP = -0.04

export function BuildingFloor() {
  const { width: W, length: L, apron, centerZ } = useStore((s) => s.building)
  const floor = useStore((s) => s.floor)
  const detail = useStore((s) => s.quality !== 'low')
  const map = floor.material === 'paint' ? null : surfaceMap(floor.material, W, L)

  return (
    <group position={[0, 0, centerZ]}>
      {/* the site around the building, one plinth height below the hall floor */}
      <mesh position={[0, GROUND_Y - 0.09, 0]} receiveShadow>
        <boxGeometry args={[W + apron * 2, 0.18, L + apron * 2]} />
        <meshStandardMaterial color="#d6d2c8" roughness={1} />
      </mesh>
      {/* Concrete plinth: the raised slab edge the hall floor sits on. Its top
          stops just short of the hall floor's, because two faces at exactly the
          same height over the whole footprint z-fight — the floor flickers as
          the camera pans. The 4 cm it gives up reads as the slab edge. */}
      <mesh position={[0, (GROUND_Y - 0.1 + PLINTH_TOP) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W + 0.3, PLINTH_TOP - (GROUND_Y - 0.1), L + 0.3]} />
        <meshStandardMaterial color="#c2beb4" map={surfaceMap('concrete', W, L)} roughness={0.85} metalness={0} />
      </mesh>
      {/* warehouse floor slab — follows the shell size. Roughness matches the
          finish: sealed concrete is smoother than rubber, but none of them
          mirror the room. */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[W, 0.2, L]} />
        <meshStandardMaterial
          key={floor.material} // map add/remove needs a fresh material
          color={floor.color}
          map={map ?? undefined}
          normalMap={detail && floor.material !== 'paint' ? surfaceNormal(floor.material, W, L) : undefined}
          roughness={{ concrete: 0.62, paint: 0.7, birch: 0.6, epdm: 0.9 }[floor.material] ?? 0.7}
          metalness={0}
        />
      </mesh>
    </group>
  )
}
