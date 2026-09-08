import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { Edges, MeshReflectorMaterial } from '@react-three/drei'
import type { Placed } from '../types'
import { useWallStore } from '../wall/wallStore'
import { WallModel } from '../wall/WallModel'
import { designDepth, designWidth } from '../wall/profile'
import { ROUTE_COLORS, SURFACE_TINTED, surfaceMap } from '../materials'
import { wallOpenings } from '../placement'
import type { Opening } from '../placement'
import { useStore } from '../store'

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
const HAIR_COLORS = ['#2c2320', '#171717', '#4a382a', '#5b4632', '#3a3a3e']
const PANTS_COLORS = ['#374151', '#23272e', '#4a5568', '#5b5348', '#2f3a4a']

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
  const cShirt = shirt
  const cSkin = SKIN_COLORS[idx % SKIN_COLORS.length]
  const cPants = PANTS_COLORS[(idx * 5 + 2) % PANTS_COLORS.length]
  const cHair = HAIR_COLORS[(idx * 3 + 1) % HAIR_COLORS.length]
  const cShoe = idx % 3 === 0 ? '#2b2f35' : idx % 3 === 1 ? '#e8e6e1' : '#7a4a35'
  const P = POSES[pose]
  const rot3 = (a: number[]) => a as [number, number, number]
  const hand = (
    <mesh position={[0, -0.5, 0]} castShadow>
      <sphereGeometry args={[0.042, 8, 6]} />
      <meshStandardMaterial color={cSkin} roughness={0.7} />
    </mesh>
  )
  return (
    <group position={pos} rotation-y={ry} scale={scale}>
      {/* shirt torso (broader shoulders, flatter chest) over pants hips */}
      <mesh position={[0, 0.8, 0]} scale={[1.12, 1, 0.76]} castShadow>
        <capsuleGeometry args={[0.125, 0.28, 4, 10]} />
        <meshStandardMaterial color={cShirt} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.58, 0]} scale={[1.02, 1, 0.82]} castShadow>
        <capsuleGeometry args={[0.108, 0.1, 3, 10]} />
        <meshStandardMaterial color={cPants} roughness={0.85} />
      </mesh>
      {/* neck and a slightly oval head with a hair cap */}
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.042, 0.05, 0.09, 8]} />
        <meshStandardMaterial color={cSkin} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.17, 0]} scale={[0.94, 1.08, 0.96]} castShadow>
        <sphereGeometry args={[0.103, 14, 12]} />
        <meshStandardMaterial color={cSkin} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.2, -0.018]} scale={[1.05, 0.85, 1.05]} castShadow>
        <sphereGeometry args={[0.106, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color={cHair} roughness={0.95} />
      </mesh>
      {/* arms from the shoulders, with hands */}
      <Limb r={0.037} len={0.48} pos={[0.18, 0.94, 0]} rot={rot3(P.aL)} color={cShirt}>
        {hand}
      </Limb>
      <Limb r={0.037} len={0.48} pos={[-0.18, 0.94, 0]} rot={rot3(P.aR)} color={cShirt}>
        {hand}
      </Limb>
      {/* legs: thigh with nested shin (knee), shoes at the ankles */}
      <Limb r={0.051} len={0.24} pos={[0.08, 0.55, 0]} rot={rot3(P.tL)} color={cPants}>
        <Limb r={0.041} len={0.24} pos={[0, -0.28, 0]} rot={rot3(P.sL)} color={cPants}>
          <Box args={[0.08, 0.055, 0.19]} pos={[0, -0.29, 0.045]} color={cShoe} />
        </Limb>
      </Limb>
      <Limb r={0.051} len={0.24} pos={[-0.08, 0.55, 0]} rot={rot3(P.tR)} color={cPants}>
        <Limb r={0.041} len={0.24} pos={[0, -0.28, 0]} rot={rot3(P.sR)} color={cPants}>
          <Box args={[0.08, 0.055, 0.19]} pos={[0, -0.29, 0.045]} color={cShoe} />
        </Limb>
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

/**
 * Route-set holds over a w × len wall plane (local xy, +z out of the wall) —
 * the way real gyms set: each ROUTE is a wandering bottom-to-top line of
 * holds sharing ONE color, spaced roughly every 1.1 m across the wall, and
 * hold sizes mix like a real set: mostly small crimps and foot chips, some
 * mid-size holds, the occasional big jug. Plus a couple of plywood-style
 * screw-on volumes on larger faces. Deterministic per seed.
 */
export function Holds({ w, len, count, seed = 1 }: { w: number; len: number; count?: number; seed?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const { items, volumes } = useMemo(() => {
    let s = ((seed + 1) * 2654435761) >>> 0 || 7
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
    const uw = Math.max(0.3, w - 0.3)
    const ul = Math.max(0.3, len - 0.2)
    const nRoutes = Math.max(1, Math.min(10, Math.round(uw / 1.1)))
    const list: Array<{ x: number; y: number; sx: number; sy: number; sz: number; rz: number; c: string }> = []
    const colStart = Math.floor(rnd() * ROUTE_COLORS.length)
    for (let r = 0; r < nRoutes; r++) {
      const c = ROUTE_COLORS[(colStart + r) % ROUTE_COLORS.length]
      let x = -uw / 2 + ((r + 0.5) / nRoutes) * uw + (rnd() - 0.5) * 0.3
      let y = -ul / 2 + 0.05 + rnd() * 0.2
      while (y < ul / 2) {
        const roll = rnd()
        // 50% crimps/foot chips, 35% mid-size, 15% jugs
        const base = roll < 0.5 ? 0.032 + rnd() * 0.028 : roll < 0.85 ? 0.065 + rnd() * 0.04 : 0.11 + rnd() * 0.055
        list.push({
          x,
          y,
          sx: base * (1.1 + rnd() * 0.9), // wider than tall, like real shapes
          sy: base * (0.7 + rnd() * 0.5),
          sz: base * (0.5 + rnd() * 0.35), // low profile off the wall
          rz: rnd() * Math.PI * 2,
          c,
        })
        y += 0.3 + rnd() * 0.35
        x = Math.max(-uw / 2, Math.min(uw / 2, x + (rnd() - 0.5) * 0.55))
        if (count && list.length >= count * 4) break
      }
    }
    // large volumes on big faces (matte black / plywood, like fiberglass macros)
    const vols: Array<{ x: number; y: number; r: number; h: number; ry: number; c: string }> = []
    const nVol = uw > 2 && ul > 2 ? 1 + Math.floor(rnd() * 2) : 0
    for (let i = 0; i < nVol; i++) {
      vols.push({
        x: (rnd() - 0.5) * (uw - 0.9),
        y: (rnd() - 0.5) * (ul - 1.1),
        r: 0.32 + rnd() * 0.26,
        h: 0.16 + rnd() * 0.14,
        ry: rnd() * Math.PI,
        c: rnd() < 0.5 ? '#23262c' : rnd() < 0.5 ? '#cfc4ae' : '#3a6ea5',
      })
    }
    return { items: list, volumes: vols }
  }, [w, len, seed, count])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const M = new THREE.Matrix4()
    const P = new THREE.Vector3()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3()
    const E = new THREE.Euler()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      P.set(it.x, it.y, 0)
      E.set(0, 0, it.rz)
      Q.setFromEuler(E)
      S.set(it.sx, it.sy, it.sz)
      M.compose(P, Q, S)
      mesh.setMatrixAt(i, M)
      mesh.setColorAt(i, c.set(it.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [items])
  if (items.length === 0) return null
  return (
    <group>
      <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.75} flatShading />
      </instancedMesh>
      {volumes.map((v, i) => (
        <mesh key={`v${i}`} position={[v.x, v.y, v.h / 2]} rotation={[-Math.PI / 2, v.ry, 0]} castShadow>
          <coneGeometry args={[v.r, v.h, 4]} />
          <meshStandardMaterial color={v.c} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
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
  seed = 1,
}: {
  w: number
  profile: ProfilePoint[]
  color: string
  backZ: number
  seed?: number
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
                <Holds w={w} len={len} seed={seed * 13 + i} />
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
          <ProfiledFace w={secW - 0.04} profile={profiles[i % profiles.length]} color={color} backZ={wallBack} seed={i + 1} />
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
  const face = (width: number, half: number, seed: number) => {
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
                <Holds w={width} len={len} seed={seed * 5 + i} />
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
      <group>{face(o.w, o.d / 2, 1)}</group>
      <group rotation-y={Math.PI}>{face(o.w, o.d / 2, 2)}</group>
      <group rotation-y={Math.PI / 2}>{face(o.d, o.w / 2, 3)}</group>
      <group rotation-y={-Math.PI / 2}>{face(o.d, o.w / 2, 4)}</group>
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
        {o.material && o.material !== 'glass' ? (
          <meshStandardMaterial
            key={o.material}
            color={tint ?? (SURFACE_TINTED[o.material] ? o.color : '#ffffff')}
            map={surfaceMap(o.material, o.w, o.d)}
            roughness={0.95}
          />
        ) : (
          <meshStandardMaterial color={tint ?? o.color} {...MAT} />
        )}
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
// A stair landing on this mezzanine cuts an OPENING in the deck: the hole
// rect (in the mezzanine's local frame) plus which side stays open (where
// the stair arrives). Only stairs aligned with the mezzanine (relative
// rotation a multiple of 90°) and reaching its height count.
function stairHole(
  o: Placed,
  objects: Placed[],
): { x0: number; x1: number; z0: number; z1: number; open: 'x+' | 'x-' | 'z+' | 'z-' } | null {
  for (const s of objects) {
    if (s.category !== 'stairs' || Math.abs(s.h - o.h) > 0.7) continue
    const dRot = (((s.rot - o.rot) % 8) + 8) % 8
    if (dRot % 2 !== 0) continue
    // stair top strip (local -d/2 end) center in world
    const th = (s.rot * Math.PI) / 4
    const topLen = Math.min(1.7, Math.max(1.1, s.d * 0.35))
    const lzTop = -(s.d - topLen) / 2
    const wx = s.x + lzTop * Math.sin(th)
    const wz = s.z + lzTop * Math.cos(th)
    // into mezzanine local frame
    const mth = (o.rot * Math.PI) / 4
    const dx = wx - o.x
    const dz = wz - o.z
    const lx = dx * Math.cos(mth) - dz * Math.sin(mth)
    const lz = dx * Math.sin(mth) + dz * Math.cos(mth)
    const hw = (dRot % 4 === 0 ? s.w : topLen) + 0.15
    const hd = (dRot % 4 === 0 ? topLen : s.w) + (dRot % 4 === 0 ? 0 : 0.15)
    if (Math.abs(lx) > o.w / 2 + hw / 2 - 0.1 || Math.abs(lz) > o.d / 2 + hd / 2 - 0.1) continue
    const x0 = Math.max(-o.w / 2, lx - hw / 2)
    const x1 = Math.min(o.w / 2, lx + hw / 2)
    const z0 = Math.max(-o.d / 2, lz - hd / 2)
    const z1 = Math.min(o.d / 2, lz + hd / 2)
    const open = (['z+', 'x+', 'z-', 'x-'] as const)[dRot / 2] // stair runs down toward this side
    if (x1 - x0 >= 0.4 && z1 - z0 >= 0.4) return { x0, x1, z0, z1, open }
    // stair top flush with the deck edge: cut a shallow landing notch there
    // so the perimeter rail opens over the stair width
    const notch = 0.5
    if (x1 - x0 >= 0.4) {
      if (open === 'z+' && Math.abs(lz - o.d / 2) < hd) return { x0, x1, z0: o.d / 2 - notch, z1: o.d / 2, open }
      if (open === 'z-' && Math.abs(lz + o.d / 2) < hd) return { x0, x1, z0: -o.d / 2, z1: -o.d / 2 + notch, open }
    }
    if (z1 - z0 >= 0.4) {
      if (open === 'x+' && Math.abs(lx - o.w / 2) < hw) return { x0: o.w / 2 - notch, x1: o.w / 2, z0, z1, open }
      if (open === 'x-' && Math.abs(lx + o.w / 2) < hw) return { x0: -o.w / 2, x1: -o.w / 2 + notch, z0, z1, open }
    }
    continue
  }
  return null
}

function Mezzanine({ o, tint }: { o: Placed; tint: string | null }) {
  const slabT = 0.25
  const railH = 1.0
  const objects = useStore((s) => s.objects)
  const hole = useMemo(() => stairHole(o, objects), [o, objects])

  const inHole = (x: number, z: number) =>
    hole !== null && x > hole.x0 - 0.09 && x < hole.x1 + 0.09 && z > hole.z0 - 0.09 && z < hole.z1 + 0.09

  const posts = useMemo(() => {
    const res: Array<[number, number]> = []
    const nx = Math.max(2, Math.round(o.w / 1.5))
    const nz = Math.max(2, Math.round(o.d / 1.5))
    for (const x of spread(nx, o.w - 0.1)) res.push([x, -o.d / 2 + 0.05], [x, o.d / 2 - 0.05])
    for (const z of spread(nz, o.d - 0.1)) res.push([-o.w / 2 + 0.05, z], [o.w / 2 - 0.05, z])
    return res
  }, [o.w, o.d])
  const balusters = useMemo(() => {
    const res: Array<[number, number]> = []
    for (const x of spread(Math.max(4, Math.round(o.w / 0.16)), o.w - 0.15))
      res.push([x, -o.d / 2 + 0.05], [x, o.d / 2 - 0.05])
    for (const z of spread(Math.max(4, Math.round(o.d / 0.16)), o.d - 0.15))
      res.push([-o.w / 2 + 0.05, z], [o.w / 2 - 0.05, z])
    return res
  }, [o.w, o.d])

  // deck pieces around the opening (whole deck when there is no hole)
  const pieces = useMemo(() => {
    if (!hole) return [{ cx: 0, cz: 0, w: o.w, d: o.d }]
    const res: Array<{ cx: number; cz: number; w: number; d: number }> = []
    if (hole.z0 > -o.d / 2 + 0.03) res.push({ cx: 0, cz: (-o.d / 2 + hole.z0) / 2, w: o.w, d: hole.z0 + o.d / 2 })
    if (hole.z1 < o.d / 2 - 0.03) res.push({ cx: 0, cz: (hole.z1 + o.d / 2) / 2, w: o.w, d: o.d / 2 - hole.z1 })
    const midD = hole.z1 - hole.z0
    if (hole.x0 > -o.w / 2 + 0.03) res.push({ cx: (-o.w / 2 + hole.x0) / 2, cz: (hole.z0 + hole.z1) / 2, w: hole.x0 + o.w / 2, d: midD })
    if (hole.x1 < o.w / 2 - 0.03) res.push({ cx: (hole.x1 + o.w / 2) / 2, cz: (hole.z0 + hole.z1) / 2, w: o.w / 2 - hole.x1, d: midD })
    return res
  }, [hole, o.w, o.d])

  // perimeter rails, split around the opening when it touches that edge
  const edgeSegs = (a0: number, a1: number, touches: boolean, g0: number, g1: number) => {
    if (!touches) return [[a0, a1]] as Array<[number, number]>
    const segs: Array<[number, number]> = []
    if (g0 - a0 > 0.18) segs.push([a0, g0])
    if (a1 - g1 > 0.18) segs.push([g1, a1])
    return segs
  }
  const northSegs = edgeSegs(-o.w / 2, o.w / 2, hole !== null && hole.z0 < -o.d / 2 + 0.2, hole?.x0 ?? 0, hole?.x1 ?? 0)
  const southSegs = edgeSegs(-o.w / 2, o.w / 2, hole !== null && hole.z1 > o.d / 2 - 0.2, hole?.x0 ?? 0, hole?.x1 ?? 0)
  const westSegs = edgeSegs(-o.d / 2, o.d / 2, hole !== null && hole.x0 < -o.w / 2 + 0.2, hole?.z0 ?? 0, hole?.z1 ?? 0)
  const eastSegs = edgeSegs(-o.d / 2, o.d / 2, hole !== null && hole.x1 > o.w / 2 - 0.2, hole?.z0 ?? 0, hole?.z1 ?? 0)

  // safety rails around the interior sides of the opening (the stair side stays open)
  const holeGuards = useMemo(() => {
    if (!hole) return []
    const res: Array<{ cx: number; cz: number; len: number; dir: 'x' | 'z' }> = []
    const near = (v: number, edge: number) => Math.abs(v - edge) < 0.2
    if (hole.open !== 'z-' && !near(hole.z0, -o.d / 2)) res.push({ cx: (hole.x0 + hole.x1) / 2, cz: hole.z0, len: hole.x1 - hole.x0, dir: 'x' })
    if (hole.open !== 'z+' && !near(hole.z1, o.d / 2)) res.push({ cx: (hole.x0 + hole.x1) / 2, cz: hole.z1, len: hole.x1 - hole.x0, dir: 'x' })
    if (hole.open !== 'x-' && !near(hole.x0, -o.w / 2)) res.push({ cx: hole.x0, cz: (hole.z0 + hole.z1) / 2, len: hole.z1 - hole.z0, dir: 'z' })
    if (hole.open !== 'x+' && !near(hole.x1, o.w / 2)) res.push({ cx: hole.x1, cz: (hole.z0 + hole.z1) / 2, len: hole.z1 - hole.z0, dir: 'z' })
    return res
  }, [hole, o.w, o.d])

  return (
    <group>
      {/* deck: birch floor over a steel edge beam, with the stair opening cut out */}
      {pieces.map((p, i) => (
        <group key={`s${i}`} position={[p.cx, 0, p.cz]}>
          <mesh position={[0, o.h - 0.03, 0]} castShadow receiveShadow>
            <boxGeometry args={[p.w, 0.06, p.d]} />
            <meshStandardMaterial color={tint ?? '#ffffff'} map={surfaceMap('birch', p.w, p.d)} roughness={0.8} />
          </mesh>
          <mesh position={[0, o.h - 0.06 - (slabT - 0.06) / 2, 0]} castShadow>
            <boxGeometry args={[p.w, slabT - 0.06, p.d]} />
            <meshStandardMaterial color={tint ?? '#5b6472'} roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      ))}
      {/* guardrail: posts, thin balusters, kick plates, timber handrail */}
      {posts
        .filter(([x, z]) => !inHole(x, z))
        .map(([x, z], i) => (
          <Box key={`p${i}`} args={[0.045, railH, 0.045]} pos={[x, o.h + railH / 2, z]} color="#3a3f45" />
        ))}
      {balusters
        .filter(([x, z]) => !inHole(x, z))
        .map(([x, z], i) => (
          <Box key={`b${i}`} args={[0.015, railH - 0.14, 0.015]} pos={[x, o.h + (railH - 0.14) / 2 + 0.02, z]} color="#4b5563" />
        ))}
      {northSegs.map(([a, b], i) => (
        <group key={`n${i}`}>
          <Box args={[b - a, 0.1, 0.02]} pos={[(a + b) / 2, o.h + 0.05, -o.d / 2 + 0.03]} color="#3a3f45" />
          <Alu args={[b - a, 0.055, 0.055]} pos={[(a + b) / 2, o.h + railH, -o.d / 2 + 0.05]} color="#c9a06c" />
        </group>
      ))}
      {southSegs.map(([a, b], i) => (
        <group key={`so${i}`}>
          <Box args={[b - a, 0.1, 0.02]} pos={[(a + b) / 2, o.h + 0.05, o.d / 2 - 0.03]} color="#3a3f45" />
          <Alu args={[b - a, 0.055, 0.055]} pos={[(a + b) / 2, o.h + railH, o.d / 2 - 0.05]} color="#c9a06c" />
        </group>
      ))}
      {westSegs.map(([a, b], i) => (
        <group key={`w${i}`}>
          <Box args={[0.02, 0.1, b - a]} pos={[-o.w / 2 + 0.03, o.h + 0.05, (a + b) / 2]} color="#3a3f45" />
          <Alu args={[0.055, 0.055, b - a]} pos={[-o.w / 2 + 0.05, o.h + railH, (a + b) / 2]} color="#c9a06c" />
        </group>
      ))}
      {eastSegs.map(([a, b], i) => (
        <group key={`e${i}`}>
          <Box args={[0.02, 0.1, b - a]} pos={[o.w / 2 - 0.03, o.h + 0.05, (a + b) / 2]} color="#3a3f45" />
          <Alu args={[0.055, 0.055, b - a]} pos={[o.w / 2 - 0.05, o.h + railH, (a + b) / 2]} color="#c9a06c" />
        </group>
      ))}
      {/* railing around the stair opening (open on the arrival side) */}
      {holeGuards.map((g, i) => (
        <group key={`g${i}`}>
          <Box
            args={g.dir === 'x' ? [g.len, 0.1, 0.02] : [0.02, 0.1, g.len]}
            pos={[g.cx, o.h + 0.05, g.cz]}
            color="#3a3f45"
          />
          <Alu args={g.dir === 'x' ? [g.len, 0.05, 0.05] : [0.05, 0.05, g.len]} pos={[g.cx, o.h + railH, g.cz]} color="#c9a06c" />
          <Box args={[0.045, railH, 0.045]} pos={g.dir === 'x' ? [g.cx - g.len / 2, o.h + railH / 2, g.cz] : [g.cx, o.h + railH / 2, g.cz - g.len / 2]} color="#3a3f45" />
          <Box args={[0.045, railH, 0.045]} pos={g.dir === 'x' ? [g.cx + g.len / 2, o.h + railH / 2, g.cz] : [g.cx, o.h + railH / 2, g.cz + g.len / 2]} color="#3a3f45" />
        </group>
      ))}
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
      <Alu args={[o.w + 0.14, 0.05, o.d + 0.14]} pos={[0, 0.025, 0]} color={tint ?? '#7d8590'} />
      {/* anchor bolts */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[(sx * (o.w + 0.08)) / 2, 0.07, (sz * (o.d + 0.08)) / 2]} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.05, 6]} />
          <meshStandardMaterial color="#4b5563" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, o.h / 2, 0]} castShadow>
        <boxGeometry args={[o.w, o.h, o.d]} />
        <meshStandardMaterial color={tint ?? o.color} roughness={0.45} metalness={0.35} />
      </mesh>
      <Alu args={[o.w + 0.16, 0.08, o.d + 0.16]} pos={[0, o.h - 0.04, 0]} color={tint ?? '#7d8590'} />
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
  const lx = w / 2 - 0.07
  const lz = d / 2 - 0.07
  return (
    <group position={pos}>
      {/* worktop: birch with a slim edge band */}
      <mesh position={[0, h, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.035, d]} />
        <meshStandardMaterial color={color === WOOD ? '#ffffff' : color} map={color === WOOD ? surfaceMap('birch', w, d) : undefined} roughness={0.6} />
      </mesh>
      {[
        [-lx, -lz],
        [lx, -lz],
        [-lx, lz],
        [lx, lz],
      ].map(([x, z], i) => (
        <Alu key={i} args={[0.04, h, 0.04]} pos={[x, h / 2, z]} color="#3a3f45" />
      ))}
      {/* cross stretcher */}
      <Alu args={[w - 0.2, 0.03, 0.03]} pos={[0, h - 0.12, 0]} color="#3a3f45" />
    </group>
  )
}

// Office task chair: star/disc base, gas-lift post, padded seat, tilted back.
function ChairMesh({ pos, facing = 0, color = '#5f6b7a' }: { pos: [number, number, number]; facing?: number; color?: string }) {
  return (
    <group position={pos} rotation-y={facing}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.29, 0.04, 12]} />
        <meshStandardMaterial color="#2b2f35" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#8f959c" roughness={0.35} metalness={0.6} />
      </mesh>
      <Box args={[0.44, 0.07, 0.44]} pos={[0, 0.47, 0]} color={color} />
      <Box args={[0.42, 0.5, 0.06]} pos={[0, 0.76, -0.22]} rot={[-0.12, 0, 0]} color={color} />
      {/* armrests */}
      <Box args={[0.04, 0.16, 0.24]} pos={[-0.23, 0.58, -0.04]} color="#2b2f35" />
      <Box args={[0.04, 0.16, 0.24]} pos={[0.23, 0.58, -0.04]} color="#2b2f35" />
    </group>
  )
}

// Locker-room style long bench: seat slab on leg panels with a low shoe shelf
function BenchMesh({ o, tint }: { o: Placed; tint: string | null }) {
  const color = tint ?? o.color
  return (
    <group>
      <Box args={[o.w, 0.07, o.d]} pos={[0, o.h - 0.035, 0]} color={color} />
      <Box args={[0.09, o.h - 0.07, Math.max(0.1, o.d - 0.06)]} pos={[-o.w / 2 + 0.22, (o.h - 0.07) / 2, 0]} color={DARKWOOD} />
      <Box args={[0.09, o.h - 0.07, Math.max(0.1, o.d - 0.06)]} pos={[o.w / 2 - 0.22, (o.h - 0.07) / 2, 0]} color={DARKWOOD} />
      {o.w > 1.8 && (
        <Box args={[0.09, o.h - 0.07, Math.max(0.1, o.d - 0.06)]} pos={[0, (o.h - 0.07) / 2, 0]} color={DARKWOOD} />
      )}
      {/* low shoe shelf */}
      <Box args={[Math.max(0.3, o.w - 0.5), 0.05, Math.max(0.1, o.d - 0.12)]} pos={[0, o.h * 0.35, 0]} color={color} />
    </group>
  )
}

// Four-leg wooden stool with a slim padded seat and a foot ring.
function StoolMesh({ o, tint }: { o: Placed; tint: string | null }) {
  const r = Math.min(o.w, o.d) / 2
  const lr = r * 0.62 // leg circle radius
  return (
    <group>
      <mesh position={[0, o.h - 0.025, 0]} castShadow>
        <cylinderGeometry args={[r * 0.78, r * 0.72, 0.05, 18]} />
        <meshStandardMaterial color={tint ?? o.color} roughness={0.75} />
      </mesh>
      <mesh position={[0, o.h - 0.06, 0]}>
        <cylinderGeometry args={[r * 0.6, r * 0.6, 0.02, 14]} />
        <meshStandardMaterial color="#6e5335" roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * lr, (o.h - 0.07) / 2, Math.sin(a) * lr]}
            rotation={[Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]}
            castShadow
          >
            <cylinderGeometry args={[0.02, 0.024, o.h - 0.07, 8]} />
            <meshStandardMaterial color="#6e5335" roughness={0.85} />
          </mesh>
        )
      })}
      {/* foot ring */}
      <mesh position={[0, o.h * 0.32, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[lr * 1.02, 0.012, 8, 20]} />
        <meshStandardMaterial color={STEEL} roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  )
}

