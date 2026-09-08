import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { Placed } from '../types'

/**
 * 2D architectural plan symbols. In plan (2D) mode every placed item renders
 * as a flat drawing — translucent fill, crisp outline, and the classic
 * symbols: door swing arcs, tread lines with a direction arrow on stairs,
 * branched circles for trees, dashed outlines for overhead items.
 * Drawn in the object's local frame (the parent group applies rotation).
 */

const OUTLINE = '#3a3f45'
const V = (x: number, y: number, z: number): [number, number, number] => [x, y, z]

function rectPts(w: number, d: number, y: number): [number, number, number][] {
  return [V(-w / 2, y, -d / 2), V(w / 2, y, -d / 2), V(w / 2, y, d / 2), V(-w / 2, y, d / 2), V(-w / 2, y, -d / 2)]
}

function circlePts(r: number, y: number, n = 28): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return V(Math.cos(a) * r, y, Math.sin(a) * r)
  })
}

function Fill({
  w,
  d,
  y,
  color,
  opacity = 0.4,
}: {
  w: number
  d: number
  y: number
  color: string
  opacity?: number
}) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, y, 0]} renderOrder={Math.round(y * 100)}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

function Outline({
  w,
  d,
  y,
  color = OUTLINE,
  width = 1.6,
  dashed = false,
}: {
  w: number
  d: number
  y: number
  color?: string
  width?: number
  dashed?: boolean
}) {
  return <Line points={rectPts(w, d, y)} color={color} lineWidth={width} dashed={dashed} dashSize={0.35} gapSize={0.2} />
}

// plan drawing height per kind, so overlapping fills layer predictably
function layerY(o: Placed): number {
  if (o.category === 'zone' || o.defId === 'path' || o.category === 'parking') return 0.02
  if (o.category === 'mat' || o.defId === 'pond') return 0.045
  if (o.category === 'room' || o.category === 'mezzanine') return 0.06
  if (o.category === 'door') return 0.1
  if (o.category === 'ceiling' || o.category === 'hvac' || o.category === 'tech') return 0.12
  if (o.category === 'person') return 0.14
  return 0.08
}

