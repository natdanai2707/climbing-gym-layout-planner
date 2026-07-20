import { useStore } from '../store'

// Warm wood building slab + lighter concrete apron slab + low white perimeter walls (dollhouse style)
export function BuildingFloor() {
  const { width: W, length: L, apron } = useStore((s) => s.building)
  const wallH = 1.2
  const wallT = 0.18

  return (
    <group>
      {/* apron (outdoor) slab */}
      <mesh position={[0, -0.13, 0]} receiveShadow>
        <boxGeometry args={[W + apron * 2, 0.18, L + apron * 2]} />
        <meshStandardMaterial color="#d6d2c8" roughness={1} />
      </mesh>
      {/* building floor slab — warm wood tone */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[W, 0.2, L]} />
        <meshStandardMaterial color="#e4c9a3" roughness={0.95} />
      </mesh>
      {/* low perimeter walls */}
      <mesh position={[0, wallH / 2, -L / 2]} castShadow receiveShadow>
        <boxGeometry args={[W + wallT, wallH, wallT]} />
        <meshStandardMaterial color="#f7f5f0" roughness={0.9} />
      </mesh>
      <mesh position={[0, wallH / 2, L / 2]} castShadow receiveShadow>
        <boxGeometry args={[W + wallT, wallH, wallT]} />
        <meshStandardMaterial color="#f7f5f0" roughness={0.9} />
      </mesh>
      <mesh position={[-W / 2, wallH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wallT, wallH, L + wallT]} />
        <meshStandardMaterial color="#f7f5f0" roughness={0.9} />
      </mesh>
      <mesh position={[W / 2, wallH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wallT, wallH, L + wallT]} />
        <meshStandardMaterial color="#f7f5f0" roughness={0.9} />
      </mesh>
    </group>
  )
}
