import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../store'
import { fp } from '../placement'
import type { Placed } from '../types'

/**
 * "Life" animation: little people populate the finished design —
 *  - walkers wander the building floor (and mezzanine tops)
 *  - climbers go up and down the climbing-wall faces
 *  - chillers stand around in activity zones, bobbing slightly
 * Everything is animated imperatively in useFrame; the figures ignore raycasts
 * so they never block selecting the objects underneath.
 */

const SHIRT = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#64748b']
const SKIN = ['#f2c9a0', '#e0ac7e', '#b98058', '#8d5f3d']

interface Agent {
  kind: 'walk' | 'climb' | 'stand'
  x: number
  z: number
  y: number
  tx: number
  tz: number
  speed: number
  phase: number
  scale: number
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number; y: number }
  wall?: { obj: Placed; lx: number; face: number } // face: local z of the climbing surface
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

function localToWorld(o: Placed, lx: number, lz: number): [number, number] {
  const th = (o.rot * Math.PI) / 4
  return [o.x + lx * Math.cos(th) + lz * Math.sin(th), o.z - lx * Math.sin(th) + lz * Math.cos(th)]
}

function Person({ agent }: { agent: Agent }) {
  const ref = useRef<THREE.Group>(null)
  const shirt = useMemo(() => SHIRT[Math.floor(Math.random() * SHIRT.length)], [])
  const skin = useMemo(() => SKIN[Math.floor(Math.random() * SKIN.length)], [])

  useFrame(({ clock }, dt) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime
    const a = agent
    if (a.kind === 'climb' && a.wall) {
      const o = a.wall.obj
      // oscillate up and down the wall with a little lateral sway
      const cycle = 0.5 - 0.5 * Math.cos(t * a.speed + a.phase)
      const y = 0.35 + Math.max(0.5, o.h - 1.6) * cycle
      const sway = Math.sin(t * 1.7 + a.phase) * 0.25
      const [wx, wz] = localToWorld(o, a.wall.lx + sway, a.wall.face)
      g.position.set(wx, y, wz)
      g.rotation.y = (-o.rot * Math.PI) / 4 + Math.PI // face the wall
      return
    }
    if (a.kind === 'stand') {
      g.position.set(a.x, a.y + Math.sin(t * 2.2 + a.phase) * 0.03, a.z)
      g.rotation.y = a.phase
      return
    }
    // walker: head toward target, pick a new one on arrival
    const dx = a.tx - a.x
    const dz = a.tz - a.z
    const dist = Math.hypot(dx, dz)
    const step = a.speed * Math.min(dt, 0.05)
    if (dist < 0.3) {
      const b = a.bounds!
      a.tx = rnd(b.minX, b.maxX)
      a.tz = rnd(b.minZ, b.maxZ)
    } else {
      a.x += (dx / dist) * step
      a.z += (dz / dist) * step
    }
    g.position.set(a.x, a.y + Math.abs(Math.sin(t * 6 + a.phase)) * 0.05, a.z)
    g.rotation.y = Math.atan2(dx, dz)
  })

  return (
    <group ref={ref} scale={agent.scale} raycast={() => null}>
      <mesh position={[0, 0.62, 0]} castShadow raycast={() => null}>
        <capsuleGeometry args={[0.16, 0.55, 3, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.2, 0]} raycast={() => null}>
        <capsuleGeometry args={[0.12, 0.3, 3, 8]} />
        <meshStandardMaterial color="#374151" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.12, 0]} castShadow raycast={() => null}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
    </group>
  )
}

export function People() {
  const animate = useStore((s) => s.animate)
  const objects = useStore((s) => s.objects)
  const building = useStore((s) => s.building)

  const agents = useMemo(() => {
    if (!animate) return []
    const list: Agent[] = []
    const hw = building.width / 2 - 0.6
    const hl = building.length / 2 - 0.6
    const groundBounds = { minX: -hw, maxX: hw, minZ: -hl, maxZ: hl, y: 0 }
    const walls = objects.filter(
      (o) => o.category === 'wall_low' || o.category === 'wall_high' || o.category === 'wall_island',
    )
    const zones = objects.filter((o) => o.category === 'zone')
    const mezz = objects.filter((o) => o.category === 'mezzanine')

    const total = Math.round(Math.min(44, Math.max(12, (building.width * building.length) / 30)))

    // climbers: a couple per wall
    for (const wOb of walls) {
      const n = Math.min(3, Math.max(1, Math.round(wOb.w / 4)))
      for (let i = 0; i < n; i++) {
        const face = wOb.category === 'wall_island' ? wOb.d / 2 + 0.2 : -wOb.d / 2 + 0.7
        list.push({
          kind: 'climb',
          x: 0, z: 0, y: 0, tx: 0, tz: 0,
          speed: rnd(0.35, 0.7),
          phase: rnd(0, Math.PI * 2),
          scale: rnd(0.9, 1.05),
          wall: { obj: wOb, lx: rnd(-wOb.w / 2 + 0.6, wOb.w / 2 - 0.6), face },
        })
      }
    }
    // chillers in zones
    for (const zOb of zones) {
      const { fw, fd } = fp(zOb)
      const n = Math.min(4, Math.max(1, Math.round((fw * fd) / 25)))
      for (let i = 0; i < n; i++) {
        list.push({
          kind: 'stand',
          x: zOb.x + rnd(-fw / 2 + 0.5, fw / 2 - 0.5),
          z: zOb.z + rnd(-fd / 2 + 0.5, fd / 2 - 0.5),
          y: 0.1,
          tx: 0, tz: 0,
          speed: 1,
          phase: rnd(0, Math.PI * 2),
          scale: rnd(0.9, 1.05),
        })
      }
    }
    // walkers on mezzanine tops
    for (const m of mezz) {
      const { fw, fd } = fp(m)
      if (fw < 3 || fd < 3) continue
      const b = {
        minX: m.x - fw / 2 + 0.7,
        maxX: m.x + fw / 2 - 0.7,
        minZ: m.z - fd / 2 + 0.7,
        maxZ: m.z + fd / 2 - 0.7,
        y: m.h,
      }
      for (let i = 0; i < 2; i++) {
        list.push({
          kind: 'walk',
          x: rnd(b.minX, b.maxX), z: rnd(b.minZ, b.maxZ), y: m.h,
          tx: rnd(b.minX, b.maxX), tz: rnd(b.minZ, b.maxZ),
          speed: rnd(0.8, 1.4), phase: rnd(0, Math.PI * 2), scale: rnd(0.9, 1.05),
          bounds: b,
        })
      }
    }
    // remaining walkers on the ground floor
    while (list.length < total) {
      list.push({
        kind: 'walk',
        x: rnd(groundBounds.minX, groundBounds.maxX),
        z: rnd(groundBounds.minZ, groundBounds.maxZ),
        y: 0,
        tx: rnd(groundBounds.minX, groundBounds.maxX),
        tz: rnd(groundBounds.minZ, groundBounds.maxZ),
        speed: rnd(0.9, 1.8),
        phase: rnd(0, Math.PI * 2),
        scale: rnd(0.88, 1.08),
        bounds: groundBounds,
      })
    }
    return list
    // respawn only when toggled or the layout meaningfully changes
  }, [animate, objects, building])

  if (!animate) return null
  return (
    <group>
      {agents.map((a, i) => (
        <Person key={i} agent={a} />
      ))}
    </group>
  )
}
