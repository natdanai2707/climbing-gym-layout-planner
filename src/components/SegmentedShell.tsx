import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import { useStore } from '../store'
import type { CanopyDef, FacadePanel, ShellDesign, ShellSegment } from '../types'
import { surfaceMap, surfaceMapWorld, surfaceNormal, surfaceNormalWorld } from '../materials'
import { ROOF_PITCH } from './WarehouseShell'
import { shellOpenings, wallPanels } from '../placement'
import type { Opening } from '../placement'

/**
 * Freeform designed building shell. The building is a run of ZONES along its
 * length, and each zone's CROSS-SECTION is shaped across the width too:
 * independent left/right wall heights, a gable ridge that can sit anywhere
 * across the width, or a shed roof whose slope comes from the height
 * difference — so one side can be a 14 m climbing bay while the other stays
 * low. Plus canopies (posts or hung) and free-shape glazing per facade.
 */

const GLASS_MAT = { color: '#9fc8e0', transparent: true, opacity: 0.45, roughness: 0.12, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }
// A "clear" zone is clad in translucent daylight sheeting, not left open: at
// opacity 0.5 a whole wall of it read as a hole in the building, so it is
// milky enough to see as a surface while still showing the layout behind it.
const CLEAR_MAT = { color: '#eef4f8', transparent: true, opacity: 0.78, roughness: 0.35, emissive: '#dfeaf2', emissiveIntensity: 0.18, side: THREE.DoubleSide, depthWrite: false }
// Shell mode 1 ("Clear"): the whole designed building becomes a ghost so the
// layout inside stays readable, exactly like the simple warehouse shell does.
const GHOST_MAT = { color: '#8fb0cc', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }
const GHOST_ROOF = { color: '#7fa3c4', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }
const GHOST_EDGE = '#5c7fa6'

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

function Cladding({ seg, ghost }: { seg: NormSeg; ghost?: boolean }) {
  const detail = useStore((s) => s.quality !== 'low')
  if (ghost) return <meshStandardMaterial {...GHOST_MAT} />
  return seg.clear ? (
    <meshStandardMaterial {...CLEAR_MAT} />
  ) : (
    <meshStandardMaterial color={seg.color} map={surfaceMapWorld('metalsheet')} normalMap={detail ? surfaceNormalWorld('metalsheet') : undefined} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />
  )
}

// end-wall cross-section: floor, both eaves and the roof profile between them.
// Glass openings placed on that facade are punched straight out of the shape.
function endShape(seg: NormSeg, W: number, ops: Opening[] = []): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-W / 2, 0)
  s.lineTo(W / 2, 0)
  const prof = roofProfile(seg, W)
  for (let i = prof.length - 1; i >= 0; i--) s.lineTo(prof[i][0], prof[i][1])
  s.closePath()
  for (const o of ops) {
    const x0 = Math.max(-W / 2 + 0.02, o.c - o.w / 2)
    const x1 = Math.min(W / 2 - 0.02, o.c + o.w / 2)
    const top = Math.min(o.y1, segTop(seg) - 0.05)
    if (x1 - x0 < 0.05 || top - o.y0 < 0.05) continue
    const p = new THREE.Path()
    p.moveTo(x0, o.y0)
    p.lineTo(x1, o.y0)
    p.lineTo(x1, top)
    p.lineTo(x0, top)
    p.closePath()
    s.holes.push(p)
  }
  return s
}

/**
 * Face that closes the step where one zone is taller than the next. Only the
 * gap BETWEEN the two roof profiles is clad: filling the whole cross-section
 * (which is what this used to do) drops an internal wall across the hall,
 * cutting the building in two. Returns null when the zones line up.
 */
function stepShape(a: NormSeg, b: NormSeg, W: number): THREE.Shape | null {
  const pa = roofProfile(a, W)
  const pb = roofProfile(b, W)
  const yAt = (prof: Array<[number, number]>, x: number) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [x0, y0] = prof[i]
      const [x1, y1] = prof[i + 1]
      if (x >= x0 - 1e-6 && x <= x1 + 1e-6) {
        const k = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
        return y0 + (y1 - y0) * k
      }
    }
    return prof[prof.length - 1][1]
  }
  // sample both profiles wherever either of them bends
  const xs = [...new Set([...pa, ...pb].map((p) => p[0]))].sort((u, v) => u - v)
  const top = xs.map((x) => [x, Math.max(yAt(pa, x), yAt(pb, x))] as [number, number])
  const bot = xs.map((x) => [x, Math.min(yAt(pa, x), yAt(pb, x))] as [number, number])
  if (top.every(([, y], i) => y - bot[i][1] < 0.05)) return null
  const sh = new THREE.Shape()
  sh.moveTo(top[0][0], top[0][1])
  for (let i = 1; i < top.length; i++) sh.lineTo(top[i][0], top[i][1])
  for (let i = bot.length - 1; i >= 0; i--) sh.lineTo(bot[i][0], bot[i][1])
  sh.closePath()
  return sh
}

function SegmentRoof({ seg, W, ghost }: { seg: SegSpan; W: number; ghost?: boolean }) {
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
          <mesh key={i} position={[(x0 + x1) / 2, (y0 + y1) / 2 + 0.05, 0]} rotation-z={ang} castShadow={!ghost}>
            <boxGeometry args={[planeLen, 0.12, len + 0.1]} />
            {ghost ? (
              <meshStandardMaterial {...GHOST_ROOF} />
            ) : seg.clear ? (
              // the zone's roof is sheeted in the same material as its walls
              <meshStandardMaterial {...CLEAR_MAT} />
            ) : (
              <meshStandardMaterial color="#cfd6dd" roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
            )}
            {ghost && <Edges color={GHOST_EDGE} />}
          </mesh>
        )
      })}
      {seg.roof === 'gable' && (
        <mesh position={[seg.ridgeX * W - W / 2, segTop(seg) + 0.1, 0]}>
          <boxGeometry args={[0.3, 0.14, len + 0.1]} />
          <meshStandardMaterial color={ghost ? '#5c7fa6' : '#aab3bc'} transparent={ghost} opacity={ghost ? 0.5 : 1} />
        </mesh>
      )}
    </group>
  )
}

