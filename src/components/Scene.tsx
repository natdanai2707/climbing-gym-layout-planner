import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera, Sky, SoftShadows, Stars } from '@react-three/drei'
import { useStore } from '../store'
import type { ResizeAxis, ResizeState } from '../store'
import type { Placed } from '../types'
import { BuildingFloor } from './BuildingFloor'
import { GridOverlay } from './GridOverlay'
import { PlanBuildingOutline } from './PlanSymbols'
import { PlacedObject } from './PlacedObject'
import { WarehouseShell, ROOF_PITCH } from './WarehouseShell'
import { ArrowHandle } from './gizmo'
import { elevationFor, fp, getWarningIds, wallOpenings } from '../placement'
import type { Opening } from '../placement'

// Exposed so the toolbar can grab a PNG of the canvas
export const canvasCapture: { el: HTMLCanvasElement | null } = { el: null }

function CaptureBinder() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    canvasCapture.el = gl.domElement
    return () => {
      canvasCapture.el = null
    }
  }, [gl])
  return null
}

// Orbit camera with view presets (iso / top / front / side). Remounted (via
// key) whenever a preset is chosen or the view is reset. The scroll wheel /
// pinch zooms toward the cursor or finger position (zoomToCursor).
function CameraRig() {
  const size = useThree((s) => s.size)
  const preset = useStore((s) => s.viewPreset)
  const plan = useStore((s) => s.planMode)
  const cfg = useMemo(() => {
    const s = useStore.getState()
    const { width, length, apron, centerZ } = s.building
    const ridge = s.shell.eave + (width / 2) * ROOF_PITCH
    const fit = (spanX: number, spanY: number) =>
      Math.max(2, Math.min(40, 0.88 * Math.min(size.width / spanX, size.height / spanY)))
    switch (preset) {
      case 'top':
        return {
          pos: [0, 140, centerZ + 0.01] as [number, number, number],
          target: [0, 0, centerZ] as [number, number, number],
          zoom: fit(width + apron * 2 + 6, length + apron * 2 + 6),
        }
      case 'front': // looking down the length at a gable end
        return {
          pos: [0, ridge / 2, centerZ + length / 2 + 120] as [number, number, number],
          target: [0, ridge / 2, centerZ] as [number, number, number],
          zoom: fit(width + 8, ridge + 5),
        }
      case 'side': // looking at a long wall
        return {
          pos: [140, ridge / 2, centerZ] as [number, number, number],
          target: [0, ridge / 2, centerZ] as [number, number, number],
          zoom: fit(length + apron * 2 + 8, ridge + 5),
        }
      default:
        return {
          pos: [70, 70, 70] as [number, number, number],
          target: [0, 0, 0] as [number, number, number],
          zoom: Math.max(4, Math.min(13, Math.min(size.width, size.height) / 65)),
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])
  return (
    <>
      <OrthographicCamera makeDefault position={cfg.pos} zoom={cfg.zoom} near={-500} far={1000} />
      {/* 2D plan mode locks rotation: pan + zoom-to-cursor only */}
      <OrbitControls
        makeDefault
        target={cfg.target}
        maxPolarAngle={Math.PI / 2.05}
        zoomToCursor
        enableRotate={!plan}
        screenSpacePanning={plan}
        // Fusion-style: drag with the scroll wheel pressed (or right button) to pan
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
      />
    </>
  )
}

/* ----------------------------- first person view ----------------------------- */

// Touch joystick input, written by the on-screen joysticks in App and read by
// the walk rig every frame. walkInput: left stick, x = strafe, y = forward
// (-1 = forward). walkLook: right stick, turns/tilts the view continuously
// while held — much easier than swiping repeatedly on a phone.
export const walkInput = { x: 0, y: 0 }
export const walkLook = { x: 0, y: 0 }

// Solid things a walker bumps into; flat zones/mats and doors stay passable,
// mezzanines are open underneath, and ceilings/ducts/fans hang overhead.
const WALK_PASSABLE = new Set(['zone', 'mat', 'door', 'person', 'parking', 'mezzanine', 'ceiling', 'hvac', 'tech'])
// site items that are roofs/canopies on posts — walk (and park) beneath them —
// plus the entry gate, which people walk through
const WALK_PASSABLE_DEFS = new Set(['carport', 'awning', 'umbrella', 'gate_face'])

function WalkRig() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const st = useRef({ yaw: 0, pitch: 0, pos: new THREE.Vector3(0, 1.65, 0) })
  const keys = useRef(new Set<string>())

  // spawn just inside the entrance door (or at the near gable end), facing in
  useEffect(() => {
    const s = useStore.getState()
    const door = s.objects.find((o) => o.category === 'door' && o.rule === 'edge')
    const cz = s.building.centerZ
    if (door) {
      const dx = 0 - door.x
      const dz = cz - door.z
      const l = Math.hypot(dx, dz) || 1
      st.current.pos.set(door.x + (dx / l) * 2, 1.65, door.z + (dz / l) * 2)
      st.current.yaw = Math.atan2(-dx / l, -dz / l)
    } else {
      st.current.pos.set(0, 1.65, cz + s.building.length / 2 - 2)
      st.current.yaw = 0 // facing -z, into the hall
    }
    st.current.pitch = 0
    // test hook: teleport the walker (used by automated UI tests)
    ;(window as unknown as Record<string, unknown>).__setWalk = (x: number, z: number, yaw: number) => {
      st.current.pos.set(x, 1.65, z)
      st.current.yaw = yaw
    }
  }, [])

  // drag to look (mouse or touch) — the joystick overlay stops propagation,
  // so pointers starting there never rotate the view
  useEffect(() => {
    const el = gl.domElement
    let pid = -1
    let lx = 0
    let ly = 0
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (pid !== -1) return
      pid = e.pointerId
      lx = e.clientX
      ly = e.clientY
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return
      // fingers swipe short distances on small screens — boost touch sensitivity
      const k = e.pointerType === 'touch' ? 0.0085 : 0.005
      st.current.yaw -= (e.clientX - lx) * k
      st.current.pitch = Math.max(-1.35, Math.min(1.35, st.current.pitch - (e.clientY - ly) * k))
      lx = e.clientX
      ly = e.clientY
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId === pid) pid = -1
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [gl])

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      keys.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.12)
    const k = keys.current
    let f = 0
    let r = 0
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1
    f += -walkInput.y
    r += walkInput.x
    const len = Math.hypot(f, r)
    if (len > 1) {
      f /= len
      r /= len
    }
    const v = st.current
    const EYE = 1.65
    const s = useStore.getState()
    // right stick: continuous turn/tilt while held
    if (walkLook.x !== 0 || walkLook.y !== 0) {
      v.yaw -= walkLook.x * 2.4 * dt
      v.pitch = Math.max(-1.35, Math.min(1.35, v.pitch - walkLook.y * 1.7 * dt))
    }
    // walkable surface height at a point: ground, stair ramps, mezzanine tops
    const supportAt = (x: number, z: number, foot: number) => {
      let best = 0
      for (const o of s.objects) {
        let cand = -1
        if (o.category === 'mezzanine') {
          const { fw, fd } = fp(o)
          if (Math.abs(x - o.x) < fw / 2 && Math.abs(z - o.z) < fd / 2) cand = o.h
        } else if (o.category === 'stairs') {
          // stairs climb from local +d/2 (bottom) to -d/2 (top)
          const th = (o.rot * Math.PI) / 4
          const dx = x - o.x
          const dz = z - o.z
          const lx = dx * Math.cos(th) - dz * Math.sin(th)
          const lz = dx * Math.sin(th) + dz * Math.cos(th)
          if (Math.abs(lx) < o.w / 2 + 0.1 && Math.abs(lz) < o.d / 2 + 0.3) {
            const t = Math.max(0, Math.min(1, (o.d / 2 - lz) / o.d))
            cand = o.h * t
          }
        }
        // can step up ~half a meter; any drop is allowed
        if (cand >= 0 && cand <= foot + 0.55 && cand > best) best = cand
      }
      return best
    }
    if (len > 0.001) {
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 6 : 3.2
      const sin = Math.sin(v.yaw)
      const cos = Math.cos(v.yaw)
      let nx = v.pos.x + (-sin * f + cos * r) * speed * dt
      let nz = v.pos.z + (-cos * f - sin * r) * speed * dt
      const bw = s.building.width / 2 + s.building.apron - 0.3
      const bl = s.building.length / 2 + s.building.apron - 0.3
      nx = Math.max(-bw, Math.min(bw, nx))
      nz = Math.max(s.building.centerZ - bl, Math.min(s.building.centerZ + bl, nz))
      const foot = v.pos.y - EYE
      const wallDoors = s.objects.filter((d) => d.category === 'door' && d.rule === 'floor')
      const edgeDoors = s.objects.filter((d) => d.category === 'door' && d.rule === 'edge')
      // The building shell (when shown) blocks at the perimeter — except where
      // an entrance / fire-exit door is placed, which the walker passes through.
      const hw2 = s.building.width / 2
      const zMin = s.building.centerZ - s.building.length / 2
      const zMax = s.building.centerZ + s.building.length / 2
      const shellWalls = s.shell.mode > 0
      const perimeterBlocked = (x: number, z: number) => {
        if (!shellWalls) return false
        const wt = 0.32
        if (z > zMin - wt && z < zMax + wt) {
          for (const sx of [-hw2, hw2]) {
            if (Math.abs(x - sx) < wt) {
              const rotWant = sx < 0 ? 2 : 6
              if (!edgeDoors.some((d) => d.rot === rotWant && Math.abs(z - d.z) < d.w / 2 - 0.05)) return true
            }
          }
        }
        if (x > -hw2 - wt && x < hw2 + wt) {
          for (const [sz, rotWant] of [
            [zMin, 0],
            [zMax, 4],
          ] as const) {
            if (Math.abs(z - sz) < wt) {
              if (!edgeDoors.some((d) => d.rot === rotWant && Math.abs(x - d.x) < d.w / 2 - 0.05)) return true
            }
          }
        }
        return false
      }
      const passes = (ops: Opening[], u: number) => ops.some((op) => op.h > 1.5 && Math.abs(u - op.c) < op.w / 2 - 0.06)
      const blocked = (x: number, z: number) => {
        if (perimeterBlocked(x, z)) return true
        for (const o of s.objects) {
          if (o.h < 0.9 || o.category === 'stairs' || WALK_PASSABLE.has(o.category) || WALK_PASSABLE_DEFS.has(o.defId)) continue
          const elev = elevationFor(o, s.objects)
          if (elev + o.h <= foot + 0.45) continue // entirely below the feet
          if (elev >= foot + 1.55) continue // entirely above the head
          const { fw, fd } = fp(o)
          if (!(Math.abs(x - o.x) < fw / 2 + 0.25 && Math.abs(z - o.z) < fd / 2 + 0.25)) continue
          // partitions and rooms are wall-aware: only the actual wall blocks,
          // and doorways (placed doors or a room's built-in opening) let you through
          const th = (o.rot * Math.PI) / 4
          const lx = (x - o.x) * Math.cos(th) - (z - o.z) * Math.sin(th)
          const lz = (x - o.x) * Math.sin(th) + (z - o.z) * Math.cos(th)
          if (o.category === 'partition' && o.defId !== 'rail') {
            const t = Math.max(0.08, o.d)
            if (Math.abs(lz) > t / 2 + 0.18 || Math.abs(lx) > o.w / 2 + 0.18) continue
            if (passes(wallOpenings(wallDoors, o, { cx: 0, cz: 0, along: 'x', len: o.w, t }), lx)) continue
            return true
          }
          if (o.category === 'room') {
            const t = 0.12
            const m = 0.18
            if (Math.abs(lx) > o.w / 2 + m || Math.abs(lz) > o.d / 2 + m) continue
            const nearX = o.w / 2 - Math.abs(lx) < t + m // near an end wall (runs along z)
            const nearZ = o.d / 2 - Math.abs(lz) < t + m // near a long wall (runs along x)
            if (!nearX && !nearZ) continue // room interior — walk freely
            const isTennis = o.defId === 'tennis_sim'
            let pass = false
            if (nearZ) {
              const front = lz > 0
              const ops = wallOpenings(wallDoors, o, { cx: 0, cz: (front ? 1 : -1) * (o.d / 2 - t / 2), along: 'x', len: o.w, t })
              if (!isTennis && front && ops.length === 0) {
                // RoomShell's built-in doorway near the right corner
                const doorW = Math.min(0.95, o.w * 0.4)
                ops.push({ c: o.w / 2 - 0.35 - doorW / 2, w: doorW, h: Math.min(2.05, o.h - 0.2) })
              }
              pass = passes(ops, lx)
            }
            if (!pass && nearX) {
              const east = lx > 0
              const ops = wallOpenings(wallDoors, o, { cx: (east ? 1 : -1) * (o.w / 2 - t / 2), cz: 0, along: 'z', len: o.d, t })
              if (isTennis && east && ops.length === 0) {
                // tennis room's built-in doorway on the end opposite the screen
                const doorW = Math.min(1.0, o.d * 0.35)
                ops.push({ c: o.d / 2 - 0.4 - doorW / 2, w: doorW, h: Math.min(2.05, o.h - 0.3) })
              }
              pass = passes(ops, lz)
            }
            if (pass) continue
            return true
          }
          return true
        }
        return false
      }
      if (!blocked(nx, nz)) {
        v.pos.x = nx
        v.pos.z = nz
      } else if (!blocked(nx, v.pos.z)) v.pos.x = nx
      else if (!blocked(v.pos.x, nz)) v.pos.z = nz
    }
    // follow the ground / ramp / mezzanine smoothly
    const targetY = EYE + supportAt(v.pos.x, v.pos.z, v.pos.y - EYE)
    v.pos.y += (targetY - v.pos.y) * Math.min(1, dt * 12)
    ;(window as unknown as Record<string, unknown>).__walkPos = [v.pos.x, v.pos.y, v.pos.z, v.yaw] // for tests
    camera.position.copy(v.pos)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(v.pitch, v.yaw, 0)
  })

  return <PerspectiveCamera makeDefault fov={72} near={0.08} far={400} />
}

