import { useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import type { CanopyDef, FacadePanel, ShellDesign, ShellSegment } from '../types'
import { surfaceMap, surfaceMapWorld } from '../materials'
import { ROOF_PITCH } from './WarehouseShell'

/**
 * Freeform designed building shell. The building is a run of ZONES along its
 * length, and each zone's CROSS-SECTION is shaped across the width too:
 * independent left/right wall heights, a gable ridge that can sit anywhere
 * across the width, or a shed roof whose slope comes from the height
 * difference — so one side can be a 14 m climbing bay while the other stays
 * low. Plus canopies (posts or hung) and free-shape glazing per facade.
 */

const GLASS_MAT = { color: '#9fc8e0', transparent: true, opacity: 0.45, roughness: 0.12, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }
const CLEAR_MAT = { color: '#f2f7fa', transparent: true, opacity: 0.5, roughness: 0.3, emissive: '#dfeaf2', emissiveIntensity: 0.2, side: THREE.DoubleSide, depthWrite: false }

// fully-resolved zone: legacy fields (eave / slopeL / slopeR / flat) migrated
export interface NormSeg {
  len: number
  eaveL: number
  eaveR: number
  roof: 'gable' | 'shed'
  ridgeX: number
  rise: number
  color: string
  clear?: boolean
}

export interface SegSpan extends NormSeg {
  z0: number
  z1: number
}

export function normalizeSegment(s: ShellSegment): NormSeg {
  let eaveL = s.eaveL
  let eaveR = s.eaveR
  if (eaveL === undefined || eaveR === undefined) {
    const e = s.eave ?? 6
    if (s.roof === 'slopeL') {
      eaveL = e + s.rise
      eaveR = e
    } else if (s.roof === 'slopeR') {
      eaveL = e
      eaveR = e + s.rise
    } else {
      eaveL = e
      eaveR = e
    }
  }
  const roof: NormSeg['roof'] = s.roof === 'gable' ? 'gable' : 'shed'
  return {
    len: Math.max(0.5, s.len),
    eaveL,
    eaveR,
    roof,
    ridgeX: Math.min(0.95, Math.max(0.05, s.ridgeX ?? 0.5)),
    rise: Math.max(0, s.rise),
    color: s.color,
    clear: s.clear,
  }
}

// segment z-ranges in shell-local coords (z measured from -L/2), scaled to fit L
export function segmentSpans(design: ShellDesign, L: number): SegSpan[] {
  const norm = design.segments.map(normalizeSegment)
  const total = norm.reduce((a, s) => a + s.len, 0) || 1
  const k = L / total
  let z = -L / 2
  return norm.map((s) => {
    const z0 = z
    z += s.len * k
    return { ...s, z0, z1: z }
  })
}

// roof profile across the width: list of (x, y) from the left eave to the right
export function roofProfile(seg: NormSeg, W: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[-W / 2, seg.eaveL]]
  if (seg.roof === 'gable')
    pts.push([seg.ridgeX * W - W / 2, Math.max(seg.eaveL, seg.eaveR) + Math.max(0.05, seg.rise)])
  pts.push([W / 2, seg.eaveR])
  return pts
}

const segTop = (seg: NormSeg): number =>
  seg.roof === 'gable' ? Math.max(seg.eaveL, seg.eaveR) + Math.max(0.05, seg.rise) : Math.max(seg.eaveL, seg.eaveR)

export function designVolume(design: ShellDesign, W: number, L: number): number {
  return segmentSpans(design, L).reduce((a, s) => {
    let area = (W * (s.eaveL + s.eaveR)) / 2
    if (s.roof === 'gable') {
      const chordY = s.eaveL + (s.eaveR - s.eaveL) * s.ridgeX
      area += 0.5 * W * Math.max(0, segTop(s) - chordY)
    }
    return a + (s.z1 - s.z0) * area
  }, 0)
}

export function designMaxHeight(design: ShellDesign): number {
  return Math.max(...design.segments.map((s) => segTop(normalizeSegment(s))), 3)
}