/* -------------------------------- zones -------------------------------- */

function ZonePatch({ o, tint, opacity = 0.85 }: { o: Placed; tint: string | null; opacity?: number }) {
  const surf = o.material && o.material !== 'glass' ? o.material : undefined
  if (surf) {
    // real surface finish (EPDM rubber / concrete / birch), tinted by the
    // item color where the material allows it
    return (
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[o.w, 0.08, o.d]} />
        <meshStandardMaterial
          key={surf}
          color={tint ?? (SURFACE_TINTED[surf] ? o.color : '#ffffff')}
          map={surfaceMap(surf, o.w, o.d)}
          roughness={0.95}
        />
      </mesh>
    )
  }
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
            {/* laptops facing each seat */}
            <group position={[-0.28, 0.775, 0.16]} rotation-y={Math.PI}>
              <Box args={[0.32, 0.015, 0.22]} pos={[0, 0, 0]} color="#3a3f45" />
              <mesh position={[0, 0.1, -0.13]} rotation-x={-0.35}>
                <boxGeometry args={[0.32, 0.22, 0.012]} />
                <meshStandardMaterial color="#1c1f24" emissive="#33506b" emissiveIntensity={0.5} roughness={0.4} />
              </mesh>
            </group>
            <group position={[0.28, 0.775, -0.16]}>
              <Box args={[0.32, 0.015, 0.22]} pos={[0, 0, 0]} color="#3a3f45" />
              <mesh position={[0, 0.1, -0.13]} rotation-x={-0.35}>
                <boxGeometry args={[0.32, 0.22, 0.012]} />
                <meshStandardMaterial color="#1c1f24" emissive="#33506b" emissiveIntensity={0.5} roughness={0.4} />
              </mesh>
            </group>
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
// Recognizable treadmill: deck with belt, side rails, slanted console mast.
function Treadmill({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  return (
    <group position={pos} rotation-y={ry}>
      <Box args={[0.78, 0.14, 1.8]} pos={[0, 0.1, 0.12]} color="#23262b" />
      <Box args={[0.5, 0.03, 1.5]} pos={[0, 0.185, 0.16]} color="#111318" />
      <Alu args={[0.06, 0.03, 1.6]} pos={[-0.32, 0.19, 0.14]} />
      <Alu args={[0.06, 0.03, 1.6]} pos={[0.32, 0.19, 0.14]} />
      {/* console mast + handles */}
      <Alu args={[0.05, 1.15, 0.05]} pos={[-0.3, 0.72, -0.68]} rot={[0.28, 0, 0]} />
      <Alu args={[0.05, 1.15, 0.05]} pos={[0.3, 0.72, -0.68]} rot={[0.28, 0, 0]} />
      <Box args={[0.72, 0.34, 0.07]} pos={[0, 1.32, -0.84]} rot={[0.5, 0, 0]} color="#2b2f35" />
      <mesh position={[0, 1.34, -0.8]} rotation-x={0.5}>
        <boxGeometry args={[0.42, 0.2, 0.005]} />
        <meshStandardMaterial color="#274156" emissive="#3d6a8f" emissiveIntensity={0.55} roughness={0.3} />
      </mesh>
      <Alu args={[0.68, 0.045, 0.045]} pos={[0, 1.06, -0.62]} color="#8f959c" />
    </group>
  )
}

// Elliptical cross-trainer: rear drive housing, pedal arms, moving handles.
function Elliptical({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  return (
    <group position={pos} rotation-y={ry}>
      <Box args={[0.55, 0.09, 1.5]} pos={[0, 0.07, 0]} color="#23262b" />
      {/* rear flywheel housing */}
      <mesh position={[0, 0.52, 0.55]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.18, 18]} />
        <meshStandardMaterial color="#2b2f35" roughness={0.5} />
      </mesh>
      {/* pedal arms + pedals at opposite phases */}
      <Alu args={[0.045, 0.045, 0.95]} pos={[-0.16, 0.42, 0.12]} rot={[-0.22, 0, 0]} color="#8f959c" />
      <Alu args={[0.045, 0.045, 0.95]} pos={[0.16, 0.52, 0.1]} rot={[0.14, 0, 0]} color="#8f959c" />
      <Box args={[0.16, 0.035, 0.34]} pos={[-0.16, 0.33, -0.28]} color="#111318" />
      <Box args={[0.16, 0.035, 0.34]} pos={[0.16, 0.6, -0.26]} color="#111318" />
      {/* front mast, console, moving handlebars */}
      <Alu args={[0.06, 1.05, 0.06]} pos={[0, 0.62, -0.6]} rot={[0.12, 0, 0]} />
      <Box args={[0.4, 0.24, 0.06]} pos={[0, 1.28, -0.66]} rot={[0.4, 0, 0]} color="#2b2f35" />
      <Alu args={[0.04, 0.85, 0.04]} pos={[-0.2, 0.98, -0.42]} rot={[0.3, 0, 0]} color="#8f959c" />
      <Alu args={[0.04, 0.85, 0.04]} pos={[0.2, 1.08, -0.46]} rot={[-0.05, 0, 0]} color="#8f959c" />
    </group>
  )
}

// A-frame dumbbell rack with two tiers of round-headed dumbbells.
function DumbbellRack({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  const bell = (x: number, y: number) => (
    <group key={`${x}${y}`} position={[x, y, 0]}>
      <mesh rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
        <meshStandardMaterial color="#9aa2ab" roughness={0.35} metalness={0.6} />
      </mesh>
      {[-0.12, 0.12].map((dx) => (
        <mesh key={dx} position={[dx, 0, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.09, 12]} />
          <meshStandardMaterial color="#2b2f35" roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
  return (
    <group position={pos} rotation-y={ry}>
      {[-0.8, 0.8].map((x) => (
        <Alu key={x} args={[0.07, 0.85, 0.6]} pos={[x, 0.42, 0]} color="#3a3f45" />
      ))}
      <Box args={[1.7, 0.06, 0.5]} pos={[0, 0.42, 0.1]} rot={[0.35, 0, 0]} color="#3a3f45" />
      <Box args={[1.7, 0.06, 0.5]} pos={[0, 0.78, -0.08]} rot={[0.35, 0, 0]} color="#3a3f45" />
      {[-0.55, -0.15, 0.25, 0.6].map((x) => bell(x, 0.56))}
      {[-0.5, -0.05, 0.4].map((x) => bell(x, 0.92))}
    </group>
  )
}

function TrainingZone({ o, tint }: { o: Placed; tint: string | null }) {
  const rigW = Math.min(o.w - 1, 4)
  // cardio row along the front edge: alternating treadmills and ellipticals
  const nCardio = Math.max(2, Math.min(6, Math.floor((o.w - 0.8) / 1.05)))
  const cardioX = spread(nCardio, o.w - 1)
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
      {/* cardio row facing out */}
      {cardioX.map((x, i) =>
        i % 2 === 0 ? (
          <Treadmill key={i} pos={[x, 0.08, o.d / 2 - 1.1]} ry={Math.PI} />
        ) : (
          <Elliptical key={i} pos={[x, 0.08, o.d / 2 - 1.1]} ry={Math.PI} />
        ),
      )}
      {/* bench */}
      <group position={[Math.min(o.w / 4, 2), 0.08, -o.d / 8]}>
        <Box args={[0.4, 0.12, 1.3]} pos={[0, 0.45, 0]} color="#374151" />
        <Box args={[0.3, 0.42, 0.12]} pos={[0, 0.21, -0.5]} color={STEEL} />
        <Box args={[0.3, 0.42, 0.12]} pos={[0, 0.21, 0.5]} color={STEEL} />
      </group>
      <DumbbellRack pos={[-Math.min(o.w / 4, 2), 0.08, -o.d / 8]} />
      {/* athletes: one hanging, one mid-run */}
      <Figure pose="hang" pos={[Math.min(o.w / 5, 1.2), 1.15, -o.d / 2 + 0.8]} ry={Math.PI} shirt="#22c55e" idx={2} />
      <Figure pose="walk" pos={[cardioX[0], 0.28, o.d / 2 - 0.9]} ry={Math.PI} shirt="#3b82f6" idx={4} />
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

// SkiErg: tall frame with a round flywheel head and hanging pull cords
function SkiErg({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <Box args={[0.55, 0.08, 0.7]} pos={[0, 0.04, 0]} color={STEEL} />
      <Alu args={[0.1, 2.15, 0.1]} pos={[0, 1.12, 0]} color="#4b5563" />
      <mesh position={[0, 1.95, 0.08]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.22, 18]} />
        <meshStandardMaterial color="#111827" roughness={0.5} />
      </mesh>
      <Box args={[0.44, 0.1, 0.06]} pos={[0, 1.62, 0.16]} color="#2b2f35" />
      {/* cords + handles */}
      <Box args={[0.012, 0.6, 0.012]} pos={[-0.15, 1.35, 0.2]} color="#6b7280" />
      <Box args={[0.012, 0.6, 0.012]} pos={[0.15, 1.35, 0.2]} color="#6b7280" />
      <Alu args={[0.1, 0.028, 0.028]} pos={[-0.15, 1.04, 0.2]} color="#111318" />
      <Alu args={[0.1, 0.028, 0.028]} pos={[0.15, 1.04, 0.2]} color="#111318" />
    </group>
  )
}

// Concept-style rower: monorail, sliding seat, fan cage, footrests, handle
function Rower({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  return (
    <group position={pos} rotation-y={ry}>
      {/* monorail slightly inclined + rear support leg */}
      <Alu args={[1.9, 0.07, 0.12]} pos={[0.15, 0.4, 0]} rot={[0, 0, 0.045]} color="#c9ced4" />
      <Alu args={[0.08, 0.32, 0.08]} pos={[1.0, 0.17, 0]} color="#4b5563" />
      {/* fan cage + frame at the front */}
      <mesh position={[-0.85, 0.62, 0]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.24, 18]} />
        <meshStandardMaterial color="#23262b" roughness={0.55} />
      </mesh>
      <Box args={[0.32, 0.5, 0.4]} pos={[-0.85, 0.22, 0]} color="#374151" />
      {/* performance monitor on an arm */}
      <Alu args={[0.03, 0.34, 0.03]} pos={[-0.62, 0.92, 0]} rot={[0, 0, -0.3]} color="#8f959c" />
      <Box args={[0.2, 0.14, 0.03]} pos={[-0.53, 1.08, 0]} color="#1c1f24" />
      {/* sliding seat + footrests + handle docked */}
      <Box args={[0.32, 0.06, 0.3]} pos={[0.32, 0.5, 0]} color="#2b2f35" />
      <Box args={[0.1, 0.3, 0.24]} pos={[-0.42, 0.35, 0.22]} rot={[0, 0, -0.5]} color="#111318" />
      <Box args={[0.1, 0.3, 0.24]} pos={[-0.42, 0.35, -0.22]} rot={[0, 0, -0.5]} color="#111318" />
      <Alu args={[0.04, 0.04, 0.42]} pos={[-0.6, 0.75, 0]} color="#111318" />
    </group>
  )
}

// Kettlebell: ball with a flat base and an arched handle
function Kettlebell({ pos, color = '#374151' }: { pos: [number, number, number]; color?: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <sphereGeometry args={[0.15, 12, 10]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.11, 0.12, 0.05, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.29, 0]} castShadow>
        <torusGeometry args={[0.09, 0.024, 8, 14, Math.PI]} />
        <meshStandardMaterial color="#2b2f35" roughness={0.5} metalness={0.4} />
      </mesh>
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
// Room walls with a real doorway opening in the front wall (offset right),
// a header above it, and a dark baseboard line around the outside.
/* --------------------- automatic door openings in walls --------------------- */

// A wall slab running along local x with door openings cut out of it: full-
// height segments between the openings plus a header above each doorway.
function CutWall({
  len,
  h,
  t,
  openings,
  color,
  pos = [0, 0, 0],
  rotY = 0,
  glass = false,
  tint = null,
}: {
  len: number
  h: number
  t: number
  openings: Opening[]
  color: string
  pos?: [number, number, number]
  rotY?: number
  glass?: boolean
  tint?: string | null
}) {
  // merge overlapping cut intervals
  const cuts = openings
    .map((o) => [Math.max(-len / 2, o.c - o.w / 2), Math.min(len / 2, o.c + o.w / 2), o.h] as [number, number, number])
    .sort((p, q) => p[0] - q[0])
  const merged: Array<[number, number, number]> = []
  for (const c of cuts) {
    const last = merged[merged.length - 1]
    if (last && c[0] <= last[1] + 0.01) {
      last[1] = Math.max(last[1], c[1])
      last[2] = Math.max(last[2], c[2])
    } else merged.push([...c])
  }
  const segs: Array<[number, number]> = []
  let cursor = -len / 2
  for (const [x0, x1] of merged) {
    if (x0 - cursor > 0.04) segs.push([cursor, x0])
    cursor = Math.max(cursor, x1)
  }
  if (len / 2 - cursor > 0.04) segs.push([cursor, len / 2])
  const piece = (x0: number, x1: number, y0: number, y1: number, k: string) =>
    glass ? (
      <group key={k} position={[(x0 + x1) / 2, (y0 + y1) / 2, 0]}>
        <GlassPanel w={x1 - x0} h={y1 - y0} t={t} tint={tint} />
      </group>
    ) : (
      <Box key={k} args={[x1 - x0, y1 - y0, t]} pos={[(x0 + x1) / 2, (y0 + y1) / 2, 0]} color={color} />
    )
  return (
    <group position={pos} rotation-y={rotY}>
      {segs.map(([x0, x1], i) => piece(x0, x1, 0, h, `s${i}`))}
      {merged.map(([x0, x1, oh], i) => (oh < h - 0.04 ? piece(x0, x1, oh, h, `h${i}`) : null))}
    </group>
  )
}

// doors that can sit in interior walls (edge doors live on the building shell)
function useWallDoors(hostId: string): Placed[] {
  const objects = useStore((s) => s.objects)
  return useMemo(
    () => objects.filter((d) => d.category === 'door' && d.rule === 'floor' && d.id !== hostId),
    [objects, hostId],
  )
}

// Interior partition (solid or glass) that opens up around doors placed on it
function PartitionWall({ o, tint }: { o: Placed; tint: string | null }) {
  const doors = useWallDoors(o.id)
  const t = Math.max(0.08, o.d)
  const openings = wallOpenings(doors, o, { cx: 0, cz: 0, along: 'x', len: o.w, t })
  if (o.material === 'glass')
    return <CutWall len={o.w} h={o.h} t={t} openings={openings} color="" glass tint={tint} />
  if (openings.length === 0)
    return (
      <mesh position={[0, o.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w, o.h, t]} />
        <meshStandardMaterial color={tint ?? o.color} {...MAT} />
        <Edges color="#c9c2b4" />
      </mesh>
    )
  return <CutWall len={o.w} h={o.h} t={t} openings={openings} color={tint ?? o.color} />
}

function RoomShell({ o, tint, wallColor = WHITE, floorColor }: { o: Placed; tint: string | null; wallColor?: string; floorColor?: string }) {
  const t = 0.12
  const wc = tint ?? wallColor
  const doors = useWallDoors(o.id)
  // door items placed on any of the four walls cut real openings there
  const backCuts = wallOpenings(doors, o, { cx: 0, cz: -o.d / 2 + t / 2, along: 'x', len: o.w, t })
  const frontCuts = wallOpenings(doors, o, { cx: 0, cz: o.d / 2 - t / 2, along: 'x', len: o.w, t })
  const leftCuts = wallOpenings(doors, o, { cx: -o.w / 2 + t / 2, cz: 0, along: 'z', len: o.d, t })
  const rightCuts = wallOpenings(doors, o, { cx: o.w / 2 - t / 2, cz: 0, along: 'z', len: o.d, t })
  const sideLen = Math.max(0.05, o.d - t * 2)
  const doorW = Math.min(0.95, o.w * 0.4)
  const doorH = Math.min(2.05, o.h - 0.2)
  const doorX = o.w / 2 - 0.35 - doorW / 2 // built-in opening near the right corner
  const leftW = doorX - doorW / 2 + o.w / 2
  const rightW = o.w / 2 - (doorX + doorW / 2)
  return (
    <group>
      <Box args={[o.w, 0.06, o.d]} pos={[0, 0.03, 0]} color={tint ?? floorColor ?? o.color} />
      <CutWall len={o.w} h={o.h} t={t} openings={backCuts} color={wc} pos={[0, 0, -o.d / 2 + t / 2]} />
      {frontCuts.length > 0 ? (
        // a real door placed on the front wall replaces the built-in doorway
        <CutWall len={o.w} h={o.h} t={t} openings={frontCuts} color={wc} pos={[0, 0, o.d / 2 - t / 2]} />
      ) : (
        <>
          {/* front wall split around the built-in doorway + header */}
          {leftW > 0.05 && <Box args={[leftW, o.h, t]} pos={[-o.w / 2 + leftW / 2, o.h / 2, o.d / 2 - t / 2]} color={wc} />}
          {rightW > 0.05 && <Box args={[rightW, o.h, t]} pos={[o.w / 2 - rightW / 2, o.h / 2, o.d / 2 - t / 2]} color={wc} />}
          <Box args={[doorW, Math.max(0.08, o.h - doorH), t]} pos={[doorX, doorH + (o.h - doorH) / 2, o.d / 2 - t / 2]} color={wc} />
          <Alu args={[0.05, doorH, t + 0.02]} pos={[doorX - doorW / 2, doorH / 2, o.d / 2 - t / 2]} color="#8a9099" />
          <Alu args={[0.05, doorH, t + 0.02]} pos={[doorX + doorW / 2, doorH / 2, o.d / 2 - t / 2]} color="#8a9099" />
        </>
      )}
      {/* side walls run along local z: rotY -90° maps CutWall's x onto z */}
      <CutWall len={sideLen} h={o.h} t={t} openings={leftCuts} color={wc} pos={[-o.w / 2 + t / 2, 0, 0]} rotY={-Math.PI / 2} />
      <CutWall len={sideLen} h={o.h} t={t} openings={rightCuts} color={wc} pos={[o.w / 2 - t / 2, 0, 0]} rotY={-Math.PI / 2} />
      {/* baseboard */}
      <Box args={[o.w + 0.02, 0.09, o.d + 0.02]} pos={[0, 0.045, 0]} color="#57534e" />
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
          {/* stall partitions raised off the floor, with a slightly ajar door */}
          <Box args={[0.04, 1.4, 1.2]} pos={[-0.52, 0.9, 0]} color="#94a3b8" />
          {i === xs.length - 1 && <Box args={[0.04, 1.4, 1.2]} pos={[0.52, 0.9, 0]} color="#94a3b8" />}
          <group position={[-0.5, 0, 0.6]} rotation-y={i % 2 ? -0.35 : 0}>
            <Box args={[0.95, 1.4, 0.035]} pos={[0.48, 0.9, 0]} color="#a8b6c8" />
            <mesh position={[0.85, 1.0, 0.05]} castShadow>
              <sphereGeometry args={[0.025, 8, 6]} />
              <meshStandardMaterial color="#6b7280" roughness={0.4} metalness={0.5} />
            </mesh>
          </group>
          {/* toilet: bowl + seat + cistern */}
          <mesh position={[0, 0.22, -0.12]} castShadow>
            <cylinderGeometry args={[0.19, 0.14, 0.34, 12]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.4, -0.12]}>
            <cylinderGeometry args={[0.21, 0.21, 0.045, 12]} />
            <meshStandardMaterial color="#f4f4f5" roughness={0.3} />
          </mesh>
          <Box args={[0.42, 0.5, 0.16]} pos={[0, 0.62, -0.42]} color="#ffffff" />
          <Box args={[0.14, 0.05, 0.03]} pos={[0.1, 0.82, -0.35]} color="#c9ced4" />
        </group>
      ))}
      {/* vanity: counter, round basins, taps and a mirror strip */}
      <group position={[o.w / 4, 0, o.d / 2 - 0.5]}>
        <Box args={[Math.min(1.6, o.w / 2), 0.06, 0.5]} pos={[0, 0.82, 0]} color="#d7dbe0" />
        <Box args={[Math.min(1.6, o.w / 2) - 0.15, 0.72, 0.42]} pos={[0, 0.4, 0]} color="#8a7b6a" />
        {[-0.35, 0.35].map((x) => (
          <group key={x} position={[x, 0.86, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.16, 0.12, 0.09, 14]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            <Alu args={[0.03, 0.16, 0.03]} pos={[0, 0.12, -0.16]} color="#9aa2ab" />
            <Alu args={[0.03, 0.03, 0.12]} pos={[0, 0.19, -0.11]} color="#9aa2ab" />
          </group>
        ))}
        <mesh position={[0, 1.5, 0.19]}>
          <boxGeometry args={[Math.min(1.5, o.w / 2), 0.6, 0.02]} />
          <meshStandardMaterial color="#b8d4de" roughness={0.05} metalness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

// Sauna: wood shell, two-tier benches, stove with stones
function Sauna({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <RoomShell o={o} tint={tint} wallColor={tint ?? '#d9b98c'} floorColor="#c9a06c" />
      {/* wood slat lining on the back wall */}
      {[0.5, 0.9, 1.3, 1.7].map((y) => (
        <mesh key={y} position={[0, y, -o.d / 2 + 0.16]} castShadow>
          <boxGeometry args={[o.w - 0.3, 0.3, 0.03]} />
          <meshStandardMaterial color="#ffffff" map={surfaceMap('birch', o.w, 0.6)} roughness={0.8} />
        </mesh>
      ))}
      {/* two-tier slatted benches */}
      {[
        [0.45, 0.5, 0.6],
        [0.85, 0.35, 0.55],
      ].map(([y, zoff, depth], t) => (
        <group key={t} position={[0, y, -o.d / 2 + zoff]}>
          {[-1, 0, 1].map((k) => (
            <Box key={k} args={[o.w - 0.5, 0.045, depth / 3.4]} pos={[0, 0, (k * depth) / 3]} color={WOOD} />
          ))}
          <Box args={[0.08, y, 0.08]} pos={[-o.w / 2 + 0.45, -y / 2, 0]} color={DARKWOOD} />
          <Box args={[0.08, y, 0.08]} pos={[o.w / 2 - 0.45, -y / 2, 0]} color={DARKWOOD} />
        </group>
      ))}
      {/* heater: steel cage stove with a pile of stones */}
      <group position={[o.w / 2 - 0.55, 0, o.d / 2 - 0.6]}>
        <Alu args={[0.45, 0.62, 0.45]} pos={[0, 0.31, 0]} color="#4b5563" />
        {[0, 0.16, 0.32, 0.48].map((y) => (
          <Box key={y} args={[0.47, 0.02, 0.47]} pos={[0, 0.12 + y * 0.9, 0]} color="#2b2f35" />
        ))}
        {[
          [-0.09, 0.06, 0.1],
          [0.1, -0.06, 0.09],
          [0, 0.02, 0.11],
          [0.03, 0.1, 0.08],
          [-0.05, -0.09, 0.085],
        ].map(([x, z, r], i) => (
          <mesh key={i} position={[x, 0.68 + i * 0.015, z]} castShadow>
            <icosahedronGeometry args={[r, 1]} />
            <meshStandardMaterial color={i % 2 ? '#6b7280' : '#57534e'} roughness={0.95} flatShading />
          </mesh>
        ))}
        {/* guard rail */}
        <Alu args={[0.6, 0.04, 0.04]} pos={[0, 0.75, 0.32]} color="#8a6f52" />
      </group>
    </group>
  )
}

// Storage: shell + shelf racks with boxes
function StorageRoom({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      <RoomShell o={o} tint={tint} floorColor="#d6d0c4" />
      {/* boltless steel shelving with cardboard boxes and bins */}
      <group position={[0, 0, -o.d / 2 + 0.45]}>
        {spread(Math.max(2, Math.round(o.w / 1.6)), o.w - 0.7).map((x, i) => (
          <group key={`u${i}`}>
            <Alu args={[0.05, 1.9, 0.05]} pos={[x - 0.65, 0.95, -0.25]} color="#5b6472" />
            <Alu args={[0.05, 1.9, 0.05]} pos={[x + 0.65, 0.95, -0.25]} color="#5b6472" />
            <Alu args={[0.05, 1.9, 0.05]} pos={[x - 0.65, 0.95, 0.25]} color="#5b6472" />
            <Alu args={[0.05, 1.9, 0.05]} pos={[x + 0.65, 0.95, 0.25]} color="#5b6472" />
          </group>
        ))}
        {[0.35, 0.95, 1.55].map((y) => (
          <Box key={y} args={[o.w - 0.6, 0.04, 0.6]} pos={[0, y, 0]} color="#7c828a" />
        ))}
        {spread(Math.max(3, Math.floor(o.w / 0.75)), o.w - 1).map((x, i) => (
          <group key={i} rotation-y={((i * 37) % 10) / 40 - 0.12}>
            <Box
              args={[0.45, i % 3 ? 0.34 : 0.42, 0.42]}
              pos={[x, [0.55, 1.15, 1.75][i % 3], 0]}
              color={i % 4 === 0 ? '#3b6ea5' : i % 3 ? '#b8a081' : '#a3865f'}
            />
            {i % 3 === 1 && <Box args={[0.4, 0.02, 0.02]} pos={[x, [0.55, 1.15, 1.75][i % 3] + 0.18, 0]} color="#8a6f52" />}
          </group>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------- fixtures ------------------------------- */

// Shoe rack: shelving with pairs of shoes
// Cubby shoe wall: birch carcass, divider grid, pairs of shoes inside.
function ShoeRack({ o, tint }: { o: Placed; tint: string | null }) {
  const shelves = [0.06, 0.42, 0.78, 1.14].filter((y) => y < o.h - 0.2)
  const cols = Math.round(clampN(Math.floor(o.w / 0.4), 2, 8))
  const colX = spread(cols + 1, o.w - 0.06)
  const SHOE = ['#57534e', '#8a9099', '#3b6ea5', '#a3865f', '#6b7280', '#b45309']
  return (
    <group>
      <mesh position={[0, o.h / 2, -o.d / 2 + 0.02]} castShadow>
        <boxGeometry args={[o.w, o.h, 0.04]} />
        <meshStandardMaterial color={tint ?? '#ffffff'} map={surfaceMap('birch', o.w, o.h)} roughness={0.8} />
      </mesh>
      <Box args={[0.05, o.h, o.d]} pos={[-o.w / 2 + 0.025, o.h / 2, 0]} color={tint ?? o.color} />
      <Box args={[0.05, o.h, o.d]} pos={[o.w / 2 - 0.025, o.h / 2, 0]} color={tint ?? o.color} />
      <Box args={[o.w, 0.05, o.d]} pos={[0, o.h - 0.025, 0]} color={tint ?? o.color} />
      {shelves.map((y, i) => (
        <Box key={i} args={[o.w - 0.06, 0.035, o.d - 0.06]} pos={[0, y, 0]} color={tint ?? o.color} />
      ))}
      {colX.slice(1, -1).map((x, i) => (
        <Box key={`d${i}`} args={[0.03, o.h - 0.1, o.d - 0.08]} pos={[x, o.h / 2 - 0.02, 0]} color={tint ?? o.color} />
      ))}
      {/* pairs of shoes in some cubbies */}
      {shelves.flatMap((y, si) =>
        spread(cols, o.w - 0.35)
          .filter((_, i) => (si * 5 + i * 3) % 4 !== 0)
          .map((x, i) => (
            <group key={`${si}-${i}`} position={[x, y + 0.06, 0.05]}>
              <Box args={[0.09, 0.09, 0.27]} pos={[-0.055, 0, 0]} color={SHOE[(si * cols + i) % SHOE.length]} />
              <Box args={[0.09, 0.09, 0.27]} pos={[0.055, 0, 0]} color={SHOE[(si * cols + i) % SHOE.length]} />
              <Box args={[0.2, 0.03, 0.29]} pos={[0, -0.055, 0]} color="#e7e5e4" />
            </group>
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
      {/* rim cap */}
      <Alu args={[o.w + 0.06, 0.05, t + 0.06]} pos={[0, o.h - 0.02, -o.d / 2 + t / 2]} color="#b9c0c7" />
      <Alu args={[o.w + 0.06, 0.05, t + 0.06]} pos={[0, o.h - 0.02, o.d / 2 - t / 2]} color="#b9c0c7" />
      <Alu args={[t + 0.06, 0.05, o.d]} pos={[-o.w / 2 + t / 2, o.h - 0.02, 0]} color="#b9c0c7" />
      <Alu args={[t + 0.06, 0.05, o.d]} pos={[o.w / 2 - t / 2, o.h - 0.02, 0]} color="#b9c0c7" />
      <mesh position={[0, o.h * 0.75, 0]}>
        <boxGeometry args={[o.w - t * 2, 0.04, o.d - t * 2]} />
        <meshStandardMaterial color={tint ?? '#7dd3fc'} transparent opacity={0.75} roughness={0.12} />
      </mesh>
      {/* floating ice chunks */}
      {[
        [-0.5, -0.3, 0.12],
        [0.4, 0.25, 0.1],
        [0.15, -0.35, 0.08],
        [-0.25, 0.3, 0.09],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x * o.w * 0.6, o.h * 0.77, z * o.d * 0.6]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color="#eef6fb" roughness={0.3} transparent opacity={0.9} />
        </mesh>
      ))}
      {/* step-up stairs with grab rail */}
      <Box args={[0.6, o.h * 0.3, 0.32]} pos={[0, o.h * 0.15, o.d / 2 + 0.32]} color="#cbd5e1" />
      <Box args={[0.6, o.h * 0.62, 0.32]} pos={[0, o.h * 0.31, o.d / 2 + 0.06]} color="#cbd5e1" />
      <Alu args={[0.035, o.h + 0.5, 0.035]} pos={[0.34, (o.h + 0.5) / 2, o.d / 2 + 0.2]} color="#9aa2ab" />
      <Alu args={[0.035, 0.035, 0.5]} pos={[0.34, o.h + 0.48, o.d / 2]} color="#9aa2ab" />
      {/* someone soaking, chest-deep */}
      <Figure pose="sit" pos={[0, o.h - 0.95, 0]} shirt="#0ea5e9" idx={2} />
    </group>
  )
}

// Reception: birch-clad counter with recessed toe kick, stone top, monitor
// on a stand, keyboard, and a staff member seated behind.
function Reception({ o, tint }: { o: Placed; tint: string | null }) {
  return (
    <group>
      {/* toe kick + birch front panel */}
      <Box args={[o.w - 0.16, 0.12, o.d - 0.16]} pos={[0, 0.06, 0]} color="#2b2f35" />
      <mesh position={[0, (o.h - 0.06) / 2 + 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w, o.h - 0.16, o.d]} />
        <meshStandardMaterial color={tint ?? '#ffffff'} map={surfaceMap('birch', o.w, o.h)} roughness={0.7} />
      </mesh>
      {/* stone worktop with overhang */}
      <mesh position={[0, o.h - 0.03, 0]} castShadow>
        <boxGeometry args={[o.w + 0.14, 0.06, o.d + 0.14]} />
        <meshStandardMaterial color={tint ?? '#e7e5e0'} roughness={0.35} />
      </mesh>
      {/* monitor on stand + keyboard, facing the staff side */}
      <group position={[-o.w / 5, o.h, -o.d / 8]}>
        <Box args={[0.2, 0.02, 0.14]} pos={[0, 0.01, 0]} color="#2b2f35" />
        <Alu args={[0.035, 0.14, 0.035]} pos={[0, 0.08, 0]} color="#3a3f45" />
        <mesh position={[0, 0.28, 0]} rotation-y={Math.PI} castShadow>
          <boxGeometry args={[0.5, 0.3, 0.025]} />
          <meshStandardMaterial color="#1c1f24" emissive="#33506b" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
        <Box args={[0.34, 0.015, 0.12]} pos={[0, 0.01, -0.24]} color="#3a3f45" />
      </group>
      {/* small card reader + bell on the guest side */}
      <Box args={[0.1, 0.09, 0.07]} pos={[o.w / 4, o.h + 0.045, o.d / 6]} color="#374151" />
      {/* staff member on a stool behind the counter */}
      <Figure pose="sit" pos={[-o.w / 5, 0.28, -o.d / 2 - 0.35]} shirt="#0e8f86" idx={3} />
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
      {/* concrete wheel stop near the head of the stall */}
      <Box args={[Math.min(1.7, o.w * 0.35), 0.12, 0.16]} pos={[-o.w / 2 + Math.min(1.7, o.w * 0.35) / 2 + 0.3, 0.12, 0]} color="#cfcbc2" />
    </group>
  )
}

function Door({ o, tint }: { o: Placed; tint: string | null }) {
  if (o.defId === 'door_glass') return <GlassDoorInterior o={o} tint={tint} />
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
  // Fire exit: steel leaf in a steel frame with a panic push bar
  if (o.defId === 'door_fire') {
    const t = Math.max(0.16, Math.min(o.d, 0.3))
    return (
      <group>
        <Alu args={[0.09, o.h, t]} pos={[-o.w / 2 + 0.045, o.h / 2, 0]} color="#7c828a" />
        <Alu args={[0.09, o.h, t]} pos={[o.w / 2 - 0.045, o.h / 2, 0]} color="#7c828a" />
        <Alu args={[o.w, 0.1, t]} pos={[0, o.h - 0.05, 0]} color="#7c828a" />
        <Box args={[o.w - 0.2, o.h - 0.14, 0.06]} pos={[0, (o.h - 0.14) / 2, 0]} color={tint ?? '#9aa2ab'} />
        {/* panic bar */}
        <Alu args={[o.w - 0.34, 0.07, 0.09]} pos={[0, o.h * 0.42, 0.08]} color={tint ?? '#c0392b'} />
        <Box args={[o.w - 0.3, 0.16, 0.02]} pos={[0, o.h * 0.86, 0.045]} color="#2f9e44" />
      </group>
    )
  }
  // Main entrance: aluminium-framed glass storefront door (double leaf when
  // wide enough), with full-height pull handles and kick plates.
  const t = Math.max(0.12, Math.min(o.d, 0.3))
  const leaves = o.w > 1.6 ? 2 : 1
  const leafW = (o.w - 0.14 - (leaves - 1) * 0.03) / leaves
  const leafH = o.h - 0.12
  return (
    <group>
      {/* outer frame */}
      <Alu args={[0.07, o.h, t]} pos={[-o.w / 2 + 0.035, o.h / 2, 0]} />
      <Alu args={[0.07, o.h, t]} pos={[o.w / 2 - 0.035, o.h / 2, 0]} />
      <Alu args={[o.w, 0.09, t]} pos={[0, o.h - 0.045, 0]} />
      {Array.from({ length: leaves }, (_, i) => {
        const cx = -o.w / 2 + 0.07 + leafW * (i + 0.5) + i * 0.03
        const handleX = leaves === 2 ? (i === 0 ? leafW / 2 - 0.12 : -leafW / 2 + 0.12) : leafW / 2 - 0.14
        return (
          <group key={i} position={[cx, 0, 0]}>
            {/* glass pane */}
            <mesh position={[0, leafH / 2 + 0.02, 0]} castShadow>
              <boxGeometry args={[leafW - 0.08, leafH - 0.3, 0.025]} />
              <meshStandardMaterial color="#bfe0ea" transparent opacity={0.3} roughness={0.06} metalness={0.1} depthWrite={false} />
            </mesh>
            {/* leaf stiles + rails */}
            <Alu args={[0.05, leafH, 0.05]} pos={[-leafW / 2 + 0.025, leafH / 2 + 0.02, 0]} />
            <Alu args={[0.05, leafH, 0.05]} pos={[leafW / 2 - 0.025, leafH / 2 + 0.02, 0]} />
            <Alu args={[leafW, 0.05, 0.05]} pos={[0, leafH - 0.005, 0]} />
            {/* kick plate */}
            <Alu args={[leafW, 0.26, 0.055]} pos={[0, 0.15, 0]} />
            {/* vertical pull handles, both faces */}
            <Alu args={[0.03, 0.75, 0.03]} pos={[handleX, o.h * 0.48, 0.09]} color="#8f959c" />
            <Alu args={[0.03, 0.75, 0.03]} pos={[handleX, o.h * 0.48, -0.09]} color="#8f959c" />
          </group>
        )
      })}
      {tint && <Box args={[o.w, 0.06, t + 0.02]} pos={[0, 0.03, 0]} color={tint} />}
    </group>
  )
}

// brushed-aluminium box, the framing material for storefront doors etc.
function Alu({
  args,
  pos,
  color = '#c9ced4',
  rot,
}: {
  args: [number, number, number]
  pos: [number, number, number]
  color?: string
  rot?: [number, number, number]
}) {
  return (
    <mesh position={pos} rotation={rot} castShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
    </mesh>
  )
}

// A wall designed on the Wall Design page, scaled to the placed dimensions
function CustomWallObject({ o, tint }: { o: Placed; tint: string | null }) {
  const design = useWallStore((s) => s.designs.find((d) => `custom:${d.id}` === o.defId))
  if (!design)
    return <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
  const sx = o.w / Math.max(0.1, designWidth(design))
  const sy = o.h / Math.max(0.1, design.height)
  const sz = o.d / Math.max(0.1, designDepth(design))
  // a recolored instance (inspector edit or theme) overrides the design color
  const colorTint = tint ?? (o.color && o.color !== design.color ? o.color : null)
  return (
    <group scale={[sx, sy, sz]} position={[0, 0, 0]}>
      <group position={[0, 0, 0]}>
        <WallModel design={design} tint={colorTint} />
      </group>
    </group>
  )
}

/* -------------------------- ceiling & HVAC -------------------------- */

// Suspended ceiling panel. H is the MOUNT height of the panel underside, so
// the green height arrow tunes the ceiling level to match adjacent wall tops.
function CeilingPanel({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(0.5, o.h)
  const tiles = useMemo(() => {
    const xs = spread(Math.max(1, Math.round(o.w / 1.2)) - 1, o.w).map((v) => v + o.w / (2 * Math.max(1, Math.round(o.w / 1.2))))
    const zs = spread(Math.max(1, Math.round(o.d / 1.2)) - 1, o.d).map((v) => v + o.d / (2 * Math.max(1, Math.round(o.d / 1.2))))
    return { xs: xs.filter((v) => Math.abs(v) < o.w / 2 - 0.05), zs: zs.filter((v) => Math.abs(v) < o.d / 2 - 0.05) }
  }, [o.w, o.d])
  return (
    <group>
      <mesh position={[0, y + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w, 0.1, o.d]} />
        <meshStandardMaterial color={tint ?? o.color} {...MAT} />
        <Edges color="#c9c2b4" />
      </mesh>
      {/* T-bar grid lines on the underside */}
      {tiles.xs.map((x, i) => (
        <Box key={`x${i}`} args={[0.03, 0.02, o.d]} pos={[x, y - 0.012, 0]} color="#cfc9bc" />
      ))}
      {tiles.zs.map((z, i) => (
        <Box key={`z${i}`} args={[o.w, 0.02, 0.03]} pos={[0, y - 0.012, z]} color="#cfc9bc" />
      ))}
      {/* hanger rods at the corners */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box key={i} args={[0.04, 0.7, 0.04]} pos={[(sx * (o.w - 0.4)) / 2, y + 0.45, (sz * (o.d - 0.4)) / 2]} color={STEEL} />
      ))}
    </group>
  )
}

// Glass panel with frame + mullions, shared by partitions and bulkheads.
function GlassPanel({ w, h, t, tint }: { w: number; h: number; t: number; tint: string | null }) {
  const posts = useMemo(() => spread(Math.max(2, Math.round(w / 1.2)), w - 0.06), [w])
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[w, h, Math.max(0.02, t * 0.35)]} />
        <meshStandardMaterial color={tint ?? '#bfe0ea'} transparent opacity={0.25} roughness={0.08} metalness={0.1} depthWrite={false} />
      </mesh>
      <Box args={[w, 0.06, t]} pos={[0, h / 2 - 0.03, 0]} color="#3f454d" />
      <Box args={[w, 0.06, t]} pos={[0, -h / 2 + 0.03, 0]} color="#3f454d" />
      {posts.map((x, i) => (
        <Box key={i} args={[0.05, h, t]} pos={[x, 0, 0]} color="#3f454d" />
      ))}
    </group>
  )
}

// Vertical ceiling / bulkhead: a partition-like panel hanging DOWN from the
// roof. H is the height of its BOTTOM edge (line it up with wall tops); the
// panel extends `drop` meters upward from there, with hanger rods on top.
function Bulkhead({ o, tint }: { o: Placed; tint: string | null }) {
  const bottom = Math.max(0.3, o.h)
  const drop = clampN(o.drop ?? 1.5, 0.3, 12)
  const t = Math.max(0.08, o.d)
  const rods = useMemo(() => spread(Math.max(2, Math.round(o.w / 2)), o.w - 0.3), [o.w])
  return (
    <group position={[0, bottom + drop / 2, 0]}>
      {o.material === 'glass' ? (
        <GlassPanel w={o.w} h={drop} t={t} tint={tint} />
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[o.w, drop, t]} />
          <meshStandardMaterial color={tint ?? o.color} {...MAT} />
          <Edges color="#c9c2b4" />
        </mesh>
      )}
      {rods.map((x, i) => (
        <Box key={i} args={[0.04, 0.7, 0.04]} pos={[x, drop / 2 + 0.35, 0]} color={STEEL} />
      ))}
    </group>
  )
}

// Galvanized supply duct run at mount height H with joint rings and diffusers.
// Chain several runs (45° rotation steps) to route a full system.
function AirDuct({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(0.6, o.h)
  const sec = clampN(o.d, 0.3, 1.2)
  const joints = useMemo(() => spread(Math.max(1, Math.round(o.w / 1.5)), o.w - 0.2), [o.w])
  const vents = useMemo(() => spread(Math.max(1, Math.round(o.w / 2.5)), o.w - 0.8), [o.w])
  const metal = tint ?? o.color
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow>
        <boxGeometry args={[o.w, sec * 0.7, sec]} />
        <meshStandardMaterial color={metal} roughness={0.45} metalness={0.55} />
      </mesh>
      {joints.map((x, i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <boxGeometry args={[0.06, sec * 0.7 + 0.05, sec + 0.05]} />
          <meshStandardMaterial color="#8f959c" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
      {/* ceiling diffusers blowing down */}
      {vents.map((x, i) => (
        <group key={`v${i}`} position={[x, -sec * 0.35 - 0.05, 0]}>
          <Box args={[0.45, 0.1, 0.45]} pos={[0, 0, 0]} color={WHITE} />
          <Box args={[0.3, 0.04, 0.3]} pos={[0, -0.06, 0]} color="#d6d3cb" />
        </group>
      ))}
      {/* hanger rods */}
      {joints.map((x, i) => (
        <Box key={`h${i}`} args={[0.03, 0.8, 0.03]} pos={[x, sec * 0.35 + 0.4, 0]} color={STEEL} />
      ))}
    </group>
  )
}

// Indoor unit (คอยล์เย็น): wall/ceiling-hung cassette at mount height H.
function CoolingCoil({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(0.5, o.h)
  const body = tint ?? o.color
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow>
        <boxGeometry args={[o.w, 0.36, o.d]} />
        <meshStandardMaterial color={body} roughness={0.6} />
        <Edges color="#c6cad0" />
      </mesh>
      {/* louver + indicator */}
      <Box args={[o.w - 0.1, 0.06, 0.05]} pos={[0, -0.13, o.d / 2 + 0.01]} color="#9aa2ab" />
      <Box args={[0.08, 0.03, 0.02]} pos={[o.w / 2 - 0.15, 0.08, o.d / 2 + 0.02]} color="#22c55e" />
      {/* refrigerant pipes running up */}
      <Box args={[0.05, 0.9, 0.05]} pos={[-o.w / 2 + 0.12, 0.6, -o.d / 4]} color="#8f959c" />
      <Box args={[0.05, 0.9, 0.05]} pos={[-o.w / 2 + 0.24, 0.6, -o.d / 4]} color="#b9bec5" />
    </group>
  )
}

// Outdoor condensing unit (คอยล์ร้อน) on a small pad, fan grille facing front.
function Condenser({ o, tint }: { o: Placed; tint: string | null }) {
  const body = tint ?? o.color
  const h = clampN(o.h, 0.5, 1.6)
  return (
    <group>
      <Box args={[o.w + 0.1, 0.08, o.d + 0.1]} pos={[0, 0.04, 0]} color="#b8b4aa" />
      <mesh position={[0, 0.08 + h / 2, 0]} castShadow>
        <boxGeometry args={[o.w, h, o.d]} />
        <meshStandardMaterial color={body} roughness={0.55} />
        <Edges color="#aab0b6" />
      </mesh>
      {/* fan grille */}
      <mesh position={[0, 0.08 + h * 0.55, o.d / 2 + 0.01]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[Math.min(o.w, h) * 0.32, Math.min(o.w, h) * 0.32, 0.04, 20]} />
        <meshStandardMaterial color="#3f454d" roughness={0.6} />
      </mesh>
      {/* side louvers */}
      {spread(4, h * 0.7).map((yy, i) => (
        <Box key={i} args={[o.w - 0.08, 0.02, 0.02]} pos={[0, 0.08 + h / 2 + yy, -o.d / 2 - 0.01]} color="#9aa2ab" />
      ))}
    </group>
  )
}

// HVLS big ceiling fan: drop rod from above, hub and long blades at height H.
function BigFan({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(2.5, o.h)
  const r = Math.max(o.w, o.d) / 2
  const color = tint ?? o.color
  return (
    <group position={[0, y, 0]}>
      <Box args={[0.08, 1.0, 0.08]} pos={[0, 0.62, 0]} color={STEEL} />
      <mesh castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.3, 14]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={i} rotation-y={(i * Math.PI) / 3}>
          <Box args={[r - 0.3, 0.04, 0.22]} pos={[(r - 0.3) / 2 + 0.25, -0.02, 0]} color="#c8cdd3" rot={[0, 0, 0.06]} />
        </group>
      ))}
    </group>
  )
}

// Pedestal fan on the floor.
function FloorFan({ o, tint }: { o: Placed; tint: string | null }) {
  const h = clampN(o.h, 0.8, 2.2)
  const r = clampN(Math.min(o.w, o.d) * 0.45, 0.2, 0.5)
  const color = tint ?? o.color
  return (
    <group>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[r * 0.9, r, 0.06, 16]} />
        <meshStandardMaterial color={color} {...MAT} />
      </mesh>
      <Box args={[0.06, h - r - 0.1, 0.06]} pos={[0, (h - r) / 2, 0]} color="#6b7280" />
      {/* head cage + blades */}
      <group position={[0, h - r * 0.6, 0]}>
        <mesh rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[r, r, 0.16, 20]} />
          <meshStandardMaterial color="#9aa2ab" roughness={0.5} transparent opacity={0.45} />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[r * 0.25, r * 0.25, 0.18, 12]} />
          <meshStandardMaterial color={color} {...MAT} />
        </mesh>
        {Array.from({ length: 4 }, (_, i) => (
          <group key={i} rotation-z={(i * Math.PI) / 2 + 0.4}>
            <Box args={[r * 0.75, r * 0.4, 0.02]} pos={[r * 0.5, 0, 0]} color="#d3d7db" />
          </group>
        ))}
      </group>
    </group>
  )
}

/* ------------------------------ site & outdoors ------------------------------ */

// Trees with real foliage: hundreds of instanced leaf clumps in varied
// greens scattered around branch tips, over a trunk with a few branches —
// reads like an archviz tree instead of a cartoon blob.
// Deterministic per-instance randomness so vegetation doesn't shimmer on rerender
function seededRnd(id: string) {
  let s = 7
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) & 0x7fffffff
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

type Clump = { p: [number, number, number]; s: number; e: [number, number, number]; c: THREE.Color }

// Instanced flat-shaded leaf tufts: squashed, randomly rotated low-poly blobs
// with per-instance shading read as foliage rather than clay balls.
function LeafClumps({ list }: { list: Clump[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const M = new THREE.Matrix4()
    const P = new THREE.Vector3()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3()
    const E = new THREE.Euler()
    list.forEach((l, i) => {
      P.set(...l.p)
      E.set(...l.e)
      Q.setFromEuler(E)
      S.set(l.s, l.s * 0.62, l.s)
      M.compose(P, Q, S)
      m.setMatrixAt(i, M)
      m.setColorAt(i, l.c)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [list])
  return (
    <instancedMesh key={list.length} ref={ref} args={[undefined, undefined, list.length]} castShadow>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#ffffff" roughness={0.92} flatShading />
    </instancedMesh>
  )
}

// A tapered branch cylinder between two points
function BranchSeg({ p0, p1, r0, r1 }: { p0: [number, number, number]; p1: [number, number, number]; r0: number; r1: number }) {
  const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
  const len = d.length()
  return (
    <mesh
      position={[(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]}
      quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())}
      castShadow
    >
      <cylinderGeometry args={[r1, r0, len, 7]} />
      <meshStandardMaterial color="#66513a" roughness={0.92} />
    </mesh>
  )
}

// Tree with a real branch skeleton: trunk → primary limbs → secondary twigs,
// with separate leaf clusters hanging at the branch TIPS, so the branching
// structure stays visible through the crown instead of one solid blob.
function Tree({ o, tint }: { o: Placed; tint: string | null }) {
  const big = o.defId === 'tree_big'
  const h = o.h
  const r = Math.min(o.w, o.d) / 2

  const { limbs, leaves, trunkH } = useMemo(() => {
    const rnd = seededRnd(o.id)
    const base = new THREE.Color(tint ?? o.color)
    const tH = h * (big ? 0.34 : 0.3)
    type LimbT = { p0: [number, number, number]; p1: [number, number, number]; r0: number; r1: number }
    const limbList: LimbT[] = []
    const tips: Array<{ p: [number, number, number]; R: number }> = []
    const nP = big ? 5 : 4
    for (let i = 0; i < nP; i++) {
      const a = (i / nP) * Math.PI * 2 + rnd() * 0.9
      const tilt = 0.5 + rnd() * 0.5 // 29°–57° off vertical
      const len1 = (h - tH) * (0.5 + rnd() * 0.28)
      const d1 = [Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)]
      const p0: [number, number, number] = [(rnd() - 0.5) * r * 0.12, tH * (0.7 + rnd() * 0.28), (rnd() - 0.5) * r * 0.12]
      const p1: [number, number, number] = [p0[0] + d1[0] * len1, p0[1] + d1[1] * len1, p0[2] + d1[2] * len1]
      limbList.push({ p0, p1, r0: r * 0.06, r1: r * 0.026 })
      tips.push({ p: p1, R: r * (big ? 0.4 : 0.44) })
      // two twigs branching off each limb, each carrying a smaller cluster
      for (let k = 0; k < 2; k++) {
        const t0 = 0.45 + rnd() * 0.35
        const q0: [number, number, number] = [p0[0] + d1[0] * len1 * t0, p0[1] + d1[1] * len1 * t0, p0[2] + d1[2] * len1 * t0]
        const a2 = a + (rnd() - 0.5) * 2.4
        const tilt2 = Math.min(1.3, tilt + 0.2 + rnd() * 0.45)
        const dv = new THREE.Vector3(Math.sin(tilt2) * Math.cos(a2), Math.cos(tilt2) * (0.7 + rnd() * 0.5), Math.sin(tilt2) * Math.sin(a2)).normalize()
        const len2 = len1 * (0.45 + rnd() * 0.3)
        const q1: [number, number, number] = [q0[0] + dv.x * len2, q0[1] + dv.y * len2, q0[2] + dv.z * len2]
        limbList.push({ p0: q0, p1: q1, r0: r * 0.024, r1: r * 0.011 })
        tips.push({ p: q1, R: r * (big ? 0.28 : 0.3) })
      }
    }
    // leaf clusters at the branch tips (flattened, shaded darker underneath)
    const yTop = Math.max(...tips.map((t) => t.p[1] + t.R))
    const yBot = Math.min(...tips.map((t) => t.p[1] - t.R))
    const list: Clump[] = []
    for (const tip of tips) {
      const n = Math.round(tip.R * (big ? 62 : 55))
      for (let i = 0; i < n; i++) {
        const th = rnd() * Math.PI * 2
        const ph = Math.acos(2 * rnd() - 1)
        const rad = tip.R * (0.35 + 0.65 * Math.sqrt(rnd()))
        const p: [number, number, number] = [
          tip.p[0] + rad * Math.sin(ph) * Math.cos(th),
          tip.p[1] + rad * Math.cos(ph) * 0.6,
          tip.p[2] + rad * Math.sin(ph) * Math.sin(th),
        ]
        const t = Math.min(1, Math.max(0, (p[1] - yBot) / Math.max(0.1, yTop - yBot)))
        list.push({
          p,
          s: r * (0.075 + rnd() * 0.065),
          e: [rnd() * 0.9 - 0.45, rnd() * Math.PI * 2, rnd() * 0.9 - 0.45],
          c: base.clone().offsetHSL((rnd() - 0.5) * 0.035, -0.06 + rnd() * 0.08, -0.17 + t * 0.22 + rnd() * 0.06),
        })
      }
    }
    return { limbs: limbList, leaves: list, trunkH: tH }
  }, [o.id, o.color, tint, big, h, r])

  return (
    <group>
      {/* trunk with a root flare */}
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.075, r * 0.13, trunkH, 9]} />
        <meshStandardMaterial color="#66513a" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[r * 0.13, r * 0.2, 0.12, 9]} />
        <meshStandardMaterial color="#5c4933" roughness={0.95} />
      </mesh>
      {limbs.map((l, i) => (
        <BranchSeg key={i} {...l} />
      ))}
      <LeafClumps list={leaves} />
    </group>
  )
}

function Fence({ o, tint }: { o: Placed; tint: string | null }) {
  const posts = useMemo(() => spread(Math.max(2, Math.round(o.w / 1.5)), o.w - 0.1), [o.w])
  const c = tint ?? o.color
  return (
    <group>
      {posts.map((x, i) => (
        <Box key={i} args={[0.07, o.h, 0.07]} pos={[x, o.h / 2, 0]} color={c} />
      ))}
      <Box args={[o.w, 0.06, 0.04]} pos={[0, o.h - 0.06, 0]} color={c} />
      <Box args={[o.w, 0.06, 0.04]} pos={[0, o.h * 0.45, 0]} color={c} />
      {/* vertical infill bars */}
      {spread(Math.max(4, Math.round(o.w / 0.18)), o.w - 0.2).map((x, i) => (
        <Box key={`b${i}`} args={[0.025, o.h - 0.15, 0.025]} pos={[x, (o.h - 0.15) / 2 + 0.05, 0]} color={c} />
      ))}
    </group>
  )
}

// Trimmed hedge: a dark leafy core with hundreds of small leaf tufts scattered
// over the clipped faces, so it reads as foliage rather than a painted box.
function Hedge({ o, tint }: { o: Placed; tint: string | null }) {
  const list = useMemo(() => {
    const rnd = seededRnd(o.id)
    const base = new THREE.Color(tint ?? o.color)
    const hw = o.w / 2
    const hd = o.d / 2
    const out: Clump[] = []
    // spread tufts over the faces, weighted by face area (top, sides, ends)
    const aTop = o.w * o.d
    const aSide = o.w * o.h * 2
    const aEnd = o.d * o.h * 2
    const aSum = aTop + aSide + aEnd
    const n = Math.round(clampN((aTop + aSide / 2 + aEnd / 2) * 55, 80, 420))
    for (let i = 0; i < n; i++) {
      const f = rnd() * aSum
      let p: [number, number, number]
      if (f < aTop) p = [(rnd() - 0.5) * o.w, o.h - 0.03, (rnd() - 0.5) * o.d]
      else if (f < aTop + aSide) p = [(rnd() - 0.5) * o.w, 0.08 + rnd() * (o.h - 0.14), (rnd() > 0.5 ? 1 : -1) * hd]
      else p = [(rnd() > 0.5 ? 1 : -1) * hw, 0.08 + rnd() * (o.h - 0.14), (rnd() - 0.5) * o.d]
      const t = p[1] / o.h
      out.push({
        p,
        s: 0.08 + rnd() * 0.06,
        e: [rnd() * 0.9 - 0.45, rnd() * Math.PI * 2, rnd() * 0.9 - 0.45],
        c: base.clone().offsetHSL((rnd() - 0.5) * 0.03, -0.04 + rnd() * 0.06, -0.14 + t * 0.18 + rnd() * 0.06),
      })
    }
    return out
  }, [o.id, o.w, o.d, o.h, o.color, tint])
  return (
    <group>
      <mesh position={[0, o.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[o.w - 0.08, o.h - 0.06, o.d - 0.08]} />
        <meshStandardMaterial color={new THREE.Color(tint ?? o.color).offsetHSL(0, 0, -0.12)} roughness={0.95} />
      </mesh>
      <LeafClumps list={list} />
    </group>
  )
}

// Site light: pole + arm + lamp head; glows and casts real light at night.
function LightPole({ o, tint }: { o: Placed; tint: string | null }) {
  const night = useStore((s) => s.lightMood === 'night')
  const c = tint ?? o.color
  return (
    <group>
      <mesh position={[0, o.h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.07, o.h, 10]} />
        <meshStandardMaterial color={c} roughness={0.6} />
      </mesh>
      <Box args={[0.5, 0.05, 0.05]} pos={[0.25, o.h - 0.08, 0]} color={c} />
      <mesh position={[0.48, o.h - 0.14, 0]}>
        <boxGeometry args={[0.34, 0.09, 0.2]} />
        <meshStandardMaterial
          color="#e8e4d8"
          emissive={night ? '#ffe9b0' : '#000000'}
          emissiveIntensity={night ? 1.6 : 0}
          roughness={0.5}
        />
      </mesh>
      {night && <pointLight position={[0.48, o.h - 0.3, 0]} color="#ffe0a3" intensity={26} distance={14} decay={1.9} />}
    </group>
  )
}

function Wheel({ pos, r }: { pos: [number, number, number]; r: number }) {
  return (
    <group position={pos} rotation-x={Math.PI / 2}>
      <mesh castShadow>
        <cylinderGeometry args={[r, r, 0.18, 18]} />
        <meshStandardMaterial color="#1a1c20" roughness={0.95} />
      </mesh>
      {[0.08, -0.08].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <cylinderGeometry args={[r * 0.55, r * 0.55, 0.04, 14]} />
          <meshStandardMaterial color="#aeb4bb" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

// Realistic parking-lot paints. Cars that still carry the old default blue get
// a stable per-instance paint from this palette (a lot of identical bright-blue
// cars reads as toys); a color chosen in the inspector is respected.
const CAR_PAINTS = ['#d8dadd', '#c4c8cd', '#22262b', '#3a4552', '#711f26', '#20344d', '#e9e7e1', '#8b939c']
const CAR_DEFAULT_COLORS = new Set(['#5b7fb4', '#60a5fa'])

function CarWheel({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos} rotation-x={Math.PI / 2}>
      <mesh castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.23, 20]} />
        <meshStandardMaterial color="#17191c" roughness={0.95} />
      </mesh>
      {[0.1, -0.1].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 16]} />
          <meshStandardMaterial color="#b7bdc4" metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

// Parked car — rotate in 45° steps to angle-park it. The body is a rounded
// extrusion of a real side silhouette (bumpers, hood, belt line, wheel arches)
// with an inset dark glasshouse on top, instead of stacked boxes.
function Car({ o, tint }: { o: Placed; tint: string | null }) {
  let body = tint ?? o.color
  if (!tint && CAR_DEFAULT_COLORS.has(o.color)) {
    let hsh = 0
    for (let i = 0; i < o.id.length; i++) hsh = (hsh * 31 + o.id.charCodeAt(i)) & 0x7fffffff
    body = CAR_PAINTS[hsh % CAR_PAINTS.length]
  }
  const L = o.w
  const W = o.d
  const wx = L * 0.3 // wheel positions along the length
  const { bodyGeo, glassGeo } = useMemo(() => {
    const archR = 0.37
    const belt = 0.86
    // side profile: x = along the car (front at +x), y = up — gentle curves
    // everywhere so the massing reads like pressed sheet metal, not slabs
    const b = new THREE.Shape()
    b.moveTo(-L * 0.44, 0.26)
    b.lineTo(-wx - archR, 0.26)
    b.absarc(-wx, 0.26, archR, Math.PI, 0, true)
    b.lineTo(wx - archR, 0.26)
    b.absarc(wx, 0.26, archR, Math.PI, 0, true)
    b.lineTo(L * 0.46, 0.26)
    b.quadraticCurveTo(L * 0.5, 0.28, L * 0.5, 0.44) // front bumper
    b.lineTo(L * 0.5, 0.56)
    b.quadraticCurveTo(L * 0.5, 0.68, L * 0.42, 0.73) // nose rounds over
    b.quadraticCurveTo(L * 0.28, 0.79, L * 0.14, belt) // curved hood to the cowl
    b.quadraticCurveTo(-L * 0.15, belt + 0.035, -L * 0.42, belt) // belt line with a slight arc
    b.quadraticCurveTo(-L * 0.5, belt - 0.01, -L * 0.5, 0.72) // trunk edge
    b.lineTo(-L * 0.5, 0.42)
    b.quadraticCurveTo(-L * 0.5, 0.3, -L * 0.44, 0.26)
    b.closePath()
    // glasshouse: raked windscreen → curved roof → fastback rear window
    const g = new THREE.Shape()
    g.moveTo(L * 0.13, belt - 0.03)
    g.lineTo(-L * 0.03, 1.22)
    g.quadraticCurveTo(-L * 0.15, 1.26, -L * 0.26, 1.22)
    g.lineTo(-L * 0.41, belt - 0.03)
    g.closePath()
    const opts = (depth: number, bev: number) => ({
      depth,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 3,
      curveSegments: 10,
    })
    const bg = new THREE.ExtrudeGeometry(b, opts(W - 0.34, 0.09))
    bg.translate(0, 0, -(W - 0.34) / 2)
    const gg = new THREE.ExtrudeGeometry(g, opts(W - 0.62, 0.06))
    gg.translate(0, 0, -(W - 0.62) / 2)
    return { bodyGeo: bg, glassGeo: gg }
  }, [L, W, wx])
  return (
    <group>
      <mesh geometry={bodyGeo} castShadow>
        <meshPhysicalMaterial color={body} roughness={0.32} metalness={0.25} clearcoat={0.9} clearcoatRoughness={0.15} />
      </mesh>
      <mesh geometry={glassGeo} castShadow>
        <meshStandardMaterial color="#141d26" roughness={0.06} metalness={0.35} />
      </mesh>
      {/* painted roof panel on top of the glasshouse */}
      <Box args={[L * 0.22, 0.035, W - 0.54]} pos={[-L * 0.145, 1.285, 0]} color={body} />
      <CarWheel pos={[wx, 0.3, W / 2 - 0.2]} />
      <CarWheel pos={[wx, 0.3, -W / 2 + 0.2]} />
      <CarWheel pos={[-wx, 0.3, W / 2 - 0.2]} />
      <CarWheel pos={[-wx, 0.3, -W / 2 + 0.2]} />
      {/* grille, plates, lights, mirrors, door handles */}
      <Box args={[0.04, 0.13, W * 0.42]} pos={[L / 2 + 0.05, 0.5, 0]} color="#1c1f24" />
      <Box args={[0.02, 0.11, 0.32]} pos={[L / 2 + 0.08, 0.35, 0]} color="#e7e9ec" />
      <Box args={[0.02, 0.11, 0.32]} pos={[-L / 2 - 0.08, 0.35, 0]} color="#e7e9ec" />
      {[1, -1].map((s) => (
        <group key={s}>
          <Box args={[0.06, 0.09, 0.36]} pos={[L / 2 + 0.05, 0.66, s * W * 0.27]} color="#eef3f7" />
          <Box args={[0.06, 0.08, 0.3]} pos={[-L / 2 - 0.06, 0.7, s * W * 0.27]} color="#8f1f1a" />
          <Box args={[0.1, 0.06, 0.16]} pos={[L * 0.11, 0.92, s * (W / 2 + 0.03)]} color={body} />
          <Box args={[0.15, 0.03, 0.03]} pos={[0, 0.76, s * (W / 2 - 0.035)]} color="#33383e" />
          <Box args={[0.15, 0.03, 0.03]} pos={[-L * 0.24, 0.76, s * (W / 2 - 0.035)]} color="#33383e" />
        </group>
      ))}
    </group>
  )
}

function Motorcycle({ o, tint }: { o: Placed; tint: string | null }) {
  const body = tint ?? o.color
  const L = o.w
  return (
    <group>
      <Wheel pos={[L * 0.36, 0.3, 0]} r={0.3} />
      <Wheel pos={[-L * 0.36, 0.3, 0]} r={0.3} />
      {/* frame spine, rounded fuel tank, stepped seat */}
      <Box args={[L * 0.5, 0.16, 0.2]} pos={[0, 0.58, 0]} color="#3a3f45" rot={[0, 0, 0.08]} />
      <mesh position={[L * 0.1, 0.74, 0]} castShadow>
        <sphereGeometry args={[0.17, 12, 10]} />
        <meshStandardMaterial color={body} roughness={0.3} metalness={0.3} />
      </mesh>
      <Box args={[L * 0.28, 0.08, 0.22]} pos={[-L * 0.14, 0.74, 0]} color="#1c1f24" />
      <Box args={[L * 0.12, 0.06, 0.2]} pos={[-L * 0.3, 0.8, 0]} color="#1c1f24" />
      {/* front fork + handlebar with grips, mirrors */}
      <Alu args={[0.035, 0.55, 0.035]} pos={[L * 0.31, 0.6, 0.07]} rot={[0, 0, -0.45]} color="#c9ced4" />
      <Alu args={[0.035, 0.55, 0.035]} pos={[L * 0.31, 0.6, -0.07]} rot={[0, 0, -0.45]} color="#c9ced4" />
      <Alu args={[0.03, 0.03, 0.5]} pos={[L * 0.22, 0.94, 0]} color="#2b2f35" />
      <Alu args={[0.02, 0.14, 0.02]} pos={[L * 0.2, 1.02, 0.16]} color="#6b7280" />
      <Box args={[0.06, 0.04, 0.03]} pos={[L * 0.2, 1.1, 0.16]} color="#2b2f35" />
      {/* exhaust + headlight */}
      <mesh position={[-L * 0.22, 0.42, 0.12]} rotation-z={Math.PI / 2 - 0.08} castShadow>
        <cylinderGeometry args={[0.045, 0.055, L * 0.5, 10]} />
        <meshStandardMaterial color="#b9c0c7" roughness={0.25} metalness={0.7} />
      </mesh>
      <mesh position={[L * 0.38, 0.78, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, 0.06, 12]} />
        <meshStandardMaterial color="#fff3cf" roughness={0.3} />
      </mesh>
      {/* kickstand */}
      <Alu args={[0.02, 0.34, 0.02]} pos={[-L * 0.08, 0.18, 0.14]} rot={[0.35, 0, 0.2]} color="#6b7280" />
    </group>
  )
}

// Open carport: posts + gently sloped corrugated roof, cars park underneath.
function Carport({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const slope = 0.08
  const ribs = useMemo(() => spread(Math.max(3, Math.round(o.w / 0.9)), o.w - 0.2), [o.w])
  return (
    <group>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <Box
          key={i}
          args={[0.1, o.h - (sz > 0 ? o.d * slope : 0), 0.1]}
          pos={[(sx * (o.w - 0.3)) / 2, (o.h - (sz > 0 ? o.d * slope : 0)) / 2, (sz * (o.d - 0.3)) / 2]}
          color={STEEL}
        />
      ))}
      <group position={[0, o.h - (o.d * slope) / 2, 0]} rotation-x={Math.atan(slope)}>
        <Box args={[o.w, 0.06, o.d + 0.3]} pos={[0, 0, 0]} color={c} />
        {ribs.map((x, i) => (
          <Box key={i} args={[0.08, 0.05, o.d + 0.3]} pos={[x, 0.05, 0]} color="#848d97" />
        ))}
      </group>
    </group>
  )
}

/* --------------------------- lighting & AV (tech) --------------------------- */

// UFO high-bay LED: drop rod, finned disc housing, glowing lens. Lights the
// hall for real in the Night mood.
function HighBay({ o, tint }: { o: Placed; tint: string | null }) {
  const night = useStore((s) => s.lightMood === 'night')
  const y = Math.max(2, o.h)
  const r = Math.max(0.16, Math.min(o.w, o.d) / 2)
  return (
    <group position={[0, y, 0]}>
      <Alu args={[0.035, 0.6, 0.035]} pos={[0, 0.42, 0]} color="#4b5563" />
      <mesh castShadow>
        <cylinderGeometry args={[r, r * 0.82, 0.16, 18]} />
        <meshStandardMaterial color={tint ?? o.color} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -0.09, 0]}>
        <cylinderGeometry args={[r * 0.72, r * 0.72, 0.03, 18]} />
        <meshStandardMaterial color="#fffbe8" emissive={night ? '#ffedb8' : '#f2ecd8'} emissiveIntensity={night ? 2 : 0.5} roughness={0.3} />
      </mesh>
      {night && <pointLight position={[0, -0.3, 0]} color="#ffe9bb" intensity={40} distance={18} decay={1.9} />}
    </group>
  )
}

// Track light: rail with angled cylindrical spot heads.
function TrackLight({ o, tint }: { o: Placed; tint: string | null }) {
  const night = useStore((s) => s.lightMood === 'night')
  const y = Math.max(1.5, o.h)
  const heads = useMemo(() => spread(Math.max(2, Math.round(o.w / 0.65)), o.w - 0.3), [o.w])
  return (
    <group position={[0, y, 0]}>
      <Box args={[o.w, 0.05, 0.06]} pos={[0, 0, 0]} color={tint ?? o.color} />
      <Alu args={[0.03, 0.35, 0.03]} pos={[-o.w / 2 + 0.1, 0.19, 0]} color="#4b5563" />
      <Alu args={[0.03, 0.35, 0.03]} pos={[o.w / 2 - 0.1, 0.19, 0]} color="#4b5563" />
      {heads.map((x, i) => (
        <group key={i} position={[x, -0.1, 0]} rotation-x={i % 2 ? 0.5 : -0.4} rotation-z={i % 3 === 0 ? 0.25 : 0}>
          <mesh castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.16, 12]} />
            <meshStandardMaterial color={tint ?? o.color} roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, -0.085, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.012, 12]} />
            <meshStandardMaterial color="#fff6d8" emissive={night ? '#ffe9b0' : '#efe7cf'} emissiveIntensity={night ? 1.8 : 0.4} />
          </mesh>
        </group>
      ))}
      {night && <pointLight position={[0, -0.5, 0.4]} color="#ffe9bb" intensity={16} distance={10} decay={1.9} />}
    </group>
  )
}