/* ------------------------- lighting moods & render style ------------------------- */

const MOODS = {
  day: { bg: '#eceae4', dirColor: '#fff6e6', dirPos: [35, 60, 20], dirInt: 1.4, amb: 0.75, ambColor: '#ffffff', hemi: 0.35, lamps: false },
  golden: { bg: '#f0d9ba', dirColor: '#ffab55', dirPos: [58, 16, 32], dirInt: 1.7, amb: 0.4, ambColor: '#ffd9b0', hemi: 0.22, lamps: false },
  night: { bg: '#0f131d', dirColor: '#8aa2d6', dirPos: [-30, 45, -25], dirInt: 0.22, amb: 0.14, ambColor: '#38466a', hemi: 0.06, lamps: true },
} as const

function MoodLights() {
  const mood = useStore((s) => s.lightMood)
  const building = useStore((s) => s.building)
  const eave = useStore((s) => s.shell.eave)
  const m = MOODS[mood]
  const lamps = useMemo(() => {
    if (!m.lamps) return []
    const n = Math.max(2, Math.min(8, Math.round(building.length / 10)))
    return Array.from({ length: n }, (_, i) => {
      const z = building.centerZ - building.length / 2 + ((i + 0.5) * building.length) / n
      const x = i % 2 === 0 ? -building.width / 4 : building.width / 4
      return [x, Math.max(3.5, eave - 0.8), z] as [number, number, number]
    })
  }, [m.lamps, building, eave])
  return (
    <>
      <ambientLight intensity={m.amb} color={m.ambColor} />
      <directionalLight
        position={m.dirPos as unknown as [number, number, number]}
        color={m.dirColor}
        intensity={m.dirInt}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
      />
      <hemisphereLight intensity={m.hemi} groundColor="#c8bfae" />
      {lamps.map((p, i) => (
        <pointLight key={i} position={p} color="#ffd9a2" intensity={55} distance={30} decay={1.8} />
      ))}
    </>
  )
}

