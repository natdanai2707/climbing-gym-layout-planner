import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { useStore } from '../store'
import { BuildingFloor } from './BuildingFloor'
import { GridOverlay } from './GridOverlay'
import { PlacedObject } from './PlacedObject'
import { fp, getWarningIds } from '../placement'

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

/**
 * Handles both interaction modes by raycasting the pointer onto the y=0 plane:
 *  - placing a new object from the palette (ghost follows the cursor)
 *  - dragging an already-placed object
 * Listening on window (not on meshes) means the drag never "drops" when the
 * cursor passes over another object.
 */
function DragController() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const placing = useStore((s) => s.placingDef !== null)
  const dragging = useStore((s) => s.draggingId !== null)

  useEffect(() => {
    if (!placing && !dragging) return
    const el = gl.domElement
    if (controls) controls.enabled = false
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const pt = new THREE.Vector3()

    const project = (e: PointerEvent): THREE.Vector3 | null => {
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, pt) ? pt : null
    }
    const overCanvas = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    }

    const onMove = (e: PointerEvent) => {
      const p = project(e)
      if (!p) return
      const s = useStore.getState()
      if (s.placingDef) s.updateGhost(p.x, p.z)
      else if (s.draggingId) s.moveTo(p.x, p.z)
    }
    const onUp = (e: PointerEvent) => {
      const s = useStore.getState()
      if (s.draggingId) s.endMove()
      else if (s.placingDef && overCanvas(e) && s.ghost) s.commitPlacing()
    }
    // In "sticky" placing mode (item picked with a tap/click), a press on the canvas
    // drops it. On touch there is no hover, so project the tap point first — the
    // ghost may not exist yet. The commit itself is deferred until after the
    // pointerdown event fully dispatches: the deselect-catcher mesh also handles
    // this same event, and if placingDef were already cleared it would deselect
    // the object we just placed.
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const s = useStore.getState()
      if (!s.placingDef) return
      const p = project(e)
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
  }, [placing, dragging, gl, camera, controls])

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

function SceneContent() {
  const objects = useStore((s) => s.objects)
  const building = useStore((s) => s.building)
  const select = useStore((s) => s.select)
  const warnings = useMemo(() => getWarningIds(objects, building), [objects, building])

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
        <PlacedObject key={o.id} o={o} warning={warnings.has(o.id)} />
      ))}
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