function Cladding({ seg }: { seg: NormSeg }) {
  return seg.clear ? (
    <meshStandardMaterial {...CLEAR_MAT} />
  ) : (
    <meshStandardMaterial color={seg.color} map={surfaceMapWorld('metalsheet')} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />
  )
}

// end-wall cross-section: floor, both eaves and the roof profile between them
function endShape(seg: NormSeg, W: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-W / 2, 0)
  s.lineTo(W / 2, 0)
  const prof = roofProfile(seg, W)
  for (let i = prof.length - 1; i >= 0; i--) s.lineTo(prof[i][0], prof[i][1])
  s.closePath()
  return s
}

function SegmentRoof({ seg, W }: { seg: SegSpan; W: number }) {
  const len = seg.z1 - seg.z0
  const zc = (seg.z0 + seg.z1) / 2
  const prof = roofProfile(seg, W)
  return (
    <group position={[0, 0, zc]}>
      {prof.slice(0, -1).map(([x0, y0], i) => {
        const [x1, y1] = prof[i + 1]
        const planeLen = Math.hypot(x1 - x0, y1 - y0) + 0.3
        const ang = Math.atan2(y1 - y0, x1 - x0)
        return (
          <mesh key={i} position={[(x0 + x1) / 2, (y0 + y1) / 2 + 0.05, 0]} rotation-z={ang} castShadow>
            <boxGeometry args={[planeLen, 0.12, len + 0.1]} />
            <meshStandardMaterial color="#cfd6dd" roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
      {seg.roof === 'gable' && (
        <mesh position={[seg.ridgeX * W - W / 2, segTop(seg) + 0.1, 0]}>
          <boxGeometry args={[0.3, 0.14, len + 0.1]} />
          <meshStandardMaterial color="#aab3bc" />
        </mesh>
      )}
    </group>
  )
}

// canopy in its local frame: x = 0..len along the wall, +z = outward
function Canopy({ c }: { c: CanopyDef }) {
  const tilt = Math.atan(0.18)
  const attach = c.h + c.depth * 0.18 // wall-side edge sits higher
  const slopeLen = Math.hypot(c.depth, c.depth * 0.18) + 0.1
  const posts = Math.max(2, Math.ceil(c.len / 3))
  const mat =
    c.material === 'clear' ? (
      <meshStandardMaterial {...CLEAR_MAT} />
    ) : c.material === 'canvas' ? (
      <meshStandardMaterial color={c.color} roughness={0.95} side={THREE.DoubleSide} />
    ) : (
      <meshStandardMaterial color={c.color} map={surfaceMapWorld('metalsheet')} roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
    )
  return (
    <group>
      <group position={[c.len / 2, (attach + c.h) / 2, c.depth / 2 - 0.02]} rotation-x={tilt}>
        <mesh castShadow>
          <boxGeometry args={[c.len, 0.06, slopeLen]} />
          {mat}
        </mesh>
        {/* front fascia / canvas valance */}
        <mesh position={[0, -0.09, slopeLen / 2 - 0.02]}>
          <boxGeometry args={[c.len, c.material === 'canvas' ? 0.22 : 0.12, 0.03]} />
          {c.material === 'canvas' ? <meshStandardMaterial color={c.color} roughness={0.95} /> : <meshStandardMaterial color="#7c828a" metalness={0.5} roughness={0.4} />}
        </mesh>
      </group>
      {/* wall attachment ledger */}
      <mesh position={[c.len / 2, attach + 0.02, 0.03]}>
        <boxGeometry args={[c.len, 0.1, 0.08]} />
        <meshStandardMaterial color="#6b7280" metalness={0.5} roughness={0.4} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => {
        const x = c.len * ((i + 0.5) / posts)
        return c.support === 'posts' ? (
          <mesh key={i} position={[x, c.h / 2, c.depth - 0.12]} castShadow>
            <cylinderGeometry args={[0.045, 0.05, c.h, 10]} />
            <meshStandardMaterial color="#4b5563" metalness={0.6} roughness={0.35} />
          </mesh>
        ) : (
          // hung: tension rods from the wall above down to the outer edge
          <group key={i}>
            {(() => {
              const top = new THREE.Vector3(x, attach + Math.min(1.2, c.depth * 0.7), 0.04)
              const out = new THREE.Vector3(x, c.h + 0.03, c.depth - 0.15)
              const d = out.clone().sub(top)
              return (
                <mesh
                  position={top.clone().add(out).multiplyScalar(0.5)}
                  quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())}
                >
                  <cylinderGeometry args={[0.016, 0.016, d.length(), 8]} />
                  <meshStandardMaterial color="#9aa2ab" metalness={0.7} roughness={0.3} />
                </mesh>
              )
            })()}
          </group>
        )
      })}
    </group>
  )
}