/* ------------------------------ measuring tape ------------------------------ */

// While measuring, canvas taps drop points on the floor plane (snapped to
// 25 cm); two points make a run. Runs stay visible until measuring is toggled
// off. Selection is suspended so taps never grab objects.
function MeasureController() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const measuring = useStore((s) => s.measuring)
  const walking = useStore((s) => s.viewMode === 'walk')

  useEffect(() => {
    if (!measuring || walking) return
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const pt = new THREE.Vector3()
    let downAt: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return
      downAt = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      // only a tap (not an orbit drag) places a point
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) {
        downAt = null
        return
      }
      downAt = null
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      if (!raycaster.ray.intersectPlane(plane, pt)) return
      const snap = (v: number) => Math.round(v / 0.25) * 0.25
      useStore.getState().addMeasurePoint(snap(pt.x), snap(pt.z))
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [measuring, walking, gl, camera])
  return null
}

function MeasurePoint({ p }: { p: [number, number] }) {
  return (
    <mesh position={[p[0], 0.06, p[1]]} renderOrder={6}>
      <cylinderGeometry args={[0.14, 0.14, 0.06, 16]} />
      <meshBasicMaterial color="#e11d48" depthTest={false} />
    </mesh>
  )
}

function MeasureGraphics() {
  const measures = useStore((s) => s.measures)
  const draft = useStore((s) => s.measureDraft)
  const measuring = useStore((s) => s.measuring)
  if (!measuring) return null
  return (
    <group>
      {measures.map((m, i) => {
        const dist = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])
        const mid: [number, number, number] = [(m.a[0] + m.b[0]) / 2, 0.1, (m.a[1] + m.b[1]) / 2]
        return (
          <group key={i}>
            <Line
              points={[
                [m.a[0], 0.07, m.a[1]],
                [m.b[0], 0.07, m.b[1]],
              ]}
              color="#e11d48"
              lineWidth={2.5}
              depthTest={false}
            />
            <MeasurePoint p={m.a} />
            <MeasurePoint p={m.b} />
            <Html position={mid} center zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }}>
              <div className="measure-label">{dist.toFixed(2)} m</div>
            </Html>
          </group>
        )
      })}
      {draft && (
        <group>
          <MeasurePoint p={draft} />
          <Html position={[draft[0], 0.35, draft[1]]} center zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }}>
            <div className="measure-label">tap the second point…</div>
          </Html>
        </group>
      )}
    </group>
  )
}