// canopy in its local frame: x = 0..len along the wall, +z = outward
function Canopy({ c, ghost }: { c: CanopyDef; ghost?: boolean }) {
  const tilt = Math.atan(0.18)
  const attach = c.h + c.depth * 0.18 // wall-side edge sits higher
  const slopeLen = Math.hypot(c.depth, c.depth * 0.18) + 0.1
  const posts = Math.max(2, Math.ceil(c.len / 3))
  const mat = ghost ? (
    <meshStandardMaterial {...GHOST_MAT} />
  ) : c.material === 'clear' ? (
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
          {ghost ? (
            <meshStandardMaterial {...GHOST_MAT} />
          ) : c.material === 'canvas' ? (
            <meshStandardMaterial color={c.color} roughness={0.95} />
          ) : (
            <meshStandardMaterial color="#7c828a" metalness={0.5} roughness={0.4} />
          )}
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

  const detail = useStore((s) => s.quality !== 'low')
  const spans = useMemo(() => (design ? segmentSpans(design, L) : []), [design, L])

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
  // Clear mode ghosts the whole building; the designer preview is never ghosted
  const ghost = !force && mode === 1
  // Glass Opening items dropped on the perimeter cut real holes in the facade
  const northGlass = ghost ? [] : shellOpenings(objects, 0, off, 1e3)
  const southGlass = ghost ? [] : shellOpenings(objects, 4, off, 1e3)
  const westGlass = ghost ? [] : shellOpenings(objects, 2, off, 1e3)
  const eastGlass = ghost ? [] : shellOpenings(objects, 6, off, 1e3)
  const shift = (ops: Opening[], zc: number) => ops.map((o) => ({ ...o, c: o.c - zc }))

  return (
    // Keyed on the mode so switching Off / Clear / Solid remounts the shell.
    // Without it r3f reconciles one <meshStandardMaterial> onto the next and
    // only writes the props the new one names: the ghost's transparent /
    // opacity / depthWrite stay set on the solid cladding, and the walls come
    // back invisible. (Leaving for another page and returning remounted it,
    // which is why the building looked right after a trip to Building Design.)
    <group key={mode} position={[0, 0, off]}>
      {spans.map((seg, i) => {
        const len = seg.z1 - seg.z0
        const zc = (seg.z0 + seg.z1) / 2
        return (
          <group key={i}>
            {/* side walls: left (-X) and right (+X) have independent heights,
                split into panels around any glass openings placed on them */}
            {([-1, 1] as const).map((sx) => {
              const eh = sx < 0 ? seg.eaveL : seg.eaveR
              return wallPanels(len, eh, shift(sx < 0 ? westGlass : eastGlass, zc)).map((pn, k) => (
                <mesh
                  key={`${sx}:${k}`}
                  position={[sx * (W / 2 + t / 2), (pn.y0 + pn.y1) / 2, zc + (pn.u0 + pn.u1) / 2]}
                  castShadow={!ghost}
                >
                  <boxGeometry args={[t, pn.y1 - pn.y0, pn.u1 - pn.u0]} />
                  {ghost ? (
                    <meshStandardMaterial {...GHOST_MAT} />
                  ) : seg.clear ? (
                    <meshStandardMaterial {...CLEAR_MAT} />
                  ) : (
                    <meshStandardMaterial color={seg.color} map={surfaceMap('metalsheet', len, eh)} normalMap={detail ? surfaceNormal('metalsheet', len, eh) : undefined} roughness={0.45} metalness={0.35} side={THREE.DoubleSide} />
                  )}
                  {ghost && <Edges color={GHOST_EDGE} />}
                </mesh>
              ))
            })}
            <SegmentRoof seg={seg} W={W} ghost={ghost} />
            {/* clad the step where the next zone's roof sits at a different
                height — the hall itself stays open underneath */}
            {(() => {
              if (i >= spans.length - 1) return null
              const next = spans[i + 1]
              const step = stepShape(seg, next, W)
              if (!step) return null
              const taller = segTop(seg) >= segTop(next) ? seg : next
              return (
                <mesh position={[0, 0, seg.z1]}>
                  <shapeGeometry args={[step]} />
                  <Cladding seg={taller} ghost={ghost} />
                </mesh>
              )
            })()}
          </group>
        )
      })}
      {/* end walls follow the first/last zone cross-section */}
      {spans.length > 0 && (
        <>
          <mesh position={[0, 0, -L / 2 - t / 2]}>
            <shapeGeometry args={[endShape(spans[0], W, northGlass)]} />
            <Cladding seg={spans[0]} ghost={ghost} />
            {ghost && <Edges color={GHOST_EDGE} />}
          </mesh>
          <mesh position={[0, 0, L / 2 + t / 2]}>
            <shapeGeometry args={[endShape(spans[spans.length - 1], W, southGlass)]} />
            <Cladding seg={spans[spans.length - 1]} ghost={ghost} />
            {ghost && <Edges color={GHOST_EDGE} />}
          </mesh>
        </>
      )}
      {/* free-shape glazing / cladding panels per facade */}
      {!ghost &&
        panelShapes.map(({ p, sh }, i) => {
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
            <Canopy c={c} ghost={ghost} />
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
