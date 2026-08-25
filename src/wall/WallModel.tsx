import { useMemo } from 'react'
import * as THREE from 'three'
import type { WallDesign } from '../types'
import { buildWallTriangles, designDepth, vertexPos } from './profile'

const HOLD_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111827']

// deterministic pseudo-random so holds don't jump between renders
const hash = (a: number, b: number, c: number) => {
  let h = a * 374761393 + b * 668265263 + c * 1274126177
  h = (h ^ (h >> 13)) * 1103515245
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

/**
 * Renders a freeform faceted wall design in its local placement frame
 * (origin at footprint center, x across, y up, z toward the mat) — the same
 * triangle soup the exporters use, with flat shading so the facets read like
 * cut rock, plus decorative holds scattered over the surface.
 */
export function WallModel({ design, tint, holds = true }: { design: WallDesign; tint?: string | null; holds?: boolean }) {
  const color = tint ?? design.color

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(buildWallTriangles(design, { mat: false }), 3))
    g.computeVertexNormals()
    return g
  }, [design])

  const depth = designDepth(design)
  const zShift = -depth / 2 + design.skeletonDepth

  const holdList = useMemo(() => {
    if (!holds) return []
    const list: Array<{ pos: [number, number, number]; n: [number, number, number]; s: number; c: string }> = []
    const perFacet = Math.max(1, Math.round(12 / Math.max(1, (design.nx - 1) * (design.ny - 1) / 6)))
    for (let j = 0; j < design.ny - 1; j++) {
      for (let i = 0; i < design.nx - 1; i++) {
        const p00 = vertexPos(design, i, j)
        const p10 = vertexPos(design, i + 1, j)
        const p01 = vertexPos(design, i, j + 1)
        const p11 = vertexPos(design, i + 1, j + 1)
        // facet normal from the quad diagonals
        const u = [p11[0] - p00[0], p11[1] - p00[1], p11[2] - p00[2]]
        const v = [p01[0] - p10[0], p01[1] - p10[1], p01[2] - p10[2]]
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const nl = Math.hypot(n[0], n[1], n[2]) || 1
        const nn: [number, number, number] = [n[0] / nl, n[1] / nl, n[2] / nl]
        for (let k = 0; k < perFacet; k++) {
          const a = 0.18 + 0.64 * hash(i, j, k * 3 + 1)
          const b = 0.18 + 0.64 * hash(i, j, k * 3 + 2)
          // bilinear point on the facet
          const px = p00[0] * (1 - a) * (1 - b) + p10[0] * a * (1 - b) + p01[0] * (1 - a) * b + p11[0] * a * b
          const py = p00[1] * (1 - a) * (1 - b) + p10[1] * a * (1 - b) + p01[1] * (1 - a) * b + p11[1] * a * b
          const pz = p00[2] * (1 - a) * (1 - b) + p10[2] * a * (1 - b) + p01[2] * (1 - a) * b + p11[2] * a * b
          const s = 0.05 + 0.06 * hash(i, j, k * 3 + 3)
          list.push({
            pos: [px + nn[0] * s * 0.5, py + nn[1] * s * 0.5, pz + zShift + nn[2] * s * 0.5],
            n: nn,
            s,
            c: HOLD_COLORS[Math.floor(hash(j, i, k) * HOLD_COLORS.length)],
          })
        }
      }
    }
    return list
  }, [design, holds])

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.88} flatShading />
      </mesh>
      {holdList.map((h, i) => (
        <mesh key={i} position={h.pos} castShadow>
          <icosahedronGeometry args={[h.s, 0]} />
          <meshStandardMaterial color={h.c} roughness={0.7} />
        </mesh>
      ))}
      {/* landing mat in front */}
      {design.matDepth > 0.05 && (
        <mesh position={[0, design.matThick / 2, zShift + design.matDepth / 2]} castShadow receiveShadow>
          <boxGeometry args={[design.width, design.matThick, design.matDepth]} />
          <meshStandardMaterial color={tint ?? '#5b8ee6'} roughness={0.85} />
        </mesh>
      )}
    </group>
  )
}
