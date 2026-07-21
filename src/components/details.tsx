import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { Placed } from '../types'

/**
 * Category / item specific 3D renderers.
 *
 * Dispatch order in ObjectMesh:
 *   1. category decides the broad shape (wall, mat, mezzanine, stairs, room, zone, ...)
 *   2. within 'zone' / 'room' / 'fixture' / 'furniture', the item's defId picks the
 *      interior detail set (co-working desks, toilet stalls, Hyrox equipment, ...)
 *
 * When `tint` is set (overlap/rule warning) the main structural surfaces switch to
 * the warning color; small props keep their own colors so the shape stays readable.
 */

const MAT = { roughness: 0.85, metalness: 0 }
const WHITE = '#f6f3ed'
const STEEL = '#4b5563'
const WOOD = '#c9a06c'
const DARKWOOD = '#8a6f52'

const clampN = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

// evenly spread n points across [-half, half] (centers of n equal segments)
function spread(n: number, size: number): number[] {
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n - 0.5) * size)
}

function Box({
  args,
  pos,
  color,
  rot,
  opacity,
}: {
  args: [number, number, number]
  pos: [number, number, number]
  color: string
  rot?: [number, number, number]
  opacity?: number
}) {
  return (
    <mesh position={pos} rotation={rot} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} {...MAT} transparent={opacity !== undefined} opacity={opacity} />
    </mesh>
  )
}

/* ------------------------------ people ------------------------------ */

const HOLD_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#eab308', '#ec4899', '#14b8a6']
const SKIN_COLORS = ['#f2c9a0', '#e0ac7e', '#b98058', '#8d5f3d']
const PANTS = '#374151'

export type Pose = 'stand' | 'walk' | 'sit' | 'climb' | 'push' | 'hang'

// A limb capsule pivoting from its top (the joint); rotating the group swings it.
function Limb({
  r,
  len,
  pos,
  rot,
  color,
  children,
}: {
  r: number
  len: number
  pos: [number, number, number]
  rot: [number, number, number]
  color: string
  children?: ReactNode
}) {
  return (
    <group position={pos} rotation={rot}>
      <mesh position={[0, -len / 2, 0]} castShadow>
        <capsuleGeometry args={[r, len, 3, 8]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {children}
    </group>
  )
}

// Joint rotations per pose: [arms L/R, thighs L/R, shins L/R].
// x-rotation swings forward(-)/backward(+); z-rotation swings out to the side.
const POSES: Record<Pose, { aL: number[]; aR: number[]; tL: number[]; tR: number[]; sL: number[]; sR: number[] }> = {
  stand: { aL: [0, 0, 0.16], aR: [0, 0, -0.16], tL: [0, 0, 0.05], tR: [0, 0, -0.05], sL: [0, 0, 0], sR: [0, 0, 0] },
  walk: { aL: [0.55, 0, 0.08], aR: [-0.55, 0, -0.08], tL: [-0.5, 0, 0.04], tR: [0.45, 0, -0.04], sL: [0.7, 0, 0], sR: [0.25, 0, 0] },
  sit: { aL: [-0.95, 0, 0.12], aR: [-0.95, 0, -0.12], tL: [-1.4, 0, 0.08], tR: [-1.4, 0, -0.08], sL: [1.35, 0, 0], sR: [1.35, 0, 0] },
  climb: { aL: [0, 0, 2.45], aR: [0, 0, -2.45], tL: [-0.45, 0, 0.5], tR: [-0.55, 0, -0.45], sL: [1.0, 0, 0], sR: [1.05, 0, 0] },
  push: { aL: [-1.35, 0, 0.08], aR: [-1.35, 0, -0.08], tL: [-0.35, 0, 0.05], tR: [0.3, 0, -0.05], sL: [0.5, 0, 0], sR: [0.2, 0, 0] },
  hang: { aL: [0, 0, 2.9], aR: [0, 0, -2.9], tL: [-0.3, 0, 0.08], tR: [-0.2, 0, -0.08], sL: [0.9, 0, 0], sR: [0.75, 0, 0] },
}

// Posed person with head, torso, arms and two-segment legs (~1.45 tall at scale 1).
// Static — people are attached to their item; they do not wander.
export function Figure({
  pos = [0, 0, 0] as [number, number, number],
  ry = 0,
  pose = 'stand',
  shirt = '#3b82f6',
  idx = 0,
  scale = 1,
}: {
  pos?: [number, number, number]
  ry?: number
  pose?: Pose
  shirt?: string
  idx?: number
  scale?: number
}) {
  const skin = SKIN_COLORS[idx % SKIN_COLORS.length]
  const P = POSES[pose]
  const rot3 = (a: number[]) => a as [number, number, number]
  return (
    <group position={pos} rotation-y={ry} scale={scale}>
      {/* torso + head */}
      <mesh position={[0, 0.76, 0]} castShadow>
        <capsuleGeometry args={[0.13, 0.34, 3, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
      {/* arms from the shoulders */}
      <Limb r={0.045} len={0.5} pos={[0.19, 0.92, 0]} rot={rot3(P.aL)} color={shirt} />
      <Limb r={0.045} len={0.5} pos={[-0.19, 0.92, 0]} rot={rot3(P.aR)} color={shirt} />
      {/* legs: thigh with nested shin (knee) */}
      <Limb r={0.055} len={0.24} pos={[0.08, 0.55, 0]} rot={rot3(P.tL)} color={PANTS}>
        <Limb r={0.048} len={0.24} pos={[0, -0.28, 0]} rot={rot3(P.sL)} color={PANTS} />
      </Limb>
      <Limb r={0.055} len={0.24} pos={[-0.08, 0.55, 0]} rot={rot3(P.tR)} color={PANTS}>
        <Limb r={0.048} len={0.24} pos={[0, -0.28, 0]} rot={rot3(P.sR)} color={PANTS} />
      </Limb>
    </group>
  )
}

// Static climber fixed on a wall face at a per-index height, in climbing pose.
function Climber({
  lx,
  face,
  wallH,
  idx,
}: {
  lx: number
  face: (y: number) => number // local z of the wall surface at a given height
  wallH: number
  idx: number
}) {
  const y = Math.max(0.3, wallH * (0.28 + ((idx * 0.23) % 0.45)))
  return (
    <group position={[lx, y, face(y)]}>
      <Figure ry={Math.PI} pose="climb" shirt={HOLD_COLORS[idx % HOLD_COLORS.length]} idx={idx} />
    </group>
  )
}

/* ------------------------------ climbing walls ------------------------------ */

// A cloud of climbing holds scattered over a w × len plane (local xy), sticking out in +z
function Holds({ w, len, count }: { w: number; len: number; count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const items = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * Math.max(0.1, w - 0.4),
        y: (Math.random() - 0.5) * Math.max(0.1, len - 0.4),
        s: 0.055 + Math.random() * 0.06,
        color: HOLD_COLORS[Math.floor(Math.random() * HOLD_COLORS.length)],
      })),
    [w, len, count],
  )
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      m.makeScale(it.s, it.s, it.s * 0.7)
      m.setPosition(it.x, it.y, 0)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [items])
  if (count <= 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  )
}