// Realistic presentation: procedural sky (stars at night), percent-closer
// soft shadows, a touch more exposure. The reflective floor lives in
// BuildingFloor. No external assets — everything is generated on the GPU.
function RealisticExtras() {
  const real = useStore((s) => s.realMode)
  const mood = useStore((s) => s.lightMood)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.toneMappingExposure = real ? 1.15 : 1
    return () => {
      gl.toneMappingExposure = 1
    }
  }, [real, gl])
  if (!real) return null
  return (
    <>
      <SoftShadows size={16} samples={10} focus={0.6} />
      {mood === 'night' ? (
        <Stars radius={260} depth={60} count={3200} factor={5} saturation={0} fade speed={0} />
      ) : (
        <Sky
          distance={4000}
          sunPosition={mood === 'golden' ? [58, 10, 32] : [35, 60, 20]}
          turbidity={mood === 'golden' ? 8 : 4}
          rayleigh={mood === 'golden' ? 2.5 : 1}
        />
      )}
    </>
  )
}

const snapDim = (v: number) => Math.max(0.25, Math.round(v / 0.25) * 0.25)

// Height at which the side resize arrows sit. Suspended/elevated items
// (ceilings, ducts, FCUs, big fans, mezzanine floors) get their arrows at
// their own working level instead of near the floor, so they're reachable.
function arrowLevel(o: Placed): number {
  if (o.category === 'ceiling' || o.category === 'mezzanine' || o.category === 'tech') return Math.max(0.25, o.h)
  if (o.category === 'hvac' && (o.defId === 'duct' || o.defId === 'fcu' || o.defId === 'bigfan'))
    return Math.max(0.25, o.h)
  return Math.min(Math.max(o.h * 0.5, 0.25), 1.2)
}