// CCTV dome/bullet camera on a mount arm, angled down.
function Cctv({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(1.5, o.h)
  const c = tint ?? o.color
  return (
    <group position={[0, y, 0]}>
      <Alu args={[0.05, 0.3, 0.05]} pos={[0, 0.15, 0]} color="#9aa2ab" />
      <Alu args={[0.05, 0.05, 0.22]} pos={[0, 0.02, 0.09]} color="#9aa2ab" />
      <group position={[0, -0.04, 0.2]} rotation-x={0.5}>
        <mesh castShadow>
          <boxGeometry args={[0.11, 0.11, 0.3]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.16]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.045, 0.05, 0.05, 12]} />
          <meshStandardMaterial color="#16181c" roughness={0.2} />
        </mesh>
        <Box args={[0.02, 0.02, 0.02]} pos={[0.035, 0.045, 0.12]} color="#dc2626" />
        {/* sun hood */}
        <Box args={[0.13, 0.02, 0.32]} pos={[0, 0.065, 0.01]} color={c} />
      </group>
    </group>
  )
}

// PA speaker cabinet on a wall bracket, angled down toward the floor.
function SpeakerBox({ o, tint }: { o: Placed; tint: string | null }) {
  const y = Math.max(1.2, o.h)
  const c = tint ?? o.color
  return (
    <group position={[0, y, 0]}>
      <Alu args={[0.04, 0.26, 0.04]} pos={[0, 0.1, -0.08]} color="#4b5563" />
      <group rotation-x={0.35}>
        <mesh castShadow>
          <boxGeometry args={[0.34, 0.5, 0.28]} />
          <meshStandardMaterial color={c} roughness={0.7} />
        </mesh>
        {/* woofer + tweeter behind a grille face */}
        <mesh position={[0, -0.06, 0.145]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.11, 0.11, 0.01, 16]} />
          <meshStandardMaterial color="#16181c" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.15, 0.145]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.01, 12]} />
          <meshStandardMaterial color="#16181c" roughness={0.9} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------ garden items ------------------------------ */