interface ProfilePoint {
  y: number
  off: number // forward offset from the back plane at this height
}

// One face strip built from an arbitrary height/offset polyline — each segment is
// an angled panel, so a face can go slab → vertical → overhang → roof like a real wall.
function ProfiledFace({
  w,
  profile,
  color,
  backZ,
  holdDensity = 1.6,
}: {
  w: number
  profile: ProfilePoint[]
  color: string
  backZ: number
  holdDensity?: number
}) {
  const t = 0.22
  return (
    <group>
      {profile.slice(0, -1).map((p0, i) => {
        const p1 = profile[i + 1]
        const dy = p1.y - p0.y
        const doff = p1.off - p0.off
        const len = Math.hypot(dy, doff) + 0.18 // slight overlap hides seams at joints
        const ang = Math.atan2(doff, dy)
        const holds = Math.round(clampN(w * len * holdDensity, 4, 60))
        return (
          <group
            key={i}
            position={[0, (p0.y + p1.y) / 2, backZ + t / 2 + (p0.off + p1.off) / 2]}
            rotation-x={ang}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[w, len, t]} />
              <meshStandardMaterial color={color} {...MAT} />
            </mesh>
            {len > 0.7 && (
              <group position={[0, 0, t / 2 + 0.03]}>
                <Holds w={w} len={len} count={holds} />
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}

// Wall anchored at the BACK edge of the footprint, split into sections across
// its width — each section gets a mildly different profile (slight overhang,
// vertical, slab), kept mostly upright. A steel support skeleton at least
// 60 cm deep stands between the footprint back edge and the climbing panels.
function ClimbingWall({ o, tint }: { o: Placed; tint: string | null }) {
  const color = tint ?? o.color
  const backZ = -o.d / 2
  const h = o.h
  const SKEL = 0.6 // steel skeleton depth behind the panels (min clearance)
  const wallBack = backZ + SKEL
  // gentle lean only — walls read as mostly straight-up
  const maxOff = clampN(Math.min(o.d - SKEL - 0.5, h * 0.16), 0.2, 1.2)

  const profiles: ProfilePoint[][] = useMemo(() => {
    const overhang: ProfilePoint[] = [
      { y: 0, off: 0.12 },
      { y: h * 0.35, off: 0.18 },
      { y: h, off: maxOff },
    ]
    const steep: ProfilePoint[] = [
      { y: 0, off: 0.1 },
      { y: h * 0.55, off: 0.16 },
      { y: h, off: maxOff * 0.75 },
    ]
    const vertical: ProfilePoint[] = [
      { y: 0, off: 0.12 },
      { y: h * 0.82, off: 0.16 },
      { y: h, off: Math.min(0.35, maxOff) },
    ]
    const slab: ProfilePoint[] = [
      { y: 0, off: Math.min(0.5, maxOff + 0.15) },
      { y: h * 0.6, off: 0.22 },
      { y: h, off: 0.28 },
    ]
    return [overhang, vertical, steep, slab]
  }, [h, maxOff])

  const nSec = Math.round(clampN(Math.floor(o.w / 3.5), 1, 4))
  const secW = o.w / nSec
  const nClimbers = Math.round(clampN(o.w / 6, 1, 3))
  const posts = useMemo(() => spread(Math.max(2, Math.round(o.w / 1.6)), o.w - 0.25), [o.w])

  return (
    <group>
      {/* steel skeleton: rear posts, cross beams into the panels, diagonals */}
      {posts.map((x, i) => (
        <group key={`s${i}`} position={[x, 0, 0]}>
          <Box args={[0.08, h, 0.08]} pos={[0, h / 2, backZ + 0.06]} color={STEEL} />
          <Box args={[0.07, 0.07, SKEL + 0.3]} pos={[0, h * 0.35, backZ + (SKEL + 0.3) / 2]} color={STEEL} />
          <Box args={[0.07, 0.07, SKEL + maxOff * 0.7]} pos={[0, h * 0.85, backZ + (SKEL + maxOff * 0.7) / 2]} color={STEEL} />
          <Box
            args={[0.06, Math.hypot(h * 0.5, SKEL + 0.2), 0.06]}
            pos={[0, h * 0.6, backZ + (SKEL + 0.2) / 2]}
            rot={[Math.atan2(SKEL + 0.2, h * 0.5), 0, 0]}
            color={STEEL}
          />
        </group>
      ))}
      {Array.from({ length: nSec }, (_, i) => (
        <group key={i} position={[-o.w / 2 + secW * (i + 0.5), 0, 0]}>
          <ProfiledFace w={secW - 0.04} profile={profiles[i % profiles.length]} color={color} backZ={wallBack} />
          {/* top cap board per section */}
          <Box
            args={[secW - 0.04, 0.12, 0.5]}
            pos={[0, h + 0.06, wallBack + 0.11 + profiles[i % profiles.length][profiles[i % profiles.length].length - 1].off]}
            color={tint ?? '#e6e1d6'}
          />
        </group>
      ))}
      {/* resident climbers, held clear of the panel surface */}
      {Array.from({ length: nClimbers }, (_, i) => (
        <Climber
          key={`c${i}`}
          idx={i}
          lx={-o.w / 2 + ((i + 0.7) / (nClimbers + 0.4)) * o.w}
          wallH={h}
          face={(y) => wallBack + 0.5 + maxOff * (y / h)}
        />
      ))}
    </group>
  )
}

// Freestanding island boulder, climbable from all four sides: every face leans
// outward (bottom tucked in, top flared) around a core, with holds all around.
function IslandBoulder({ o, tint }: { o: Placed; tint: string | null }) {
  const color = tint ?? o.color
  const flare = clampN(Math.min(o.w, o.d) * 0.13, 0.25, 0.6)
  const face = (width: number, half: number) => {
    const p0 = { y: 0, off: -flare } // bottom tucked toward center
    const p1 = { y: o.h * 0.55, off: -flare * 0.55 }
    const p2 = { y: o.h, off: 0 } // top at the footprint edge
    return (
      <group>
        {[p0, p1, p2].slice(0, -1).map((a, i) => {
          const b = [p0, p1, p2][i + 1]
          const dy = b.y - a.y
          const doff = b.off - a.off
          const len = Math.hypot(dy, doff) + 0.16
          const ang = Math.atan2(doff, dy)
          return (
            <group key={i} position={[0, (a.y + b.y) / 2, half - 0.11 + (a.off + b.off) / 2]} rotation-x={ang}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[width, len, 0.22]} />
                <meshStandardMaterial color={color} {...MAT} />
              </mesh>
              <group position={[0, 0, 0.14]}>
                <Holds w={width} len={len} count={Math.round(clampN(width * len * 1.6, 6, 50))} />
              </group>
            </group>
          )
        })}
      </group>
    )
  }
  return (
    <group>
      {/* core mass */}
      <Box args={[Math.max(0.4, o.w - flare * 2), o.h * 0.9, Math.max(0.4, o.d - flare * 2)]} pos={[0, o.h * 0.45, 0]} color={color} />
      {/* four outward-leaning faces */}
      <group>{face(o.w, o.d / 2)}</group>
      <group rotation-y={Math.PI}>{face(o.w, o.d / 2)}</group>
      <group rotation-y={Math.PI / 2}>{face(o.d, o.w / 2)}</group>
      <group rotation-y={-Math.PI / 2}>{face(o.d, o.w / 2)}</group>
      {/* top cap */}
      <Box args={[Math.max(0.4, o.w - flare), 0.14, Math.max(0.4, o.d - flare)]} pos={[0, o.h + 0.07, 0]} color={tint ?? '#e6e1d6'} />
      {/* climbers on opposite faces, clear of the surface */}
      <Climber idx={0} lx={-o.w / 6} wallH={o.h} face={(y) => o.d / 2 - flare * (1 - y / o.h) + 0.42} />
      <group rotation-y={Math.PI}>
        <Climber idx={1} lx={o.w / 5} wallH={o.h} face={(y) => o.d / 2 - flare * (1 - y / o.h) + 0.42} />
      </group>
    </group>
  )
}

/* --------------------------------- mats --------------------------------- */

// Standalone landing mats: thick soft slab with seam lines between sections
function Mats({ o, tint }: { o: Placed; tint: string | null }) {
  const h = clampN(o.h, 0.15, 0.6)
  const seams = useMemo(() => {
    const n = Math.max(0, Math.floor(o.w / 2) - 0)
    return spread(n, o.w).map((x) => x + o.w / (2 * n))
  }, [o.w]).filter((x) => x < o.w / 2 - 0.05)
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w, h, o.d]} />
        <meshStandardMaterial color={tint ?? o.color} {...MAT} />
        <Edges color="#ffffff" />
      </mesh>
      {seams.map((x, i) => (
        <Box key={i} args={[0.05, h + 0.012, o.d]} pos={[x, h / 2, 0]} color={tint ?? '#3f6cb0'} />
      ))}
    </group>
  )
}

/* ------------------------------- mezzanine ------------------------------- */

// Elevated platform: floating slab with a railing around the top edge.
// Support columns are intentionally NOT included — place Column items freely
// underneath to plan the real structural grid.
function Mezzanine({ o, tint }: { o: Placed; tint: string | null }) {
  const slabT = 0.25
  const railH = 1.0
  const posts = useMemo(() => {
    const res: Array<[number, number]> = []
    const nx = Math.max(2, Math.round(o.w / 1.5))
    const nz = Math.max(2, Math.round(o.d / 1.5))
    for (const x of spread(nx, o.w - 0.1)) res.push([x, -o.d / 2 + 0.05], [x, o.d / 2 - 0.05])
    for (const z of spread(nz, o.d - 0.1)) res.push([-o.w / 2 + 0.05, z], [o.w / 2 - 0.05, z])
    return res
  }, [o.w, o.d])
  const floorColor = tint ?? o.color
  return (
    <group>
      <mesh position={[0, o.h - slabT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w, slabT, o.d]} />
        <meshStandardMaterial color={floorColor} {...MAT} />
        <Edges color="#b09468" />
      </mesh>
      {posts.map(([x, z], i) => (
        <Box key={`p${i}`} args={[0.05, railH, 0.05]} pos={[x, o.h + railH / 2, z]} color={STEEL} />
      ))}
      {/* top rails */}
      <Box args={[o.w, 0.06, 0.06]} pos={[0, o.h + railH, -o.d / 2 + 0.05]} color={STEEL} />
      <Box args={[o.w, 0.06, 0.06]} pos={[0, o.h + railH, o.d / 2 - 0.05]} color={STEEL} />
      <Box args={[0.06, 0.06, o.d]} pos={[-o.w / 2 + 0.05, o.h + railH, 0]} color={STEEL} />
      <Box args={[0.06, 0.06, o.d]} pos={[o.w / 2 - 0.05, o.h + railH, 0]} color={STEEL} />
    </group>
  )
}

/* -------------------------------- stairs -------------------------------- */

// Open staircase rising from the front edge (+z) to h at the back edge (-z):
// floating treads carried by two sloped stringer boards — nothing solid below,
// so the space underneath stays usable.
function Stairs({ o, tint }: { o: Placed; tint: string | null }) {
  const n = Math.round(clampN(o.h / 0.19, 4, 24))
  const sh = o.h / n
  const sd = o.d / n
  const color = tint ?? o.color
  const slope = Math.atan2(o.h, o.d)
  const run = Math.hypot(o.d, o.h)
  return (
    <group>
      {/* treads */}
      {Array.from({ length: n }, (_, i) => (
        <Box
          key={i}
          args={[o.w - 0.14, 0.07, sd * 1.15]}
          pos={[0, sh * (i + 1) - 0.035, o.d / 2 - sd * (i + 0.5)]}
          color={color}
        />
      ))}
      {/* sloped side stringers */}
      <Box args={[0.07, 0.32, run]} pos={[-o.w / 2 + 0.04, o.h / 2 - 0.12, 0]} rot={[slope, 0, 0]} color={tint ?? '#8f867a'} />
      <Box args={[0.07, 0.32, run]} pos={[o.w / 2 - 0.04, o.h / 2 - 0.12, 0]} rot={[slope, 0, 0]} color={tint ?? '#8f867a'} />
      {/* handrails */}
      <Box args={[0.05, 0.05, run]} pos={[-o.w / 2 + 0.05, o.h / 2 + 0.95, 0]} rot={[slope, 0, 0]} color={STEEL} />
      <Box args={[0.05, 0.05, run]} pos={[o.w / 2 - 0.05, o.h / 2 + 0.95, 0]} rot={[slope, 0, 0]} color={STEEL} />
    </group>
  )
}

// Structural column: shaft with a base plate and a cap plate
function Column({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <Box args={[o.w + 0.12, 0.06, o.d + 0.12]} pos={[0, 0.03, 0]} color={tint ?? '#7d8590'} />
      <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
      <Box args={[o.w + 0.16, 0.1, o.d + 0.16]} pos={[0, o.h - 0.05, 0]} color={tint ?? '#7d8590'} />
    </group>
  )
}

/* ----------------------------- shared furniture ----------------------------- */

function TableMesh({
  w = 1.4,
  d = 0.8,
  h = 0.74,
  color = WOOD,
  pos = [0, 0, 0] as [number, number, number],
}: {
  w?: number
  d?: number
  h?: number
  color?: string
  pos?: [number, number, number]
}) {
  const lx = w / 2 - 0.08
  const lz = d / 2 - 0.08
  return (
    <group position={pos}>
      <Box args={[w, 0.06, d]} pos={[0, h, 0]} color={color} />
      {[
        [-lx, -lz],
        [lx, -lz],
        [-lx, lz],
        [lx, lz],
      ].map(([x, z], i) => (
        <Box key={i} args={[0.06, h, 0.06]} pos={[x, h / 2, z]} color={DARKWOOD} />
      ))}
    </group>
  )
}

function ChairMesh({ pos, facing = 0, color = '#5f6b7a' }: { pos: [number, number, number]; facing?: number; color?: string }) {
  return (
    <group position={pos} rotation-y={facing}>
      <Box args={[0.42, 0.06, 0.42]} pos={[0, 0.45, 0]} color={color} />
      <Box args={[0.42, 0.5, 0.06]} pos={[0, 0.73, -0.19]} color={color} />
      <Box args={[0.07, 0.45, 0.07]} pos={[0, 0.22, 0]} color={STEEL} />
    </group>
  )
}

function StoolMesh({ o, tint }: { o: Placed; tint: string | null }) {
  const r = Math.min(o.w, o.d) / 2
  return (
    <group>
      <mesh position={[0, o.h, 0]} castShadow>
        <cylinderGeometry args={[r * 0.8, r * 0.8, 0.06, 16]} />
        <meshStandardMaterial color={tint ?? o.color} {...MAT} />
      </mesh>
      <mesh position={[0, o.h / 2, 0]}>
        <cylinderGeometry args={[0.05, r * 0.5, o.h, 10]} />
        <meshStandardMaterial color={STEEL} {...MAT} />
      </mesh>
    </group>
  )
}

/* -------------------------------- zones -------------------------------- */

function ZonePatch({ o, tint, opacity = 0.85 }: { o: Placed; tint: string | null; opacity?: number }) {
  return (
    <mesh position={[0, 0.04, 0]} receiveShadow>
      <boxGeometry args={[o.w, 0.08, o.d]} />
      <meshStandardMaterial color={tint ?? o.color} {...MAT} transparent opacity={opacity} />
    </mesh>
  )
}

// Co-working: desks with two chairs each, laid out on a grid sized to the footprint
function CoworkZone({ o, tint }: { o: Placed; tint: string | null }) {
  const cols = Math.round(clampN(Math.floor(o.w / 2.6), 1, 3))
  const rows = Math.round(clampN(Math.floor(o.d / 2.6), 1, 2))
  const xs = spread(cols, o.w - 1)
  const zs = spread(rows, o.d - 1)
  return (
    <group>
      <ZonePatch o={o} tint={tint} />
      {xs.flatMap((x, i) =>
        zs.map((z, j) => (
          <group key={`${i}-${j}`} position={[x, 0.08, z]}>
            <TableMesh />
            <ChairMesh pos={[0, 0, 0.75]} facing={Math.PI} />
            <ChairMesh pos={[0, 0, -0.75]} />
            {/* people working at the desks */}
            <Figure pose="sit" pos={[0, 0, 0.72]} ry={Math.PI} shirt={HOLD_COLORS[(i * 3 + j) % HOLD_COLORS.length]} idx={i + j} />
            {(i + j) % 2 === 0 && (
              <Figure pose="sit" pos={[0, 0, -0.72]} shirt={HOLD_COLORS[(i * 3 + j + 4) % HOLD_COLORS.length]} idx={i + j + 1} />
            )}
          </group>
        )),
      )}
    </group>
  )
}

// Training: pull-up rig, bench and a dumbbell rack
function TrainingZone({ o, tint }: { o: Placed; tint: string | null }) {
  const rigW = Math.min(o.w - 1, 4)
  return (
    <group>
      <ZonePatch o={o} tint={tint} />
      {/* pull-up rig along the back */}
      <group position={[0, 0, -o.d / 2 + 0.8]}>
        {[-rigW / 2, 0, rigW / 2].map((x, i) => (
          <Box key={i} args={[0.1, 2.6, 0.1]} pos={[x, 1.3, 0]} color={STEEL} />
        ))}
        {[-rigW / 2, 0, rigW / 2].map((x, i) => (
          <Box key={`b${i}`} args={[0.1, 2.6, 0.1]} pos={[x, 1.3, 0.9]} color={STEEL} />
        ))}
        <Box args={[rigW + 0.1, 0.07, 0.07]} pos={[0, 2.6, 0]} color={tint ?? '#f59e0b'} />
        <Box args={[rigW + 0.1, 0.07, 0.07]} pos={[0, 2.6, 0.9]} color={tint ?? '#f59e0b'} />
      </group>
      {/* bench */}
      <group position={[Math.min(o.w / 4, 2), 0.08, o.d / 8]}>
        <Box args={[0.4, 0.12, 1.3]} pos={[0, 0.45, 0]} color="#374151" />
        <Box args={[0.3, 0.42, 0.12]} pos={[0, 0.21, -0.5]} color={STEEL} />
        <Box args={[0.3, 0.42, 0.12]} pos={[0, 0.21, 0.5]} color={STEEL} />
      </group>
      {/* dumbbell rack */}
      <group position={[-Math.min(o.w / 4, 2), 0.08, o.d / 4]}>
        <Box args={[1.6, 0.5, 0.5]} pos={[0, 0.25, 0]} color={STEEL} />
        {[-0.55, -0.15, 0.25, 0.65].map((x, i) => (
          <Box key={i} args={[0.28, 0.14, 0.14]} pos={[x, 0.58, 0]} color={HOLD_COLORS[i % HOLD_COLORS.length]} />
        ))}
      </group>
      {/* athlete hanging from the rig bar */}
      <Figure pose="hang" pos={[Math.min(o.w / 5, 1.2), 1.15, -o.d / 2 + 0.8]} ry={Math.PI} shirt="#22c55e" idx={2} />
    </group>
  )
}

// A competition sled with push bars, sitting at a lane start
function Sled({ pos, color = '#1f2937' }: { pos: [number, number, number]; color?: string }) {
  return (
    <group position={pos}>
      <Box args={[0.9, 0.22, 0.65]} pos={[0, 0.12, 0]} color={color} />
      <Box args={[0.5, 0.35, 0.45]} pos={[0, 0.4, 0]} color="#111827" />
      <Box args={[0.07, 1.0, 0.07]} pos={[-0.35, 0.6, 0.25]} color={STEEL} />
      <Box args={[0.07, 1.0, 0.07]} pos={[0.35, 0.6, 0.25]} color={STEEL} />
      <Box args={[0.07, 1.0, 0.07]} pos={[-0.35, 0.6, -0.25]} color={STEEL} />
      <Box args={[0.07, 1.0, 0.07]} pos={[0.35, 0.6, -0.25]} color={STEEL} />
    </group>
  )
}

// SkiErg: tall frame with a flywheel head and hanging cords
function SkiErg({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <Box args={[0.55, 0.08, 0.7]} pos={[0, 0.04, 0]} color={STEEL} />
      <Box args={[0.13, 2.15, 0.13]} pos={[0, 1.12, 0]} color={STEEL} />
      <Box args={[0.5, 0.55, 0.28]} pos={[0, 1.95, 0.1]} color="#111827" />
      <Box args={[0.04, 0.6, 0.04]} pos={[-0.15, 1.4, 0.2]} color="#6b7280" />
      <Box args={[0.04, 0.6, 0.04]} pos={[0.15, 1.4, 0.2]} color="#6b7280" />
    </group>
  )
}

// Concept-style rower
function Rower({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  return (
    <group position={pos} rotation-y={ry}>
      <Box args={[2.1, 0.14, 0.4]} pos={[0, 0.32, 0]} color="#1f2937" />
      <Box args={[0.38, 0.55, 0.45]} pos={[-0.95, 0.35, 0]} color={STEEL} />
      <Box args={[0.35, 0.06, 0.3]} pos={[0.35, 0.42, 0]} color="#374151" />
      <Box args={[0.1, 0.3, 0.1]} pos={[1.0, 0.15, 0]} color={STEEL} />
    </group>
  )
}

// Kettlebell: ball + handle
function Kettlebell({ pos, color = '#374151' }: { pos: [number, number, number]; color?: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <sphereGeometry args={[0.15, 10, 8]} />
        <meshStandardMaterial color={color} {...MAT} />
      </mesh>
      <Box args={[0.2, 0.06, 0.06]} pos={[0, 0.36, 0]} color={color} />
    </group>
  )
}

/**
 * Hyrox training zone modeled on the real race stations: marked sled-push /
 * sled-pull / burpee-broad-jump lanes with lane lines, plus a stations row —
 * SkiErgs, rowers, sleds, wall-ball target with balls, kettlebells (farmers
 * carry) and sandbags (lunges). Equipment count scales with the footprint.
 */
function HyroxZone({ o, tint }: { o: Placed; tint: string | null }) {
  const laneLen = Math.max(4, Math.min(o.w - 2, o.w * 0.8))
  const laneW = 1.6
  const nLanes = Math.max(1, Math.min(3, Math.floor((o.d - 4) / laneW)))
  const laneZ = (i: number) => o.d / 2 - 1.0 - laneW * (i + 0.5)
  const backZ = -o.d / 2
  const big = o.w >= 10

  return (
    <group>
      <ZonePatch o={o} tint={tint} />
      {/* ---- marked lanes (sled push / sled pull / burpee broad jumps) ---- */}
      {Array.from({ length: nLanes }, (_, i) => (
        <group key={`lane${i}`} position={[0, 0, laneZ(i)]}>
          <Box args={[laneLen, 0.015, laneW - 0.14]} pos={[0, 0.095, 0]} color={tint ?? '#3f4652'} />
          <Box args={[laneLen, 0.02, 0.07]} pos={[0, 0.1, laneW / 2 - 0.05]} color="#f3f4f6" />
          <Box args={[laneLen, 0.02, 0.07]} pos={[0, 0.1, -laneW / 2 + 0.05]} color="#f3f4f6" />
          {/* start / finish marks */}
          <Box args={[0.1, 0.022, laneW - 0.14]} pos={[-laneLen / 2 + 0.1, 0.1, 0]} color="#facc15" />
          <Box args={[0.1, 0.022, laneW - 0.14]} pos={[laneLen / 2 - 0.1, 0.1, 0]} color="#facc15" />
        </group>
      ))}
      {/* sleds at the start of the first two lanes */}
      {nLanes >= 1 && <Sled pos={[-laneLen / 2 + 0.8, 0.1, laneZ(0)]} color={tint ?? '#1f2937'} />}
      {nLanes >= 2 && <Sled pos={[-laneLen / 2 + 0.8, 0.1, laneZ(1)]} color={tint ?? '#7f1d1d'} />}
      {/* athlete pushing the first sled */}
      {nLanes >= 1 && (
        <group position={[-laneLen / 2 + 1.7, 0.1, laneZ(0)]} rotation-y={-Math.PI / 2}>
          <group rotation-x={0.35}>
            <Figure pose="push" shirt="#f97316" idx={1} />
          </group>
        </group>
      )}

      {/* ---- stations row along the back edge ---- */}
      <SkiErg pos={[-o.w / 2 + 1.2, 0.08, backZ + 1.0]} />
      {big && <SkiErg pos={[-o.w / 2 + 2.4, 0.08, backZ + 1.0]} />}
      {/* skierg athlete, arms driving down */}
      <group position={[-o.w / 2 + 1.2, 0.08, backZ + 1.8]} rotation-y={Math.PI}>
        <group rotation-x={-0.2}>
          <Figure pose="push" shirt="#22c55e" idx={4} />
        </group>
      </group>
      {/* rowers + seated athlete */}
      <Rower pos={[-o.w / 2 + 4.6, 0.08, backZ + 1.0]} />
      {big && <Rower pos={[-o.w / 2 + 4.6, 0.08, backZ + 1.9]} />}
      <Figure pose="sit" pos={[-o.w / 2 + 4.3, 0.28, backZ + 1.0]} ry={-Math.PI / 2} shirt="#3b82f6" idx={3} />
      {/* wall-ball target + balls */}
      <group position={[Math.min(o.w / 2 - 1.2, o.w / 4), 0, backZ + 0.6]}>
        <Box args={[0.14, 3.0, 0.14]} pos={[0, 1.5, 0]} color={STEEL} />
        <mesh position={[0, 2.9, 0.12]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.08, 14]} />
          <meshStandardMaterial color="#facc15" {...MAT} />
        </mesh>
        {[0, 0.55, 1.1].map((x, i) => (
          <mesh key={i} position={[x - 0.5, 0.26, 0.7]} castShadow>
            <sphereGeometry args={[0.24, 12, 10]} />
            <meshStandardMaterial color={HOLD_COLORS[(i + 2) % HOLD_COLORS.length]} {...MAT} />
          </mesh>
        ))}
      </group>
      {/* farmers-carry kettlebells */}
      {[0, 0.5, 1.0, 1.5].map((x, i) => (
        <Kettlebell key={i} pos={[o.w / 2 - 2.4 + x, 0.08, backZ + 1.6]} color={i % 2 ? '#374151' : '#7c2d12'} />
      ))}
      {/* sandbags for lunges */}
      <Box args={[0.75, 0.26, 0.32]} pos={[o.w / 2 - 1.6, 0.22, backZ + 2.4]} rot={[0, 0.4, 0]} color="#4d3f33" />
      {big && <Box args={[0.75, 0.26, 0.32]} pos={[o.w / 2 - 2.5, 0.22, backZ + 2.5]} rot={[0, -0.3, 0]} color="#3f3429" />}
    </group>
  )
}

/* --------------------------------- rooms --------------------------------- */

// Open-top thin-wall shell (dollhouse cutaway), shared by all room types
function RoomShell({ o, tint, wallColor = WHITE, floorColor }: { o: Placed; tint: string | null; wallColor?: string; floorColor?: string }) {
  const t = 0.12
  const wc = tint ?? wallColor
  return (
    <group>
      <Box args={[o.w, 0.06, o.d]} pos={[0, 0.03, 0]} color={tint ?? floorColor ?? o.color} />
      <Box args={[o.w, o.h, t]} pos={[0, o.h / 2, -o.d / 2 + t / 2]} color={wc} />
      <Box args={[o.w, o.h, t]} pos={[0, o.h / 2, o.d / 2 - t / 2]} color={wc} />
      <Box args={[t, o.h, Math.max(0.05, o.d - t * 2)]} pos={[-o.w / 2 + t / 2, o.h / 2, 0]} color={wc} />
      <Box args={[t, o.h, Math.max(0.05, o.d - t * 2)]} pos={[o.w / 2 - t / 2, o.h / 2, 0]} color={wc} />
    </group>
  )
}

// Restroom: stalls with toilets along the back wall + sink counter at the front
function Restroom({ o, tint }: { o: Placed; tint: string | null }) {
  const stalls = Math.round(clampN(Math.floor((o.w - 1.2) / 1.1), 1, 4))
  const xs = spread(stalls, o.w - 1.4)
  return (
    <group>
      <RoomShell o={o} tint={tint} floorColor="#dbeafe" />
      {xs.map((x, i) => (
        <group key={i} position={[x, 0, -o.d / 2 + 0.75]}>
          {/* stall partition + toilet */}
          <Box args={[0.05, 1.5, 1.2]} pos={[-0.52, 0.78, 0]} color="#cbd5e1" />
          {i === xs.length - 1 && <Box args={[0.05, 1.5, 1.2]} pos={[0.52, 0.78, 0]} color="#cbd5e1" />}
          <Box args={[0.4, 0.42, 0.6]} pos={[0, 0.24, -0.1]} color="#ffffff" />
          <Box args={[0.4, 0.7, 0.14]} pos={[0, 0.55, -0.42]} color="#ffffff" />
        </group>
      ))}
      {/* sink counter */}
      <group position={[o.w / 4, 0, o.d / 2 - 0.5]}>
        <Box args={[Math.min(1.6, o.w / 2), 0.85, 0.5]} pos={[0, 0.43, 0]} color="#e2e8f0" />
        <Box args={[0.4, 0.08, 0.32]} pos={[-0.35, 0.9, 0]} color="#ffffff" />
        <Box args={[0.4, 0.08, 0.32]} pos={[0.35, 0.9, 0]} color="#ffffff" />
      </group>
    </group>
  )
}

// Sauna: wood shell, two-tier benches, stove with stones
function Sauna({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <RoomShell o={o} tint={tint} wallColor={tint ?? '#d9b98c'} floorColor="#c9a06c" />
      <Box args={[o.w - 0.4, 0.1, 0.6]} pos={[0, 0.45, -o.d / 2 + 0.5]} color={WOOD} />
      <Box args={[o.w - 0.4, 0.1, 0.55]} pos={[0, 0.85, -o.d / 2 + 0.35]} color={WOOD} />
      <group position={[o.w / 2 - 0.55, 0, o.d / 2 - 0.55]}>
        <Box args={[0.45, 0.6, 0.45]} pos={[0, 0.3, 0]} color="#374151" />
        {[
          [-0.08, 0.07],
          [0.1, -0.05],
          [0, 0.0],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.68, z]} castShadow>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshStandardMaterial color="#6b7280" {...MAT} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// Storage: shell + shelf racks with boxes
function StorageRoom({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <RoomShell o={o} tint={tint} floorColor="#d6d0c4" />
      <group position={[0, 0, -o.d / 2 + 0.45]}>
        <Box args={[o.w - 0.6, 0.05, 0.6]} pos={[0, 0.6, 0]} color={DARKWOOD} />
        <Box args={[o.w - 0.6, 0.05, 0.6]} pos={[0, 1.3, 0]} color={DARKWOOD} />
        {spread(Math.max(2, Math.floor(o.w / 1)), o.w - 1).map((x, i) => (
          <Box key={i} args={[0.5, 0.4, 0.45]} pos={[x, i % 2 ? 0.85 : 1.55, 0]} color={i % 3 ? '#b8a88a' : '#9c8666'} />
        ))}
      </group>
    </group>
  )
}

/* ------------------------------- fixtures ------------------------------- */

// Shoe rack: shelving with pairs of shoes
function ShoeRack({ o, tint }: { o: Placed; tint: string | null }) {
  const shelves = [0.35, 0.8, 1.25].filter((y) => y < o.h)
  const perShelf = Math.round(clampN(Math.floor(o.w / 0.45), 2, 6))
  return (
    <group>
      <Box args={[0.06, o.h, o.d]} pos={[-o.w / 2 + 0.03, o.h / 2, 0]} color={tint ?? o.color} />
      <Box args={[0.06, o.h, o.d]} pos={[o.w / 2 - 0.03, o.h / 2, 0]} color={tint ?? o.color} />
      {shelves.map((y, i) => (
        <Box key={i} args={[o.w - 0.1, 0.05, o.d - 0.1]} pos={[0, y, 0]} color={tint ?? o.color} />
      ))}
      {shelves.flatMap((y, si) =>
        spread(perShelf, o.w - 0.4).map((x, i) => (
          <Box
            key={`${si}-${i}`}
            args={[0.26, 0.11, 0.3]}
            pos={[x, y + 0.09, ((i % 2) - 0.5) * 0.2]}
            color={HOLD_COLORS[(si * perShelf + i) % HOLD_COLORS.length]}
          />
        )),
      )}
    </group>
  )
}

// Ice bath: tub with water surface
function IceBath({ o, tint }: { o: Placed; tint: string | null }) {
  const t = 0.12
  const wc = tint ?? '#e2e8f0'
  return (
    <group>
      <Box args={[o.w, o.h, t]} pos={[0, o.h / 2, -o.d / 2 + t / 2]} color={wc} />
      <Box args={[o.w, o.h, t]} pos={[0, o.h / 2, o.d / 2 - t / 2]} color={wc} />
      <Box args={[t, o.h, o.d - t * 2]} pos={[-o.w / 2 + t / 2, o.h / 2, 0]} color={wc} />
      <Box args={[t, o.h, o.d - t * 2]} pos={[o.w / 2 - t / 2, o.h / 2, 0]} color={wc} />
      <mesh position={[0, o.h * 0.75, 0]}>
        <boxGeometry args={[o.w - t * 2, 0.04, o.d - t * 2]} />
        <meshStandardMaterial color={tint ?? '#7dd3fc'} transparent opacity={0.85} roughness={0.2} />
      </mesh>
      {/* step */}
      <Box args={[0.6, o.h * 0.45, 0.35]} pos={[0, o.h * 0.22, o.d / 2 + 0.18]} color="#cbd5e1" />
      {/* someone soaking, chest-deep */}
      <Figure pose="sit" pos={[0, o.h - 0.95, 0]} shirt="#0ea5e9" idx={2} />
    </group>
  )
}

// Reception: counter base, worktop and a monitor
function Reception({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <Box args={[o.w, o.h - 0.08, o.d]} pos={[0, (o.h - 0.08) / 2, 0]} color={tint ?? o.color} />
      <Box args={[o.w + 0.16, 0.08, o.d + 0.16]} pos={[0, o.h - 0.04, 0]} color={tint ?? '#8a5f38'} />
      <Box args={[0.42, 0.28, 0.05]} pos={[-o.w / 5, o.h + 0.14, 0]} color="#1f2937" />
      <Box args={[0.06, 0.12, 0.06]} pos={[-o.w / 5, o.h + 0.02, 0]} color="#1f2937" />
    </group>
  )
}

/* --------------------------- doors / parking --------------------------- */

function hatchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = 5
  for (let i = -64; i < 128; i += 16) {
    g.beginPath()
    g.moveTo(i, 64)
    g.lineTo(i + 64, 0)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function Parking({ o, tint }: { o: Placed; tint: string | null }) {
  const hatch = useMemo(() => {
    const t = hatchTexture()
    t.repeat.set(o.w / 1.5, o.d / 1.5)
    return t
  }, [o.w, o.d])
  return (
    <group>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[o.w, 0.06, o.d]} />
        <meshStandardMaterial color={tint ?? o.color} {...MAT} />
      </mesh>
      <mesh position={[0, 0.065, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[o.w, o.d]} />
        <meshBasicMaterial map={hatch} transparent />
      </mesh>
      <mesh position={[0, 0.035, 0]}>
        <boxGeometry args={[o.w, 0.061, o.d]} />
        <meshBasicMaterial visible={false} />
        <Edges color="#ffffff" />
      </mesh>
    </group>
  )
}

function Door({ o, tint }: { o: Placed; tint: string | null }) {
  // Interior room door (rule 'floor'): a real frame with the leaf slightly ajar.
  // Place it in a partition or a room wall for toilets / storage.
  if (o.rule === 'floor') {
    const t = Math.max(0.1, o.d)
    const leafW = Math.max(0.2, o.w - 0.12)
    return (
      <group>
        <Box args={[0.07, o.h, t]} pos={[-o.w / 2 + 0.035, o.h / 2, 0]} color={tint ?? '#8a8378'} />
        <Box args={[0.07, o.h, t]} pos={[o.w / 2 - 0.035, o.h / 2, 0]} color={tint ?? '#8a8378'} />
        <Box args={[o.w, 0.08, t]} pos={[0, o.h - 0.04, 0]} color={tint ?? '#8a8378'} />
        {/* leaf hinged on the left, swung open ~30° */}
        <group position={[-o.w / 2 + 0.06, 0, 0]} rotation-y={-0.55}>
          <Box args={[leafW, o.h - 0.1, 0.05]} pos={[leafW / 2, (o.h - 0.1) / 2, 0]} color={tint ?? o.color} />
          <mesh position={[leafW - 0.1, o.h / 2, 0.06]} castShadow>
            <sphereGeometry args={[0.035, 8, 6]} />
            <meshStandardMaterial color="#d4d4d8" roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      </group>
    )
  }
  // Perimeter door: colored marker embedded in the shell wall
  return (
    <mesh position={[0, o.h / 2, 0]} castShadow>
      <boxGeometry args={[o.w, o.h, Math.max(0.28, o.d)]} />
      <meshStandardMaterial color={tint ?? o.color} {...MAT} />
      <Edges color="#ffffff" />
    </mesh>
  )
}

/* ------------------------------- dispatcher ------------------------------- */

export function ObjectMesh({ o, tint }: { o: Placed; tint: string | null }) {
  switch (o.category) {
    case 'wall_low':
    case 'wall_high':
      return <ClimbingWall o={o} tint={tint} />
    case 'wall_island':
      return <IslandBoulder o={o} tint={tint} />
    case 'mat':
      return <Mats o={o} tint={tint} />
    case 'mezzanine':
      return <Mezzanine o={o} tint={tint} />
    case 'stairs':
      return <Stairs o={o} tint={tint} />
    case 'column':
      return <Column o={o} tint={tint} />
    case 'partition':
      // interior partition wall: a plain slab, resizable/rotatable like the rest
      return (
        <mesh position={[0, o.h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[o.w, o.h, Math.max(0.08, o.d)]} />
          <meshStandardMaterial color={tint ?? o.color} {...MAT} />
          <Edges color="#c9c2b4" />
        </mesh>
      )
    case 'person':
      // placeable person; height H scales the figure, color = shirt
      return (
        <group scale={o.h / 1.45}>
          <Figure pose="walk" shirt={tint ?? o.color} idx={o.id.length} />
        </group>
      )
    case 'zone':
      if (o.defId === 'cowork') return <CoworkZone o={o} tint={tint} />
      if (o.defId === 'training') return <TrainingZone o={o} tint={tint} />
      if (o.defId === 'hyrox') return <HyroxZone o={o} tint={tint} />
      return <ZonePatch o={o} tint={tint} />
    case 'room':
      if (o.defId === 'toilet') return <Restroom o={o} tint={tint} />
      if (o.defId === 'sauna') return <Sauna o={o} tint={tint} />
      return <StorageRoom o={o} tint={tint} />
    case 'reception':
      return <Reception o={o} tint={tint} />
    case 'fixture':
      if (o.defId === 'shoes') return <ShoeRack o={o} tint={tint} />
      if (o.defId === 'icebath') return <IceBath o={o} tint={tint} />
      return (
        <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
      )
    case 'furniture':
      if (o.defId === 'stool') return <StoolMesh o={o} tint={tint} />
      return (
        <group>
          <TableMesh w={o.w} d={o.d} h={o.h} color={tint ?? o.color} />
        </group>
      )
    case 'door':
      return <Door o={o} tint={tint} />
    case 'parking':
      return <Parking o={o} tint={tint} />
    default:
      return <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
  }
}