function panelMat(p: FacadePanel) {
  if (p.kind === 'glass') return <meshStandardMaterial {...GLASS_MAT} />
  if (p.kind === 'clear') return <meshStandardMaterial {...CLEAR_MAT} />
  return <meshStandardMaterial color={p.color ?? '#5b6570'} map={surfaceMapWorld('metalsheet')} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />
}

export function SegmentedShell({ force = false }: { force?: boolean }) {
  const design = useStore((s) => s.shellDesign)
  const mode = useStore((s) => s.shell.mode)
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)
  const W = building.width
  const L = building.length
  const t = 0.15
  const off = building.centerZ

  const spans = useMemo(() => (design ? segmentSpans(design, L) : []), [design, L])
  const doors = useMemo(() => objects.filter((o) => o.category === 'door' && o.rule === 'edge'), [objects])

  const panelShapes = useMemo(() => {
    if (!design) return []
    return design.panels
      .filter((p) => p.pts.length >= 3)
      .map((p) => {
        const sh = new THREE.Shape()
        const wallLen = p.side === 'E' || p.side === 'W' ? L : W
        p.pts.forEach(([u, y], i) => {
          const x = u - wallLen / 2
          if (i === 0) sh.moveTo(x, y)
          else sh.lineTo(x, y)
        })
        sh.closePath()
        return { p, sh }
      })
  }, [design, L, W])

  if (!design || (!force && mode === 0)) return null

  return (
    <group position={[0, 0, off]}>
      {spans.map((seg, i) => {
        const len = seg.z1 - seg.z0
        const zc = (seg.z0 + seg.z1) / 2
        return (
          <group key={i}>
            {/* side walls: left (-X) and right (+X) have independent heights */}
            <mesh position={[-W / 2 - t / 2, seg.eaveL / 2, zc]} castShadow>
              <boxGeometry args={[t, seg.eaveL, len]} />
              {seg.clear ? <meshStandardMaterial {...CLEAR_MAT} /> : <meshStandardMaterial color={seg.color} map={surfaceMap('metalsheet', len, seg.eaveL)} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />}
            </mesh>
            <mesh position={[W / 2 + t / 2, seg.eaveR / 2, zc]} castShadow>
              <boxGeometry args={[t, seg.eaveR, len]} />
              {seg.clear ? <meshStandardMaterial {...CLEAR_MAT} /> : <meshStandardMaterial color={seg.color} map={surfaceMap('metalsheet', len, seg.eaveR)} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />}
            </mesh>
            <SegmentRoof seg={seg} W={W} />
            {/* bulkhead face where the next zone has a different profile */}
            {i < spans.length - 1 &&
              (Math.abs(segTop(spans[i + 1]) - segTop(seg)) > 0.1 ||
                Math.abs(spans[i + 1].eaveL - seg.eaveL) > 0.1 ||
                Math.abs(spans[i + 1].eaveR - seg.eaveR) > 0.1) && (
                <mesh position={[0, 0, seg.z1]}>
                  <shapeGeometry args={[endShape(segTop(seg) >= segTop(spans[i + 1]) ? seg : spans[i + 1], W)]} />
                  <Cladding seg={segTop(seg) >= segTop(spans[i + 1]) ? seg : spans[i + 1]} />
                </mesh>
              )}
          </group>
        )
      })}
      {/* end walls follow the first/last zone cross-section */}
      {spans.length > 0 && (
        <>
          <mesh position={[0, 0, -L / 2 - t / 2]}>
            <shapeGeometry args={[endShape(spans[0], W)]} />
            <Cladding seg={spans[0]} />
          </mesh>
          <mesh position={[0, 0, L / 2 + t / 2]}>
            <shapeGeometry args={[endShape(spans[spans.length - 1], W)]} />
            <Cladding seg={spans[spans.length - 1]} />
          </mesh>
        </>
      )}
      {/* free-shape glazing / cladding panels per facade */}
      {panelShapes.map(({ p, sh }, i) => {
        const pos: [number, number, number] =
          p.side === 'E' ? [W / 2 + t + 0.03, 0, 0] : p.side === 'W' ? [-W / 2 - t - 0.03, 0, 0] : p.side === 'N' ? [0, 0, -L / 2 - t - 0.03] : [0, 0, L / 2 + t + 0.03]
        const rotY = p.side === 'E' ? -Math.PI / 2 : p.side === 'W' ? Math.PI / 2 : 0
        return (
          <mesh key={`p${i}`} position={pos} rotation-y={rotY}>
            <shapeGeometry args={[sh]} />
            {panelMat(p)}
          </mesh>
        )
      })}
      {/* canopies: local x along the wall, +z outward */}
      {design.canopies.map((c, i) => {
        const anchor: Record<string, { pos: [number, number, number]; rot: number }> = {
          S: { pos: [c.u0 - W / 2, 0, L / 2 + t], rot: 0 },
          N: { pos: [W / 2 - c.u0, 0, -L / 2 - t], rot: Math.PI },
          E: { pos: [W / 2 + t, 0, L / 2 - c.u0], rot: Math.PI / 2 },
          W: { pos: [-W / 2 - t, 0, -L / 2 + c.u0], rot: -Math.PI / 2 },
        }
        const a = anchor[c.side]
        return (
          <group key={`c${i}`} position={a.pos} rotation-y={a.rot}>
            <Canopy c={c} />
          </group>
        )
      })}
      {/* placed entrance / fire-exit doors shown on the facade */}
      {doors.map((d) => {
        const frame = '#6b7280'
        if (d.rot === 0 || d.rot === 4) {
          const z = d.rot === 0 ? -L / 2 - t - 0.05 : L / 2 + t + 0.05
          return (
            <group key={d.id} position={[d.x, 0, z]}>
              <mesh position={[0, d.h / 2 + 0.08, 0]}>
                <boxGeometry args={[d.w + 0.3, d.h + 0.16, 0.08]} />
                <meshStandardMaterial color={frame} />
              </mesh>
              <mesh position={[0, d.h / 2, d.rot === 0 ? -0.03 : 0.03]}>
                <boxGeometry args={[d.w, d.h, 0.08]} />
                <meshStandardMaterial color={d.color} roughness={0.6} />
              </mesh>
            </group>
          )
        }
        const x = d.rot === 2 ? -W / 2 - t - 0.05 : W / 2 + t + 0.05
        return (
          <group key={d.id} position={[x, 0, d.z - off]}>
            <mesh position={[0, d.h / 2 + 0.08, 0]}>
              <boxGeometry args={[0.08, d.h + 0.16, d.w + 0.3]} />
              <meshStandardMaterial color={frame} />
            </mesh>
            <mesh position={[d.rot === 2 ? -0.03 : 0.03, d.h / 2, 0]}>
              <boxGeometry args={[0.08, d.h, d.w]} />
              <meshStandardMaterial color={d.color} roughness={0.6} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// starting design derived from the current simple shell
export function defaultShellDesign(length: number, eave: number, width: number): ShellDesign {
  return {
    segments: [
      {
        len: Math.max(6, Math.round(length)),
        eaveL: eave,
        eaveR: eave,
        roof: 'gable',
        ridgeX: 0.5,
        rise: Math.round((width / 2) * ROOF_PITCH * 10) / 10,
        color: '#dfe3e7',
      },
    ],
    panels: [],
    canopies: [],
  }
}