// Conifer (stacked cones) and columnar cypress tree shapes.
// Conifer + columnar cypress: dense leaf tufts hugging a cone / teardrop
// envelope instead of smooth solids, so the needle mass reads as foliage.
function Conifer({ o, tint }: { o: Placed; tint: string | null }) {
  const slim = o.defId === 'tree_slim'
  const r = Math.min(o.w, o.d) / 2
  const h = o.h

  const list = useMemo(() => {
    const rnd = seededRnd(o.id)
    const base = new THREE.Color(tint ?? o.color)
    const y0 = slim ? 0.22 : h * 0.14
    const n = slim ? 160 : 240
    const out: Clump[] = []
    for (let i = 0; i < n; i++) {
      // conifers are denser at the bottom; the cypress fills its column evenly
      const t = slim ? rnd() : Math.pow(rnd(), 0.72)
      const y = y0 + (h - y0 - 0.08) * t
      const tt = (y - y0) / (h - y0)
      // envelope radius at this height
      const R = slim ? r * 0.82 * Math.pow(Math.sin(Math.PI * (0.12 + tt * 0.86)), 0.6) : r * (1 - tt * 0.92)
      const a = rnd() * Math.PI * 2
      const rr = R * (0.45 + 0.55 * rnd())
      out.push({
        p: [Math.cos(a) * rr, y, Math.sin(a) * rr],
        s: (slim ? r * 0.34 : r * 0.2) * (0.65 + rnd() * 0.55),
        e: [rnd() * 0.9 - 0.45, rnd() * Math.PI * 2, rnd() * 0.9 - 0.45],
        c: base.clone().offsetHSL((rnd() - 0.5) * 0.025, -0.04 + rnd() * 0.06, -0.14 + tt * 0.16 + rnd() * 0.06),
      })
    }
    // tip tuft so the silhouette ends in a point
    out.push({
      p: [0, h - 0.06, 0],
      s: slim ? r * 0.22 : r * 0.12,
      e: [0, rnd() * Math.PI, 0],
      c: base.clone().offsetHSL(0, 0, 0.05),
    })
    return out
  }, [o.id, o.color, tint, slim, h, r])

  return (
    <group>
      <mesh position={[0, (slim ? 0.3 : h * 0.3) / 2, 0]} castShadow>
        <cylinderGeometry args={[r * (slim ? 0.12 : 0.1), r * 0.16, slim ? 0.3 : h * 0.3, 8]} />
        <meshStandardMaterial color="#6e5335" roughness={0.9} />
      </mesh>
      <LeafClumps list={list} />
    </group>
  )
}