export function PlanSymbol({ o, tint }: { o: Placed; tint: string | null }) {
  const y = layerY(o)
  const c = tint ?? o.color

  const stairsTreads = useMemo(() => {
    if (o.category !== 'stairs') return []
    const n = Math.max(4, Math.round(o.d / 0.3))
    return Array.from({ length: n - 1 }, (_, i) => -o.d / 2 + ((i + 1) * o.d) / n)
  }, [o.category, o.d])

  // doors: classic swing symbol — hinge at one jamb, leaf + quarter arc
  if (o.category === 'door') {
    const r = o.w
    return (
      <group>
        <Fill w={o.w} d={Math.max(0.2, o.d)} y={y - 0.01} color="#ffffff" opacity={0.9} />
        <Line points={[V(-o.w / 2, y, 0), V(-o.w / 2, y, -r)]} color={OUTLINE} lineWidth={1.8} />
        <mesh rotation-x={-Math.PI / 2} position={[-o.w / 2, y, 0]} renderOrder={Math.round(y * 100)}>
          <ringGeometry args={[r - 0.03, r, 24, 1, Math.PI / 2, Math.PI / 2]} />
          <meshBasicMaterial color={OUTLINE} transparent opacity={0.9} depthWrite={false} />
        </mesh>
        <Outline w={o.w} d={Math.max(0.2, o.d)} y={y} width={1.4} />
      </group>
    )
  }

  // trees & garden circles: branched-circle symbol
  if (o.defId === 'tree_small' || o.defId === 'tree_big' || o.defId === 'tree_cone' || o.defId === 'tree_slim') {
    const r = Math.min(o.w, o.d) / 2
    return (
      <group>
        <Fill w={r * 2} d={r * 2} y={y - 0.01} color={c} opacity={0.12} />
        <Line points={circlePts(r, y)} color="#4e7d3e" lineWidth={1.6} />
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + 0.3
          return (
            <Line
              key={i}
              points={[V(Math.cos(a) * r * 0.15, y, Math.sin(a) * r * 0.15), V(Math.cos(a) * r * 0.92, y, Math.sin(a) * r * 0.92)]}
              color="#4e7d3e"
              lineWidth={1}
            />
          )
        })}
      </group>
    )
  }

  if (o.defId === 'pond') {
    return (
      <group>
        <mesh rotation-x={-Math.PI / 2} position={[0, y, 0]} scale={[o.w / 2, o.d / 2, 1]} renderOrder={Math.round(y * 100)}>
          <circleGeometry args={[1, 28]} />
          <meshBasicMaterial color="#7ab1d2" transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <Line
          points={circlePts(1, y).map((p) => V(p[0] * (o.w / 2), y, p[2] * (o.d / 2)))}
          color="#4f7d9e"
          lineWidth={1.6}
        />
      </group>
    )
  }

  if (o.category === 'person') {
    return (
      <mesh rotation-x={-Math.PI / 2} position={[0, y, 0]} renderOrder={Math.round(y * 100)}>
        <circleGeometry args={[0.24, 16]} />
        <meshBasicMaterial color={c} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    )
  }

  if (o.category === 'stairs') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color="#ffffff" opacity={0.85} />
        <Outline w={o.w} d={o.d} y={y} width={1.8} />
        {stairsTreads.map((z, i) => (
          <Line key={i} points={[V(-o.w / 2, y, z), V(o.w / 2, y, z)]} color={OUTLINE} lineWidth={1} />
        ))}
        {/* direction arrow: UP toward -d/2 */}
        <Line points={[V(0, y + 0.005, o.d / 2 - 0.2), V(0, y + 0.005, -o.d / 2 + 0.25)]} color="#b42318" lineWidth={1.6} />
        <Line
          points={[V(-0.14, y + 0.005, -o.d / 2 + 0.5), V(0, y + 0.005, -o.d / 2 + 0.25), V(0.14, y + 0.005, -o.d / 2 + 0.5)]}
          color="#b42318"
          lineWidth={1.6}
        />
      </group>
    )
  }

  // overhead items (ceilings, ducts, fans, lights, cameras): dashed outline
  if (o.category === 'ceiling' || o.category === 'hvac' || o.category === 'tech') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.08} />
        <Outline w={o.w} d={o.d} y={y} color="#6b7280" width={1.2} dashed />
        <Line points={[V(-o.w / 2, y, -o.d / 2), V(o.w / 2, y, o.d / 2)]} color="#6b7280" lineWidth={0.8} dashed dashSize={0.3} gapSize={0.18} />
      </group>
    )
  }

  // vehicles: body + windscreen tick
  if (o.defId === 'car' || o.defId === 'moto') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.55} />
        <Outline w={o.w} d={o.d} y={y} width={1.5} />
        <Line points={[V(o.w * 0.2, y, -o.d / 2), V(o.w * 0.2, y, o.d / 2)]} color={OUTLINE} lineWidth={1} />
        <Line points={[V(-o.w * 0.28, y, -o.d / 2), V(-o.w * 0.28, y, o.d / 2)]} color={OUTLINE} lineWidth={1} />
      </group>
    )
  }

  // climbing walls: fill + a scatter of hold dots
  if (o.category === 'wall_low' || o.category === 'wall_high' || o.category === 'wall_island' || o.category === 'wall_custom') {
    const dots = Math.min(14, Math.max(4, Math.round(o.w * 1.2)))
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.5} />
        <Outline w={o.w} d={o.d} y={y} width={2} />
        {Array.from({ length: dots }, (_, i) => (
          <mesh
            key={i}
            rotation-x={-Math.PI / 2}
            position={[(((i * 73) % 100) / 100 - 0.5) * (o.w - 0.4), y + 0.004, (((i * 37) % 100) / 100 - 0.5) * (o.d - 0.2)]}
            renderOrder={Math.round(y * 100) + 1}
          >
            <circleGeometry args={[0.06, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
          </mesh>
        ))}
      </group>
    )
  }

  if (o.category === 'mezzanine') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.18} />
        <Outline w={o.w} d={o.d} y={y} width={1.8} />
        <Line points={[V(-o.w / 2, y, -o.d / 2), V(o.w / 2, y, o.d / 2)]} color={OUTLINE} lineWidth={0.8} dashed dashSize={0.3} gapSize={0.18} />
        <Line points={[V(o.w / 2, y, -o.d / 2), V(-o.w / 2, y, o.d / 2)]} color={OUTLINE} lineWidth={0.8} dashed dashSize={0.3} gapSize={0.18} />
      </group>
    )
  }

  // rooms: heavier wall outline + light fill
  if (o.category === 'room') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.22} />
        <Outline w={o.w} d={o.d} y={y} width={2.6} />
        <Outline w={o.w - 0.24} d={o.d - 0.24} y={y} width={1} />
      </group>
    )
  }

  // zones / mats / paths / parking: tinted patch
  if (o.category === 'zone' || o.category === 'mat' || o.defId === 'path' || o.category === 'parking') {
    return (
      <group>
        <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={o.category === 'zone' ? 0.3 : 0.45} />
        <Outline w={o.w} d={o.d} y={y} width={1.3} />
      </group>
    )
  }

  // everything else: generic furniture/fixture chip
  return (
    <group>
      <Fill w={o.w} d={o.d} y={y - 0.01} color={c} opacity={0.5} />
      <Outline w={o.w} d={o.d} y={y} width={1.4} />
    </group>
  )
}

// Building + apron boundary drawn the way a site plan does it.
export function PlanBuildingOutline({
  width,
  length,
  apron,
  centerZ,
}: {
  width: number
  length: number
  apron: number
  centerZ: number
}) {
  return (
    <group position={[0, 0, centerZ]}>
      <Line points={rectPts(width, length, 0.03)} color="#2b2926" lineWidth={3} />
      <Line
        points={rectPts(width + apron * 2, length + apron * 2, 0.025)}
        color="#8b867c"
        lineWidth={1.4}
        dashed
        dashSize={0.8}
        gapSize={0.45}
      />
    </group>
  )
}
