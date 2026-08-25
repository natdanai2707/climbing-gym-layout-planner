import { useMemo } from 'react'
import type { WallDesign } from '../types'
import { Holds } from '../components/details'
import { designDepth, designMaxOff, designWidth, sectionPoints } from './profile'

const STEEL = '#4b5563'

function B({
  args,
  pos,
  color,
  rotX = 0,
}: {
  args: [number, number, number]
  pos: [number, number, number]
  color: string
  rotX?: number
}) {
  return (
    <mesh position={pos} rotation-x={rotX} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  )
}

/**
 * Renders a custom wall design in its local frame (origin at footprint center,
 * x across the width, z toward the mat) — exactly matching the exporter
 * geometry, plus decorative holds.
 */
export function WallModel({ design, tint, holds = true }: { design: WallDesign; tint?: string | null; holds?: boolean }) {
  const W = designWidth(design)
  const depth = designDepth(design)
  const H = design.height
  const t = design.thickness
  const backZ = -depth / 2
  const wallBack = backZ + design.skeletonDepth
  const color = tint ?? design.color
  const maxOff = designMaxOff(design)

  const sections = useMemo(() => {
    let x = -W / 2
    return design.sections.map((sec) => {
      const cx = x + sec.width / 2
      x += sec.width
      return { cx, sec, pts: sectionPoints(sec, H) }
    })
  }, [design, W, H])

  const posts = useMemo(() => {
    const n = Math.max(2, Math.round(W / 1.6))
    return Array.from({ length: n }, (_, i) => -W / 2 + 0.15 + (i * (W - 0.3)) / (n - 1))
  }, [W])

  return (
    <group>
      {/* steel skeleton */}
      {posts.map((px, i) => (
        <group key={`p${i}`} position={[px, 0, 0]}>
          <B args={[0.08, H, 0.08]} pos={[0, H / 2, backZ + 0.06]} color={STEEL} />
          <B args={[0.07, 0.07, design.skeletonDepth + 0.3]} pos={[0, H * 0.35, backZ + (design.skeletonDepth + 0.3) / 2]} color={STEEL} />
          <B
            args={[0.07, 0.07, design.skeletonDepth + maxOff * 0.7]}
            pos={[0, H * 0.85, backZ + (design.skeletonDepth + maxOff * 0.7) / 2]}
            color={STEEL}
          />
          <B
            args={[0.06, Math.hypot(H * 0.5, design.skeletonDepth + 0.2), 0.06]}
            pos={[0, H * 0.6, backZ + (design.skeletonDepth + 0.2) / 2]}
            rotX={Math.atan2(design.skeletonDepth + 0.2, H * 0.5)}
            color={STEEL}
          />
        </group>
      ))}
      {/* climbing panels */}
      {sections.map(({ cx, sec, pts }, si) => (
        <group key={si} position={[cx, 0, 0]}>
          {pts.slice(0, -1).map((p0, i) => {
            const p1 = pts[i + 1]
            const dy = p1.y - p0.y
            const doff = p1.off - p0.off
            const len = Math.hypot(dy, doff) + 0.1
            const ang = Math.atan2(doff, dy)
            return (
              <group key={i} position={[0, (p0.y + p1.y) / 2, wallBack + t / 2 + (p0.off + p1.off) / 2]} rotation-x={ang}>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[sec.width - 0.03, len, t]} />
                  <meshStandardMaterial color={color} roughness={0.85} />
                </mesh>
                {holds && len > 0.7 && (
                  <group position={[0, 0, t / 2 + 0.03]}>
                    <Holds w={sec.width - 0.03} len={len} count={Math.round(Math.min(50, Math.max(4, sec.width * len * 1.6)))} />
                  </group>
                )}
              </group>
            )
          })}
          {/* top cap */}
          <B args={[sec.width - 0.03, 0.12, 0.5]} pos={[0, H + 0.06, wallBack + t / 2 + pts[pts.length - 1].off]} color="#e6e1d6" />
        </group>
      ))}
      {/* landing mat */}
      {design.matDepth > 0.05 && (
        <mesh position={[0, design.matThick / 2, depth / 2 - design.matDepth / 2]} castShadow receiveShadow>
          <boxGeometry args={[W, design.matThick, design.matDepth]} />
          <meshStandardMaterial color={tint ?? '#5b8ee6'} roughness={0.85} />
        </mesh>
      )}
    </group>
  )
}