// Garden pond: stone ring around still water.
function Pond({ o, tint }: { o: Placed; tint: string | null }) {
  const stones = useMemo(() => {
    const n = Math.max(10, Math.round((o.w + o.d) * 2.2))
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2
      return {
        x: Math.cos(a) * (o.w / 2 - 0.12),
        z: Math.sin(a) * (o.d / 2 - 0.12),
        s: 0.1 + ((i * 37) % 10) / 55,
        ry: i * 0.7,
      }
    })
  }, [o.w, o.d])
  return (
    <group>
      <mesh position={[0, 0.05, 0]} scale={[o.w / 2 - 0.15, 1, o.d / 2 - 0.15]}>
        <cylinderGeometry args={[1, 1, 0.1, 28]} />
        <meshStandardMaterial color={tint ?? o.color} roughness={0.08} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.01, 0]} scale={[o.w / 2, 1, o.d / 2]}>
        <cylinderGeometry args={[1, 1, 0.06, 28]} />
        <meshStandardMaterial color="#7a7266" roughness={0.95} />
      </mesh>
      {stones.map((s, i) => (
        <mesh key={i} position={[s.x, 0.1, s.z]} rotation-y={s.ry} castShadow>
          <icosahedronGeometry args={[s.s, 0]} />
          <meshStandardMaterial color={i % 3 ? '#8a8378' : '#6d675d'} roughness={0.95} flatShading />
        </mesh>
      ))}
      {/* lily pads */}
      {[
        [-0.2, 0.15],
        [0.25, -0.1],
        [0.05, 0.3],
      ].map(([x, z], i) => (
        <mesh key={`l${i}`} position={[x * o.w, 0.105, z * o.d]} rotation-y={i}>
          <cylinderGeometry args={[0.14, 0.14, 0.015, 10, 1, false, 0.4, 5.6]} />
          <meshStandardMaterial color="#4e7d3e" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

// Two-tier stone fountain with a translucent water jet.
function Fountain({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const r = Math.min(o.w, o.d) / 2
  return (
    <group>
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[r, r * 1.05, 0.36, 20]} />
        <meshStandardMaterial color={c} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.37, 0]} scale={[r * 0.92, 1, r * 0.92]}>
        <cylinderGeometry args={[1, 1, 0.03, 20]} />
        <meshStandardMaterial color="#5d8bab" roughness={0.08} />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.13, 0.5, 10]} />
        <meshStandardMaterial color={c} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.92, 0]} castShadow>
        <cylinderGeometry args={[r * 0.42, r * 0.2, 0.18, 16]} />
        <meshStandardMaterial color={c} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.0, 0]} scale={[r * 0.38, 1, r * 0.38]}>
        <cylinderGeometry args={[1, 1, 0.02, 16]} />
        <meshStandardMaterial color="#5d8bab" roughness={0.08} />
      </mesh>
      {/* jet + falling water */}
      <mesh position={[0, Math.min(o.h, 1.7) * 0.78, 0]}>
        <cylinderGeometry args={[0.025, 0.045, Math.min(o.h, 1.7) * 0.5, 8]} />
        <meshStandardMaterial color="#bfe0ea" transparent opacity={0.55} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[r * 0.3, r * 0.14, 0.42, 12, 1, true]} />
        <meshStandardMaterial color="#bfe0ea" transparent opacity={0.28} roughness={0.1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// Slatted garden bench with cast metal legs and a back.
function BenchOut({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * (o.w - 0.3)) / 2, 0, 0]}>
          <Box args={[0.06, 0.42, o.d - 0.08]} pos={[0, 0.21, 0]} color="#2f3237" />
          <Box args={[0.06, 0.5, 0.07]} pos={[0, 0.62, -o.d / 2 + 0.06]} rot={[-0.22, 0, 0]} color="#2f3237" />
        </group>
      ))}
      {[0, 1, 2].map((i) => (
        <Box key={i} args={[o.w, 0.035, 0.12]} pos={[0, 0.44, -o.d / 2 + 0.14 + i * 0.16]} color={c} />
      ))}
      {[0, 1, 2].map((i) => (
        <Box key={`b${i}`} args={[o.w, 0.12, 0.035]} pos={[0, 0.6 + i * 0.15, -o.d / 2 + 0.02 - i * 0.035]} rot={[-0.22, 0, 0]} color={c} />
      ))}
    </group>
  )
}