/**
 * Handles the three pointer-driven interactions by raycasting from window-level
 * pointer events (so drags never "drop" when the cursor crosses another mesh):
 *  - placing a new object from the palette (ghost follows the cursor)
 *  - dragging a placed object to move it
 *  - dragging a dimension arrow to resize W / D / H
 */
function DragController() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const placing = useStore((s) => s.placingDef !== null)
  const dragging = useStore((s) => s.draggingId !== null)
  const resizing = useStore((s) => s.resizing !== null)
  const shellResizing = useStore((s) => s.shellResizing !== null)
  const walking = useStore((s) => s.viewMode === 'walk')

  useEffect(() => {
    if (walking) return
    if (!placing && !dragging && !resizing && !shellResizing) return
    const el = gl.domElement
    if (controls) controls.enabled = false
    const raycaster = new THREE.Raycaster()
    const pt = new THREE.Vector3()

    const setRay = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
    }
    // intersect a horizontal plane at the given height (ground = 0, mezzanine top = its h)
    const projectAt = (e: PointerEvent, y: number): THREE.Vector3 | null => {
      setRay(e)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
      return raycaster.ray.intersectPlane(plane, pt) ? pt : null
    }
    const overCanvas = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    }

    const handleResize = (e: PointerEvent) => {
      const s = useStore.getState()
      const r = s.resizing
      if (!r) return
      const o = s.objects.find((v) => v.id === r.id)
      if (!o) return
      const base = elevationFor(o, s.objects)
      if (r.axis === 'y') {
        // intersect a vertical, camera-facing plane through the object's center
        setRay(e)
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        dir.y = 0
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
        dir.normalize()
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, new THREE.Vector3(o.x, 0, o.z))
        if (!raycaster.ray.intersectPlane(plane, pt)) return
        const h = Math.max(0.1, Math.round((pt.y - base) / 0.25) * 0.25)
        if (h !== o.h) s.updateObject(o.id, { h })
        return
      }
      // Edge-anchored horizontal resize: the dragged side follows the pointer,
      // the opposite side stays fixed (center shifts by half the size change).
      const p = projectAt(e, base)
      if (!p) return
      const th = (o.rot * Math.PI) / 4
      const dir =
        r.axis === 'x'
          ? { x: Math.cos(th), z: -Math.sin(th) }
          : { x: Math.sin(th), z: Math.cos(th) }
      const u = (p.x - r.start.x) * dir.x + (p.z - r.start.z) * dir.z
      const startDim = r.axis === 'x' ? r.start.w : r.start.d
      const newDim = snapDim(r.sign * u + startDim / 2)
      const shift = (r.sign * (newDim - startDim)) / 2
      const nx = r.start.x + dir.x * shift
      const nz = r.start.z + dir.z * shift
      s.resizeObject(o.id, r.axis === 'x' ? { w: newDim, x: nx, z: nz } : { d: newDim, x: nx, z: nz })
    }

    // shell arrows: each length arrow drags ONLY its own gable end (the other
    // end stays anchored) and writes straight into the BUILDING length, so the
    // toolbar number updates live; eave height uses a camera-facing plane
    const handleShellResize = (e: PointerEvent) => {
      const s = useStore.getState()
      if (s.shellResizing === 'length+' || s.shellResizing === 'length-') {
        const p = projectAt(e, 0)
        if (!p) return
        const sign = s.shellResizing === 'length+' ? 1 : -1
        const curL = s.building.length
        const fixedEnd = s.building.centerZ - (sign * curL) / 2
        const draggedEnd = Math.round(p.z / 0.5) * 0.5
        const newL = Math.max(4, sign * (draggedEnd - fixedEnd))
        s.setBuilding({ length: newL, centerZ: fixedEnd + (sign * newL) / 2 })
      } else if (s.shellResizing === 'height') {
        setRay(e)
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        dir.y = 0
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
        dir.normalize()
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, new THREE.Vector3(0, 0, 0))
        if (!raycaster.ray.intersectPlane(plane, pt)) return
        const rise = (s.building.width / 2) * ROOF_PITCH
        s.setShellEave(Math.round((pt.y - rise) / 0.25) * 0.25)
      }
    }

    const onMove = (e: PointerEvent) => {
      const s = useStore.getState()
      if (s.shellResizing) {
        handleShellResize(e)
        return
      }
      if (s.resizing) {
        handleResize(e)
        return
      }
      if (s.placingDef) {
        const p = projectAt(e, 0)
        if (p) s.updateGhost(p.x, p.z)
      } else if (s.draggingId) {
        const p = projectAt(e, s.dragPlaneY)
        if (p) s.moveTo(p.x, p.z)
      }
    }
    const onUp = (e: PointerEvent) => {
      const s = useStore.getState()
      if (s.shellResizing) s.setShellResizing(null)
      else if (s.resizing) s.setResizing(null)
      else if (s.draggingId) s.endMove()
      else if (s.placingDef && overCanvas(e) && s.ghost) setTimeout(() => useStore.getState().commitPlacing(), 0)
    }
    // In "sticky" placing mode (item picked with a tap/click), a press on the canvas
    // drops it. On touch there is no hover, so project the tap point first. The
    // commit is deferred past the pointerdown dispatch so the deselect-catcher mesh
    // (handling this same event) still sees placingDef set.
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const s = useStore.getState()
      if (!s.placingDef) return
      const p = projectAt(e, 0)
      if (p) s.updateGhost(p.x, p.z)
      setTimeout(() => useStore.getState().commitPlacing(), 0)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerdown', onDown)
      if (controls) controls.enabled = true
    }
  }, [placing, dragging, resizing, shellResizing, walking, gl, camera, controls])

  return null
}

