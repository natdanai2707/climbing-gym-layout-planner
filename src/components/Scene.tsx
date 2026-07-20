import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { useStore } from '../store'
import type { ResizeAxis, ResizeState } from '../store'
import type { Placed } from '../types'
import { BuildingFloor } from './BuildingFloor'
import { GridOverlay } from './GridOverlay'
import { PlacedObject } from './PlacedObject'
import { elevationFor, fp, getWarningIds } from '../placement'

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

// Default isometric camera + orbit controls. Remounted (via key) to reset the view.
// Initial zoom scales with the viewport so the building fits on phone screens too.
function CameraRig() {
  const size = useThree((s) => s.size)
  const zoom = useMemo(() => Math.max(4, Math.min(13, Math.min(size.width, size.height) / 65)), [])
  return (
    <>
      <OrthographicCamera makeDefault position={[70, 70, 70]} zoom={zoom} near={-500} far={1000} />
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.05} />
    </>
  )
}

const snapDim = (v: number) => Math.max(0.25, Math.round(v / 0.25) * 0.25)

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

  useEffect(() => {
    if (!placing && !dragging && !resizing) return
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

    const onMove = (e: PointerEvent) => {
      const s = useStore.getState()
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
      if (s.resizing) s.setResizing(null)
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
  }, [placing, dragging, resizing, gl, camera, controls])

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

// One draggable dimension arrow (shaft + head + a fat invisible touch target)
function ArrowHandle({
  color,
  pos,
  rot,
  onDown,
}: {
  color: string
  pos: [number, number, number]
  rot: [number, number, number]
  onDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  return (
    <group position={pos} rotation={rot} onPointerDown={onDown}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.9, 8]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <coneGeometry args={[0.18, 0.45, 10]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </mesh>
      {/* generous invisible hit area for touch */}
      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.55, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
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
  const yMid = Math.min(Math.max(o.h * 0.5, 0.25), 1.2)
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
  const warnings = useMemo(() => getWarningIds(objects, building), [objects, building])
  const selected = objects.find((o) => o.id === selectedId)

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight
        position={[35, 60, 20]}
        intensity={1.4}
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
      <hemisphereLight intensity={0.35} groundColor="#c8bfae" />

      <BuildingFloor />
      <GridOverlay />
      {objects.map((o) => (
        <PlacedObject key={o.id} o={o} warning={warnings.has(o.id)} elev={elevationFor(o, objects)} />
      ))}
      {selected && <ResizeGizmo o={selected} elev={elevationFor(selected, objects)} />}
      <Ghost />

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
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ background: '#eceae4' }}>
      <CaptureBinder />
      <group key={`rig-${viewKey}`}>
        <CameraRig />
      </group>
      <DragController />
      <SceneContent />
    </Canvas>
  )
}