// Round outdoor table with two mesh chairs.
function TableOutSet({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const r = Math.min(o.w, o.d) * 0.26
  return (
    <group>
      <mesh position={[0, o.h, 0]} castShadow>
        <cylinderGeometry args={[r, r, 0.03, 20]} />
        <meshStandardMaterial color={c} roughness={0.5} metalness={0.4} />
      </mesh>
      <Alu args={[0.04, o.h, 0.04]} pos={[0, o.h / 2, 0]} color="#3a3f45" />
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, 0.03, 14]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.5} metalness={0.4} />
      </mesh>
      {[0, Math.PI].map((a, i) => (
        <group key={i} position={[Math.cos(a) * (r + 0.35), 0, Math.sin(a) * (r + 0.35)]} rotation-y={-a + Math.PI / 2}>
          <Box args={[0.4, 0.03, 0.4]} pos={[0, 0.44, 0]} color={c} />
          <Box args={[0.4, 0.42, 0.03]} pos={[0, 0.66, -0.19]} rot={[-0.1, 0, 0]} color={c} />
          {[
            [-0.17, -0.17],
            [0.17, -0.17],
            [-0.17, 0.17],
            [0.17, 0.17],
          ].map(([x, z], k) => (
            <Alu key={k} args={[0.025, 0.44, 0.025]} pos={[x, 0.22, z]} color="#3a3f45" />
          ))}
        </group>
      ))}
    </group>
  )
}

