import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import type { Placed } from '../types'
import { useStore } from '../store'
import { fp } from '../placement'

const MAT = { roughness: 0.85, metalness: 0 }

function hatchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.globalAlpha = 0
  g.fillRect(0, 0, 64, 64)
  g.globalAlpha = 1
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

/**
 * Category-specific rendering:
 *  - wall_low / wall_high : tall climbing-wall slab along the BACK edge of the footprint
 *                           (rendered at real height, so the 12 m wall towers) + a thin
 *                           landing-mat plane covering the rest of the footprint.
 *  - zone                 : a low colored flooring patch, not a solid box.
 *  - room                 : open-top box with thin walls (dollhouse cutaway) + colored floor.
 *  - door                 : colored marker slab embedded in the perimeter wall.
 *  - parking              : flat outdoor slab with a diagonal hatch + outline.
 *  - reception / fixture  : simple solid box at real height.
 */
function CategoryMesh({ o, tint }: { o: Placed; tint: string | null }) {
  const color = tint ?? o.color
  const hatch = useMemo(() => {
    if (o.category !== 'parking') return null
    const t = hatchTexture()
    t.repeat.set(o.w / 1.5, o.d / 1.5)
    return t
  }, [o.category, o.w, o.d])

  switch (o.category) {
    case 'wall_low':
    case 'wall_high': {
      const t = 0.5 // wall slab thickness
      return (
        <group>
          <mesh position={[0, o.h / 2, -o.d / 2 + t / 2]} castShadow receiveShadow>
            <boxGeometry args={[o.w, o.h, t]} />
            <meshStandardMaterial color={color} {...MAT} />
          </mesh>
          {/* landing mats in front of the wall */}
          <mesh position={[0, 0.08, t / 2]} castShadow receiveShadow>
            <boxGeometry args={[o.w, 0.16, Math.max(0.1, o.d - t)]} />
            <meshStandardMaterial color={tint ?? '#cfdcf0'} {...MAT} />
          </mesh>
        </group>
      )
    }
    case 'zone':
      return (
        <mesh position={[0, Math.min(o.h, 0.1) / 2 + 0.01, 0]} receiveShadow>
          <boxGeometry args={[o.w, Math.min(o.h, 0.1), o.d]} />
          <meshStandardMaterial color={color} {...MAT} transparent opacity={0.85} />
        </mesh>
      )
    case 'room': {
      const t = 0.12 // interior wall thickness
      return (
        <group>
          <mesh position={[0, 0.03, 0]} receiveShadow>
            <boxGeometry args={[o.w, 0.06, o.d]} />
            <meshStandardMaterial color={color} {...MAT} />
          </mesh>
          <mesh position={[0, o.h / 2, -o.d / 2 + t / 2]} castShadow receiveShadow>
            <boxGeometry args={[o.w, o.h, t]} />
            <meshStandardMaterial color={tint ?? '#f6f3ed'} {...MAT} />
          </mesh>
          <mesh position={[0, o.h / 2, o.d / 2 - t / 2]} castShadow receiveShadow>
            <boxGeometry args={[o.w, o.h, t]} />
            <meshStandardMaterial color={tint ?? '#f6f3ed'} {...MAT} />
          </mesh>
          <mesh position={[-o.w / 2 + t / 2, o.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[t, o.h, Math.max(0.05, o.d - t * 2)]} />
            <meshStandardMaterial color={tint ?? '#f6f3ed'} {...MAT} />
          </mesh>
          <mesh position={[o.w / 2 - t / 2, o.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[t, o.h, Math.max(0.05, o.d - t * 2)]} />
            <meshStandardMaterial color={tint ?? '#f6f3ed'} {...MAT} />
          </mesh>
        </group>
      )
    }
    case 'door':
      return (
        <mesh position={[0, o.h / 2, 0]} castShadow>
          <boxGeometry args={[o.w, o.h, Math.max(0.28, o.d)]} />
          <meshStandardMaterial color={color} {...MAT} />
          <Edges color="#ffffff" />
        </mesh>
      )
    case 'parking':
      return (
        <group>
          <mesh position={[0, 0.03, 0]} receiveShadow>
            <boxGeometry args={[o.w, 0.06, o.d]} />
            <meshStandardMaterial color={color} {...MAT} />
          </mesh>
          {hatch && (
            <mesh position={[0, 0.065, 0]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[o.w, o.d]} />
              <meshBasicMaterial map={hatch} transparent />
            </mesh>
          )}
          <mesh position={[0, 0.035, 0]}>
            <boxGeometry args={[o.w, 0.061, o.d]} />
            <meshBasicMaterial visible={false} />
            <Edges color="#ffffff" />
          </mesh>
        </group>
      )
    default:
      // reception / fixture: plain solid box
      return (
        <mesh position={[0, o.h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[o.w, o.h, o.d]} />
          <meshStandardMaterial color={color} {...MAT} />
        </mesh>
      )
  }
}

export function PlacedObject({ o, warning }: { o: Placed; warning: boolean }) {
  const selected = useStore((s) => s.selectedId === o.id)
  const showLabels = useStore((s) => s.showLabels)
  const beginMove = useStore((s) => s.beginMove)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  const tint = warning ? '#e05252' : null
  const baseY = o.rule === 'outdoor' ? -0.04 : 0
  const { fw, fd } = fp(o)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    beginMove(o.id, e.point.x, e.point.z)
  }

  return (
    <group position={[o.x, baseY, o.z]}>
      <group rotation-y={(o.rot * Math.PI) / 2} onPointerDown={onPointerDown}>
        <CategoryMesh o={o} tint={tint} />
      </group>
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[fw + 0.7, fd + 0.7]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
      {showLabels && (
        <Html
          position={[0, (o.category === 'zone' || o.category === 'parking' ? 0.4 : o.h) + 0.7, 0]}
          center
          zIndexRange={[40, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`obj-label${selected ? ' sel' : ''}`}>{o.label}</div>
        </Html>
      )}
    </group>
  )
}