// Translucent preview of the object being placed (green = legal, red = rejected)
function Ghost() {
  const def = useStore((s) => s.placingDef)
  const ghost = useStore((s) => s.ghost)
  if (!def || !ghost) return null
  const { fw, fd } = fp({ w: def.w, d: def.d, rot: ghost.rot })
  const h = Math.max(def.h, 0.3)
  const color = ghost.valid ? '#22c55e' : '#ef4444'
  return (
    <group position={[ghost.x, 0, ghost.z]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[fw, h, fd]} />
        <meshStandardMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[fw, fd]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Screen-space priority picking for the resize arrows. Taps within a radius of
 * an arrow ALWAYS grab that arrow — before the 3D raycast can hit whatever
 * object happens to be behind it — so adjusting size next to other items never
 * accidentally selects them. Runs as a capture-phase listener so it beats the
 * r3f event system on the same canvas element.
 */
function ArrowPriorityPicker() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const selectedId = useStore((s) => s.selectedId)
  const shellMode = useStore((s) => s.shell.mode)
  const walking = useStore((s) => s.viewMode === 'walk')

  const measuring = useStore((s) => s.measuring)

  useEffect(() => {
    if (walking || measuring) return // arrows hidden while walking / measuring
    if (!selectedId && shellMode === 0) return
    const el = gl.domElement

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const s = useStore.getState()
      if (s.placingDef) return
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const thresh = e.pointerType === 'touch' ? 46 : 30
      const toScreen = (v: THREE.Vector3): [number, number] => {
        const p = v.clone().project(camera)
        return [((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height]
      }
      const cands: Array<{ d: number; act: () => void }> = []
      const add = (v: THREE.Vector3, act: () => void) => {
        const [sx, sy] = toScreen(v)
        cands.push({ d: Math.hypot(sx - px, sy - py), act })
      }

      // while Move is armed the arrows are hidden, so they must not steal taps
      const o = s.moveArmed ? undefined : s.objects.find((v) => v.id === s.selectedId)
      if (o) {
        const elev = elevationFor(o, s.objects)
        const th = (o.rot * Math.PI) / 4
        const loc = (lx: number, ly: number, lz: number) =>
          new THREE.Vector3(
            o.x + lx * Math.cos(th) + lz * Math.sin(th),
            elev + ly,
            o.z - lx * Math.sin(th) + lz * Math.cos(th),
          )
        const yMid = arrowLevel(o)
        const start = (axis: ResizeAxis, sign: 1 | -1) => () =>
          s.setResizing({ id: o.id, axis, sign, start: { w: o.w, d: o.d, x: o.x, z: o.z } })
        add(loc(o.w / 2 + 0.95, yMid, 0), start('x', 1))
        add(loc(-o.w / 2 - 0.95, yMid, 0), start('x', -1))
        add(loc(0, yMid, o.d / 2 + 0.95), start('z', 1))
        add(loc(0, yMid, -o.d / 2 - 0.95), start('z', -1))
        add(loc(0, o.h + 0.95, 0), start('y', 1))
      }
      if (s.shell.mode > 0) {
        const L = s.building.length
        const off = s.building.centerZ
        const ridge = s.shell.eave + (s.building.width / 2) * ROOF_PITCH
        add(new THREE.Vector3(0, 1.2, off + L / 2 + 1.6), () => s.setShellResizing('length+'))
        add(new THREE.Vector3(0, 1.2, off - L / 2 - 1.6), () => s.setShellResizing('length-'))
        add(new THREE.Vector3(0, ridge + 1.4, off), () => s.setShellResizing('height'))
      }
      if (cands.length === 0) return
      cands.sort((a, b) => a.d - b.d)
      if (cands[0].d <= thresh) {
        e.preventDefault()
        e.stopImmediatePropagation() // keep r3f from selecting whatever is behind the arrow
        if (controls) controls.enabled = false
        cands[0].act()
      }
    }

    el.addEventListener('pointerdown', onDown, { capture: true })
    return () => el.removeEventListener('pointerdown', onDown, { capture: true })
  }, [selectedId, shellMode, walking, measuring, gl, camera, controls])

  return null
}

// Five arrows to drag-resize the selected object: one per SIDE for width and
// depth (the dragged side moves, the opposite side stays fixed) plus one for
// height. Red = width sides, blue = depth sides, green = height.
function ResizeGizmo({ o, elev }: { o: Placed; elev: number }) {
  const setResizing = useStore((s) => s.setResizing)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const start = (axis: ResizeAxis, sign: 1 | -1) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    const r: ResizeState = { id: o.id, axis, sign, start: { w: o.w, d: o.d, x: o.x, z: o.z } }
    setResizing(r)
  }
  const yMid = arrowLevel(o)
  return (
    <group position={[o.x, elev, o.z]} rotation-y={(o.rot * Math.PI) / 4}>
      <ArrowHandle color="#dc2626" pos={[o.w / 2 + 0.35, yMid, 0]} rot={[0, 0, -Math.PI / 2]} onDown={start('x', 1)} />
      <ArrowHandle color="#dc2626" pos={[-o.w / 2 - 0.35, yMid, 0]} rot={[0, 0, Math.PI / 2]} onDown={start('x', -1)} />
      <ArrowHandle color="#2563eb" pos={[0, yMid, o.d / 2 + 0.35]} rot={[Math.PI / 2, 0, 0]} onDown={start('z', 1)} />
      <ArrowHandle color="#2563eb" pos={[0, yMid, -o.d / 2 - 0.35]} rot={[-Math.PI / 2, 0, 0]} onDown={start('z', -1)} />
      <ArrowHandle color="#16a34a" pos={[0, o.h + 0.25, 0]} rot={[0, 0, 0]} onDown={start('y', 1)} />
    </group>
  )
}

function SceneContent() {
  const objects = useStore((s) => s.objects)
  const building = useStore((s) => s.building)
  const select = useStore((s) => s.select)
  const selectedId = useStore((s) => s.selectedId)
  const moveArmed = useStore((s) => s.moveArmed)
  const walking = useStore((s) => s.viewMode === 'walk')
  const plan = useStore((s) => s.planMode)
  const warnings = useMemo(() => getWarningIds(objects, building), [objects, building])
  // hide the resize arrows while Move mode is armed — moving and resizing are
  // separate gestures, and the arrows would only get in the way of the drag
  const selected = moveArmed || walking ? undefined : objects.find((o) => o.id === selectedId)

  return (
    <>
      <MoodLights />
      <RealisticExtras />

      <BuildingFloor />
      {!walking && <GridOverlay />}
      {objects.map((o) => (
        <PlacedObject key={o.id} o={o} warning={warnings.has(o.id)} elev={elevationFor(o, objects)} />
      ))}
      {selected && <ResizeGizmo o={selected} elev={elevationFor(selected, objects)} />}
      <Ghost />
      {plan ? (
        <PlanBuildingOutline width={building.width} length={building.length} apron={building.apron} centerZ={building.centerZ} />
      ) : (
        <WarehouseShell />
      )}
      <MeasureGraphics />

      {/* invisible catcher: click empty ground to deselect */}
      <mesh
        position={[0, -0.01, 0]}
        rotation-x={-Math.PI / 2}
        onPointerDown={(e) => {
          if (e.button === 0 && !useStore.getState().placingDef) select(null)
        }}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  )
}

export function Scene() {
  const viewKey = useStore((s) => s.viewKey)
  const walking = useStore((s) => s.viewMode === 'walk')
  const mood = useStore((s) => s.lightMood)
  const bg = MOODS[mood].bg
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ background: bg }}>
      <color attach="background" args={[bg]} />
      <CaptureBinder />
      <group key={`rig-${viewKey}-${walking ? 'walk' : 'orbit'}`}>{walking ? <WalkRig /> : <CameraRig />}</group>
      <DragController />
      <ArrowPriorityPicker />
      <MeasureController />
      <SceneContent />
    </Canvas>
  )
}