// Concrete walkway: textured slab with joint grooves.
function PathWay({ o, tint }: { o: Placed; tint: string | null }) {
  const joints = useMemo(() => spread(Math.max(1, Math.round(o.w / 1.2)), o.w - 0.6), [o.w])
  return (
    <group>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[o.w, 0.06, o.d]} />
        <meshStandardMaterial color={tint ?? '#ffffff'} map={surfaceMap('concrete', o.w, o.d)} roughness={0.95} />
      </mesh>
      {joints.map((x, i) => (
        <Box key={i} args={[0.02, 0.012, o.d]} pos={[x, 0.062, 0]} color="#9b968c" />
      ))}
    </group>
  )
}

// Freestanding canvas shade: two tall posts at the back, sloped fabric with
// a slight sag reading, guy bars at the front.
function Awning({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const backH = o.h
  const frontH = o.h - 0.7
  const slope = Math.atan2(backH - frontH, o.d)
  const fabricLen = Math.hypot(o.d + 0.3, backH - frontH)
  return (
    <group>
      {[-1, 1].map((s) => (
        <Alu key={`b${s}`} args={[0.08, backH, 0.08]} pos={[(s * (o.w - 0.15)) / 2, backH / 2, -o.d / 2 + 0.08]} color="#4b5563" />
      ))}
      {[-1, 1].map((s) => (
        <Alu key={`f${s}`} args={[0.07, frontH, 0.07]} pos={[(s * (o.w - 0.15)) / 2, frontH / 2, o.d / 2 - 0.08]} color="#4b5563" />
      ))}
      <group position={[0, (backH + frontH) / 2 - 0.03, 0]} rotation-x={slope}>
        <mesh castShadow>
          <boxGeometry args={[o.w, 0.03, fabricLen]} />
          <meshStandardMaterial color={c} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* seam ribs */}
        {spread(Math.max(2, Math.round(o.w / 0.8)), o.w - 0.2).map((x, i) => (
          <Box key={i} args={[0.025, 0.045, fabricLen]} pos={[x, -0.01, 0]} color={c} />
        ))}
        {/* scalloped front edge */}
        <Box args={[o.w, 0.14, 0.03]} pos={[0, -0.07, fabricLen / 2]} color={c} />
      </group>
    </group>
  )
}

// Patio umbrella: base, pole, ribbed octagonal canopy with a finial.
function Umbrella({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const r = Math.min(o.w, o.d) / 2
  const topY = o.h
  return (
    <group>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.3, 0.06, 12]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.6} />
      </mesh>
      <Alu args={[0.045, topY, 0.045]} pos={[0, topY / 2, 0]} color="#8a6f52" />
      <mesh position={[0, topY - 0.28, 0]} castShadow>
        <coneGeometry args={[r, 0.66, 8]} />
        <meshStandardMaterial color={c} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {/* rib tips + finial */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        return <Box key={i} args={[0.03, 0.1, 0.03]} pos={[Math.cos(a) * r * 0.98, topY - 0.6, Math.sin(a) * r * 0.98]} color={c} />
      })}
      <mesh position={[0, topY + 0.08, 0]}>
        <sphereGeometry args={[0.045, 8, 6]} />
        <meshStandardMaterial color="#8a6f52" roughness={0.6} />
      </mesh>
    </group>
  )
}

// Hold-washing room: lean-to extension with a mono-pitch roof, twin utility
// sinks, drying racks full of washed holds and a hose reel on the wall.
function WashRoom({ o, tint }: { o: Placed; tint: string | null }) {
  const roofH = o.h
  return (
    <group>
      <RoomShell o={o} tint={tint} wallColor={tint ?? '#cfd6dd'} floorColor="#b9b4a8" />
      {/* mono-pitch roof */}
      <group position={[0, roofH + 0.12, 0]} rotation-x={0.12}>
        <mesh castShadow>
          <boxGeometry args={[o.w + 0.4, 0.06, o.d + 0.5]} />
          <meshStandardMaterial color="#9aa3ad" roughness={0.5} metalness={0.35} />
        </mesh>
        {spread(Math.max(3, Math.round(o.w / 0.8)), o.w).map((x, i) => (
          <Box key={i} args={[0.07, 0.05, o.d + 0.5]} pos={[x, 0.05, 0]} color="#848d97" />
        ))}
      </group>
      {/* twin stainless utility sinks along the back wall */}
      {[-0.6, 0.6].map((x) => (
        <group key={x} position={[x * (o.w / 3), 0, -o.d / 2 + 0.45]}>
          <Alu args={[0.75, 0.06, 0.55]} pos={[0, 0.82, 0]} color="#c9ced4" />
          <Box args={[0.6, 0.28, 0.42]} pos={[0, 0.68, 0]} color="#9aa2ab" />
          <Alu args={[0.05, 0.7, 0.05]} pos={[-0.3, 0.35, -0.2]} color="#7c828a" />
          <Alu args={[0.05, 0.7, 0.05]} pos={[0.3, 0.35, -0.2]} color="#7c828a" />
          <Alu args={[0.03, 0.2, 0.03]} pos={[0, 0.95, -0.2]} color="#9aa2ab" />
          <Alu args={[0.03, 0.03, 0.16]} pos={[0, 1.04, -0.13]} color="#9aa2ab" />
        </group>
      ))}
      {/* drying racks with clean holds */}
      <group position={[o.w / 2 - 0.35, 0, 0.2]}>
        {[0.5, 0.95, 1.4].map((y, si) => (
          <group key={y}>
            <Box args={[0.5, 0.03, o.d - 1.2]} pos={[0, y, 0]} color="#7c828a" />
            {spread(4, o.d - 1.5).map((z, i) => (
              <mesh key={i} position={[((i % 2) - 0.5) * 0.2, y + 0.06, z]} castShadow>
                <icosahedronGeometry args={[0.055 + ((si + i) % 3) * 0.02, 0]} />
                <meshStandardMaterial color={HOLD_COLORS[(si * 4 + i) % HOLD_COLORS.length]} roughness={0.7} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* hose reel on the outside wall */}
      <mesh position={[-o.w / 2 - 0.05, 1.0, 0.3]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.1, 14]} />
        <meshStandardMaterial color="#2f6b46" roughness={0.7} />
      </mesh>
    </group>
  )
}

/* ------------------------------- dispatcher ------------------------------- */

// Face-scan UI shown on the gate's scanner screens (drawn once, shared)
let faceScanTexCache: THREE.CanvasTexture | null = null
function faceScanTexture(): THREE.CanvasTexture {
  if (faceScanTexCache) return faceScanTexCache
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#0c1626'
  g.fillRect(0, 0, 96, 128)
  g.strokeStyle = '#38e0c8'
  g.lineWidth = 3
  g.beginPath()
  g.ellipse(48, 54, 22, 28, 0, 0, Math.PI * 2)
  g.stroke()
  // scan-frame corner brackets
  g.lineWidth = 4
  const br = (x: number, y: number, dx: number, dy: number) => {
    g.beginPath()
    g.moveTo(x + dx * 14, y)
    g.lineTo(x, y)
    g.lineTo(x, y + dy * 14)
    g.stroke()
  }
  br(10, 12, 1, 1)
  br(86, 12, -1, 1)
  br(10, 96, 1, -1)
  br(86, 96, -1, -1)
  g.fillStyle = '#38e0c8'
  g.fillRect(16, 110, 64, 6)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  faceScanTexCache = tex
  return tex
}

// Face-scan entry gate: brushed speed-gate pedestals, clear acrylic swing
// flaps per lane, and a tilted face-recognition scanner at each lane entry.
// Walk mode treats it as passable — people walk through it.
function FaceGate({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const h = o.h
  const n = Math.round(clampN(Math.round(o.w / 1.2) + 1, 2, 5))
  const xs = spread(n, o.w - 0.1)
  const tex = useMemo(() => faceScanTexture(), [])
  const pedW = 0.18
  const pedH = h * 0.86
  return (
    <group>
      {xs.map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          {/* pedestal cabinet with a dark glass top strip and a go-light */}
          <Alu args={[pedW, pedH, o.d]} pos={[0, pedH / 2, 0]} color={c} />
          <Box args={[pedW + 0.012, 0.03, o.d - 0.03]} pos={[0, pedH + 0.015, 0]} color="#1c1f24" />
          <mesh position={[0, pedH + 0.034, o.d * 0.26]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.032, 12]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
          </mesh>
          {/* face scanner on a short mast at the lane entry (one per lane) */}
          {i < xs.length - 1 && (
            <group position={[0, pedH + 0.03, o.d / 2 - 0.05]}>
              <Alu args={[0.03, 0.36, 0.03]} pos={[0, 0.18, 0]} color="#4b5563" />
              <group position={[0, 0.42, 0]} rotation-x={-0.35}>
                <Box args={[0.13, 0.19, 0.028]} pos={[0, 0, 0]} color="#14171b" />
                <mesh position={[0, 0, 0.016]}>
                  <planeGeometry args={[0.105, 0.16]} />
                  <meshStandardMaterial map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.9} roughness={0.4} />
                </mesh>
              </group>
            </group>
          )}
        </group>
      ))}
      {/* clear swing flaps, slightly open */}
      {xs.slice(0, -1).map((x, i) => {
        const lane = xs[i + 1] - x - pedW
        const wingW = Math.max(0.1, lane / 2 - 0.02)
        return (
          <group key={`w${i}`}>
            {[0, 1].map((s) => (
              <group
                key={s}
                position={[s === 0 ? x + pedW / 2 : xs[i + 1] - pedW / 2, 0, 0]}
                rotation-y={s === 0 ? -0.5 : 0.5}
              >
                <mesh position={[((s === 0 ? 1 : -1) * wingW) / 2, h * 0.52, 0]} castShadow>
                  <boxGeometry args={[wingW, h * 0.56, 0.02]} />
                  <meshStandardMaterial color="#bfe0ea" transparent opacity={0.35} roughness={0.05} depthWrite={false} />
                </mesh>
                <Alu
                  args={[0.02, h * 0.56, 0.03]}
                  pos={[(s === 0 ? 1 : -1) * wingW, h * 0.52, 0]}
                  color="#8f959c"
                />
              </group>
            ))}
          </group>
        )
      })}
    </group>
  )
}

// Flat outdoor ground finish (grass lawn / gravel / etc.) with a real tiled
// texture and a thin soil edge, for planning surface materials on the site.
function GroundPatch({ o, tint, kind }: { o: Placed; tint: string | null; kind: 'grass' | 'gravel' }) {
  const h = Math.max(0.03, o.h)
  return (
    <group>
      <mesh position={[0, h / 2, 0]} receiveShadow>
        <boxGeometry args={[o.w, h, o.d]} />
        <meshStandardMaterial color={tint ?? '#ffffff'} map={surfaceMap(kind, o.w, o.d)} roughness={1} />
      </mesh>
    </group>
  )
}

// Fitness wall mirror: alu-framed panel that really reflects the scene.
// Place it flush against any partition or room wall (front faces local +z).
function WallMirror({ o, tint }: { o: Placed; tint: string | null }) {
  const t = Math.max(0.04, o.d)
  const ph = Math.max(0.3, o.h - 0.2) // glass panel, bottom lifted off the floor
  const py = 0.15 + ph / 2
  return (
    <group>
      {/* backing board against the wall */}
      <Box args={[o.w, o.h - 0.06, t * 0.5]} pos={[0, (o.h - 0.06) / 2 + 0.03, -t * 0.25]} color="#5d646c" />
      {/* the mirror itself */}
      <mesh position={[0, py, t / 2 - 0.004]}>
        <planeGeometry args={[o.w - 0.09, ph]} />
        <MeshReflectorMaterial
          blur={[120, 40]}
          resolution={384}
          mixBlur={0.4}
          mixStrength={2.2}
          roughness={0.06}
          metalness={0.5}
          color={tint ?? o.color}
        />
      </mesh>
      {/* slim aluminium frame */}
      <Alu args={[o.w, 0.055, t]} pos={[0, 0.125, 0]} />
      <Alu args={[o.w, 0.055, t]} pos={[0, py + ph / 2 + 0.025, 0]} />
      <Alu args={[0.055, ph + 0.11, t]} pos={[-o.w / 2 + 0.027, py, 0]} />
      <Alu args={[0.055, ph + 0.11, t]} pos={[o.w / 2 - 0.027, py, 0]} />
    </group>
  )
}

// Open steel railing (1 m) for separating interior areas: round posts and top
// rail, flat bottom rail, slim vertical balusters — see-through, gym style.
function Railing({ o, tint }: { o: Placed; tint: string | null }) {
  const c = tint ?? o.color
  const posts = useMemo(() => spread(Math.max(2, Math.round(o.w / 1.4) + 1), o.w - 0.06), [o.w])
  const bars = useMemo(() => spread(Math.max(4, Math.round(o.w / 0.12)), o.w - 0.2), [o.w])
  return (
    <group>
      {posts.map((x, i) => (
        <mesh key={i} position={[x, o.h / 2, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, o.h, 10]} />
          <meshStandardMaterial color={c} roughness={0.35} metalness={0.7} />
        </mesh>
      ))}
      {/* round top rail */}
      <mesh position={[0, o.h - 0.024, 0]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.025, 0.025, o.w, 12]} />
        <meshStandardMaterial color={c} roughness={0.3} metalness={0.75} />
      </mesh>
      {/* flat bottom rail + balusters */}
      <Alu args={[o.w, 0.045, 0.03]} pos={[0, 0.09, 0]} color={c} />
      {bars.map((x, i) => (
        <mesh key={`b${i}`} position={[x, (o.h - 0.2) / 2 + 0.11, 0]}>
          <boxGeometry args={[0.013, o.h - 0.2, 0.013]} />
          <meshStandardMaterial color={c} roughness={0.4} metalness={0.65} />
        </mesh>
      ))}
      {/* base plates */}
      {posts.map((x, i) => (
        <Alu key={`p${i}`} args={[0.1, 0.012, 0.1]} pos={[x, 0.006, 0]} color={c} />
      ))}
    </group>
  )
}

// Interior glass door: slim dark-aluminium frame, clear leaf swung ajar.
// Same thickness family as partitions, so it slots into partition runs.
function GlassDoorInterior({ o, tint }: { o: Placed; tint: string | null }) {
  const t = Math.max(0.08, Math.min(o.d, 0.2))
  const fc = tint ?? o.color
  const leaves = o.w > 1.5 ? 2 : 1
  const leafW = (o.w - 0.08 - (leaves - 1) * 0.02) / leaves
  const leafH = o.h - 0.08
  return (
    <group>
      <Alu args={[0.045, o.h, t]} pos={[-o.w / 2 + 0.022, o.h / 2, 0]} color={fc} />
      <Alu args={[0.045, o.h, t]} pos={[o.w / 2 - 0.022, o.h / 2, 0]} color={fc} />
      <Alu args={[o.w, 0.06, t]} pos={[0, o.h - 0.03, 0]} color={fc} />
      {Array.from({ length: leaves }, (_, i) => {
        const dir = i === 0 ? 1 : -1
        const hingeX = i === 0 ? -o.w / 2 + 0.045 : o.w / 2 - 0.045
        return (
          <group key={i} position={[hingeX, 0, 0]} rotation-y={i === 0 ? -0.5 : 0}>
            <mesh position={[(dir * leafW) / 2, leafH / 2, 0]} castShadow>
              <boxGeometry args={[leafW - 0.04, leafH - 0.06, 0.012]} />
              <meshStandardMaterial color="#cfe6ee" transparent opacity={0.26} roughness={0.05} metalness={0.1} depthWrite={false} />
            </mesh>
            {/* slim stiles, top rail and a wider bottom rail */}
            <Alu args={[0.035, leafH, 0.035]} pos={[dir * 0.018, leafH / 2, 0]} color={fc} />
            <Alu args={[0.035, leafH, 0.035]} pos={[dir * (leafW - 0.018), leafH / 2, 0]} color={fc} />
            <Alu args={[leafW, 0.035, 0.035]} pos={[(dir * leafW) / 2, leafH - 0.018, 0]} color={fc} />
            <Alu args={[leafW, 0.11, 0.035]} pos={[(dir * leafW) / 2, 0.055, 0]} color={fc} />
            {/* vertical pull handles on both faces */}
            <Alu args={[0.022, 0.5, 0.022]} pos={[dir * (leafW - 0.13), o.h * 0.46, 0.055]} color="#9aa2ab" />
            <Alu args={[0.022, 0.5, 0.022]} pos={[dir * (leafW - 0.13), o.h * 0.46, -0.055]} color="#9aa2ab" />
          </group>
        )
      })}
    </group>
  )
}

// Projected court image for the tennis simulator screen (drawn once, shared)
let tennisTexCache: THREE.CanvasTexture | null = null
function tennisScreenTexture(): THREE.CanvasTexture {
  if (tennisTexCache) return tennisTexCache
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 288
  const g = c.getContext('2d')!
  // night-stadium backdrop with a crowd band
  const sky = g.createLinearGradient(0, 0, 0, 124)
  sky.addColorStop(0, '#0c1930')
  sky.addColorStop(1, '#1d3b5e')
  g.fillStyle = sky
  g.fillRect(0, 0, 512, 124)
  g.fillStyle = '#233246'
  g.fillRect(0, 94, 512, 30)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `hsl(${(i * 47) % 360} 28% ${52 + ((i * 13) % 22)}%)`
    g.fillRect((i * 61) % 510, 96 + ((i * 29) % 24), 2, 3)
  }
  // green surround, blue court in perspective
  g.fillStyle = '#3f6f46'
  g.fillRect(0, 124, 512, 164)
  const trap = (top: number, bot: number, tw: number, bw: number) => {
    g.beginPath()
    g.moveTo(256 - tw / 2, top)
    g.lineTo(256 + tw / 2, top)
    g.lineTo(256 + bw / 2, bot)
    g.lineTo(256 - bw / 2, bot)
    g.closePath()
  }
  trap(130, 288, 200, 470)
  g.fillStyle = '#2f6bb4'
  g.fill()
  g.strokeStyle = '#f2f5f7'
  g.lineWidth = 3
  trap(136, 282, 178, 430)
  g.stroke()
  // baseline centre tick, service line + centre service line
  g.beginPath()
  g.moveTo(256 - 132, 196)
  g.lineTo(256 + 132, 196)
  g.moveTo(256, 196)
  g.lineTo(256, 282)
  g.stroke()
  // net across the near edge: white tape, dark mesh
  g.fillStyle = 'rgba(20, 26, 32, 0.55)'
  g.fillRect(0, 236, 512, 52)
  g.fillStyle = '#eef2f5'
  g.fillRect(0, 232, 512, 7)
  g.strokeStyle = 'rgba(230, 236, 240, 0.25)'
  g.lineWidth = 1
  for (let x = 8; x < 512; x += 14) {
    g.beginPath()
    g.moveTo(x, 239)
    g.lineTo(x, 288)
    g.stroke()
  }
  // incoming ball
  g.fillStyle = '#d9e94a'
  g.beginPath()
  g.arc(300, 210, 7, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tennisTexCache = tex
  return tex
}

// Tennis simulator: dark acoustic booth, glowing impact screen filling one
// 5 m end, turf floor with a hitting lane, projector, ball machine and player.
function TennisSimRoom({ o, tint }: { o: Placed; tint: string | null }) {
  const t = 0.12
  const wc = tint ?? '#3a4550'
  const tex = useMemo(() => tennisScreenTexture(), [])
  const doors = useWallDoors(o.id)
  const endCuts = wallOpenings(doors, o, { cx: o.w / 2 - t / 2, cz: 0, along: 'z', len: o.d, t })
  // door opening on the end wall opposite the screen
  const doorW = Math.min(1.0, o.d * 0.35)
  const doorH = Math.min(2.05, o.h - 0.3)
  const doorZ = o.d / 2 - 0.4 - doorW / 2
  const nearW = o.d / 2 - (doorZ + doorW / 2)
  const farW = doorZ - doorW / 2 + o.d / 2
  return (
    <group>
      {/* turf floor + blue hitting lane with white service lines */}
      <Box args={[o.w, 0.05, o.d]} pos={[0, 0.025, 0]} color="#47734c" />
      <Box args={[o.w * 0.66, 0.06, Math.min(o.d - 1.2, 3.4)]} pos={[-o.w * 0.08, 0.03, 0]} color="#2f5f9e" />
      <Box args={[0.05, 0.065, Math.min(o.d - 1.2, 3.4)]} pos={[o.w * 0.22, 0.032, 0]} color="#eef2f5" />
      <Box args={[o.w * 0.4, 0.065, 0.05]} pos={[-o.w * 0.12, 0.032, 0]} color="#eef2f5" />
      {/* perimeter walls; screen end at -x. Doors placed on a wall cut openings. */}
      <Box args={[t, o.h, o.d]} pos={[-o.w / 2 + t / 2, o.h / 2, 0]} color={wc} />
      <CutWall
        len={o.w}
        h={o.h}
        t={t}
        openings={wallOpenings(doors, o, { cx: 0, cz: -o.d / 2 + t / 2, along: 'x', len: o.w, t })}
        color={wc}
        pos={[0, 0, -o.d / 2 + t / 2]}
      />
      <CutWall
        len={o.w}
        h={o.h}
        t={t}
        openings={wallOpenings(doors, o, { cx: 0, cz: o.d / 2 - t / 2, along: 'x', len: o.w, t })}
        color={wc}
        pos={[0, 0, o.d / 2 - t / 2]}
      />
      {/* end wall with the doorway (a placed door replaces the built-in one) */}
      {endCuts.length > 0 ? (
        <CutWall len={o.d} h={o.h} t={t} openings={endCuts} color={wc} pos={[o.w / 2 - t / 2, 0, 0]} rotY={-Math.PI / 2} />
      ) : (
        <>
          {farW > 0.05 && <Box args={[t, o.h, farW]} pos={[o.w / 2 - t / 2, o.h / 2, -o.d / 2 + farW / 2]} color={wc} />}
          {nearW > 0.05 && <Box args={[t, o.h, nearW]} pos={[o.w / 2 - t / 2, o.h / 2, o.d / 2 - nearW / 2]} color={wc} />}
          <Box args={[t, Math.max(0.08, o.h - doorH), doorW]} pos={[o.w / 2 - t / 2, doorH + (o.h - doorH) / 2, doorZ]} color={wc} />
        </>
      )}
      {/* black screen frame + glowing projected court */}
      <Box args={[0.06, o.h - 0.44, o.d - 0.3]} pos={[-o.w / 2 + t + 0.05, o.h * 0.52, 0]} color="#14171b" />
      <mesh position={[-o.w / 2 + t + 0.1, o.h * 0.52, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[o.d - 0.5, o.h - 0.62]} />
        <meshStandardMaterial map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.7} roughness={0.9} />
      </mesh>
      {/* ceiling-mounted projector aimed at the screen */}
      <group position={[o.w * 0.12, o.h - 0.32, 0]}>
        <Alu args={[0.05, 0.32, 0.05]} pos={[0, 0.16, 0]} color="#3a3f45" />
        <Box args={[0.42, 0.14, 0.3]} pos={[0, 0, 0]} color="#e8eaec" />
        <mesh position={[-0.22, 0, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.03, 12]} />
          <meshStandardMaterial color="#1f2937" emissive="#aab8ff" emissiveIntensity={0.6} />
        </mesh>
      </group>
      {/* ball machine + loose balls */}
      <group position={[o.w * 0.3, 0, -o.d * 0.22]}>
        <Box args={[0.45, 0.55, 0.4]} pos={[0, 0.3, 0]} color="#2b2f35" />
        <mesh position={[-0.24, 0.52, 0]} rotation-z={1.15}>
          <cylinderGeometry args={[0.07, 0.09, 0.3, 12]} />
          <meshStandardMaterial color="#454b52" roughness={0.5} metalness={0.4} />
        </mesh>
      </group>
      {[
        [-o.w * 0.32, -o.d * 0.18],
        [-o.w * 0.28, o.d * 0.24],
        [-o.w * 0.38, 0.4],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.09, z]} castShadow>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshStandardMaterial color="#d9e94a" roughness={0.7} />
        </mesh>
      ))}
      {/* player facing the screen, racket raised */}
      <group position={[o.w * 0.18, 0.06, o.d * 0.08]} rotation-y={-Math.PI / 2}>
        <Figure pose="walk" shirt="#e2e8f0" idx={5} />
        <group position={[0.28, 1.25, 0]} rotation-z={0.8}>
          <Alu args={[0.025, 0.34, 0.025]} pos={[0, 0.17, 0]} color="#2b2f35" />
          <mesh position={[0, 0.44, 0]}>
            <torusGeometry args={[0.11, 0.014, 8, 18]} />
            <meshStandardMaterial color="#c9ced4" roughness={0.4} metalness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export function ObjectMesh({ o, tint }: { o: Placed; tint: string | null }) {
  switch (o.category) {
    case 'ceiling':
      if (o.defId === 'bulkhead') return <Bulkhead o={o} tint={tint} />
      return <CeilingPanel o={o} tint={tint} />
    case 'hvac':
      if (o.defId === 'duct') return <AirDuct o={o} tint={tint} />
      if (o.defId === 'fcu') return <CoolingCoil o={o} tint={tint} />
      if (o.defId === 'condenser') return <Condenser o={o} tint={tint} />
      if (o.defId === 'bigfan') return <BigFan o={o} tint={tint} />
      return <FloorFan o={o} tint={tint} />
    case 'tech':
      if (o.defId === 'highbay') return <HighBay o={o} tint={tint} />
      if (o.defId === 'tracklight') return <TrackLight o={o} tint={tint} />
      if (o.defId === 'cctv') return <Cctv o={o} tint={tint} />
      return <SpeakerBox o={o} tint={tint} />
    case 'site':
      if (o.defId === 'tree_small' || o.defId === 'tree_big') return <Tree o={o} tint={tint} />
      if (o.defId === 'tree_cone' || o.defId === 'tree_slim') return <Conifer o={o} tint={tint} />
      if (o.defId === 'pond') return <Pond o={o} tint={tint} />
      if (o.defId === 'fountain') return <Fountain o={o} tint={tint} />
      if (o.defId === 'bench_out') return <BenchOut o={o} tint={tint} />
      if (o.defId === 'table_out') return <TableOutSet o={o} tint={tint} />
      if (o.defId === 'path') return <PathWay o={o} tint={tint} />
      if (o.defId === 'lawn') return <GroundPatch o={o} tint={tint} kind="grass" />
      if (o.defId === 'gravel') return <GroundPatch o={o} tint={tint} kind="gravel" />
      if (o.defId === 'awning') return <Awning o={o} tint={tint} />
      if (o.defId === 'umbrella') return <Umbrella o={o} tint={tint} />
      if (o.defId === 'fence') return <Fence o={o} tint={tint} />
      if (o.defId === 'hedge') return <Hedge o={o} tint={tint} />
      if (o.defId === 'lightpole') return <LightPole o={o} tint={tint} />
      if (o.defId === 'car') return <Car o={o} tint={tint} />
      if (o.defId === 'moto') return <Motorcycle o={o} tint={tint} />
      if (o.defId === 'carport') return <Carport o={o} tint={tint} />
      return <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
    case 'wall_low':
    case 'wall_high':
      return <ClimbingWall o={o} tint={tint} />
    case 'wall_island':
      return <IslandBoulder o={o} tint={tint} />
    case 'wall_custom':
      return <CustomWallObject o={o} tint={tint} />
    case 'mat':
      return <Mats o={o} tint={tint} />
    case 'mezzanine':
      return <Mezzanine o={o} tint={tint} />
    case 'stairs':
      return <Stairs o={o} tint={tint} />
    case 'column':
      return <Column o={o} tint={tint} />
    case 'partition':
      if (o.defId === 'rail') return <Railing o={o} tint={tint} />
      // interior partition wall (solid or glass); doors placed on it cut openings
      return <PartitionWall o={o} tint={tint} />
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
      if (o.defId === 'tennis_sim') return <TennisSimRoom o={o} tint={tint} />
      if (o.defId === 'washroom') return <WashRoom o={o} tint={tint} />
      return <StorageRoom o={o} tint={tint} />
    case 'reception':
      return <Reception o={o} tint={tint} />
    case 'fixture':
      if (o.defId === 'shoes') return <ShoeRack o={o} tint={tint} />
      if (o.defId === 'gate_face') return <FaceGate o={o} tint={tint} />
      if (o.defId === 'mirror') return <WallMirror o={o} tint={tint} />
      if (o.defId === 'icebath') return <IceBath o={o} tint={tint} />
      return (
        <Box args={[o.w, o.h, o.d]} pos={[0, o.h / 2, 0]} color={tint ?? o.color} />
      )
    case 'furniture':
      if (o.defId === 'stool') return <StoolMesh o={o} tint={tint} />
      if (o.defId === 'bench') return <BenchMesh o={o} tint={tint} />
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
