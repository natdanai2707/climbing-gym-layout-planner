import { useMemo } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { useStore } from '../store'
import { ArrowHandle } from './gizmo'
import { surfaceMap, surfaceMapWorld, surfaceNormal, surfaceNormalWorld } from '../materials'
import { shellOpenings, wallPanels } from '../placement'

// Roof pitch of the gable (rise over half-width). ~15°.
export const ROOF_PITCH = Math.tan((15 * Math.PI) / 180)


const spread = (n: number, size: number) => Array.from({ length: n }, (_, i) => ((i + 0.5) / n - 0.5) * size)

/**
 * Gable-roof warehouse shell around the building. The gable (triangle) sits on
 * the SHORT ends, so the ridge runs along the building's length. Width follows
 * the building (20 m by default); length and eave height are adjustable with
 * the orange arrows.
 * Modes: 1 = transparent ghost; 2 = complete solid shell that hides the
 * interior but shows the placed entrance/fire-exit doors on the facade plus
 * window bands where a real warehouse would have them.
 */
export function WarehouseShell() {
  const shell = useStore((s) => s.shell)
  const building = useStore((s) => s.building)
  const objects = useStore((s) => s.objects)
  const setShellResizing = useStore((s) => s.setShellResizing)
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  // no adjustment arrows while walking inside or measuring
  const presenting = useStore((s) => s.viewMode === 'walk' || s.measuring)
  const detail = useStore((s) => s.quality !== 'low')

  const W = building.width
  const L = building.length
  const eave = shell.eave
  const rise = (W / 2) * ROOF_PITCH
  const ridge = eave + rise
  const t = 0.15

  const gable = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-W / 2, 0)
    s.lineTo(W / 2, 0)
    s.lineTo(W / 2, eave)
    s.lineTo(0, ridge)
    s.lineTo(-W / 2, eave)
    s.closePath()
    return s
  }, [W, eave, ridge])

  // Glazing is not automatic any more: the facade is solid cladding until a
  // "Glass Opening" item is dropped on a wall, which cuts a hole there. One
  // opening list per wall, in that wall's own local coordinates.
  const northGlass = useMemo(() => shellOpenings(objects, 0, building.centerZ, eave), [objects, building.centerZ, eave])
  const southGlass = useMemo(() => shellOpenings(objects, 4, building.centerZ, eave), [objects, building.centerZ, eave])
  const westGlass = useMemo(() => shellOpenings(objects, 2, building.centerZ, eave), [objects, building.centerZ, eave])
  const eastGlass = useMemo(() => shellOpenings(objects, 6, building.centerZ, eave), [objects, building.centerZ, eave])
  // the gable is a pentagon; a hole in it is a rectangular path punched out
  const gableWith = (ops: typeof northGlass) =>
    (() => {
      const sh = new THREE.Shape()
      sh.moveTo(-W / 2, 0)
      sh.lineTo(W / 2, 0)
      sh.lineTo(W / 2, eave)
      sh.lineTo(0, ridge)
      sh.lineTo(-W / 2, eave)
      sh.closePath()
      for (const o of ops) {
        const x0 = Math.max(-W / 2 + 0.02, o.c - o.w / 2)
        const x1 = Math.min(W / 2 - 0.02, o.c + o.w / 2)
        if (x1 - x0 < 0.05) continue
        const p = new THREE.Path()
        p.moveTo(x0, o.y0)
        p.lineTo(x1, o.y0)
        p.lineTo(x1, o.y1)
        p.lineTo(x0, o.y1)
        p.closePath()
        sh.holes.push(p)
      }
      return sh
    })()

  // only perimeter doors show on the facade — interior room doors stay inside
  const doors = useMemo(() => objects.filter((o) => o.category === 'door' && o.rule === 'edge'), [objects])

  // skylight strips let daylight into the hall — one every ~6 m per roof plane
  const skylights = useMemo(() => {
    const n = Math.max(1, Math.floor((L - 2) / 6))
    return spread(n, L - 3)
  }, [L])

  if (shell.mode === 0) return null
  const transparent = shell.mode === 1

  // solid walls read as real corrugated metal-sheet cladding
  const wallMat = transparent
    ? { color: '#8fb0cc', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }
    : {
        color: '#ffffff',
        map: surfaceMap('metalsheet', L, eave),
        normalMap: detail ? surfaceNormal('metalsheet', L, eave) : undefined,
        roughness: 0.45,
        metalness: 0.35,
        side: THREE.DoubleSide,
      }
  const gableMat = transparent
    ? wallMat
    : {
        color: '#ffffff',
        map: surfaceMapWorld('metalsheet'),
        normalMap: detail ? surfaceNormalWorld('metalsheet') : undefined,
        roughness: 0.45,
        metalness: 0.35,
        side: THREE.DoubleSide,
      }
  const roofMat = transparent
    ? { color: '#7fa3c4', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }
    : { color: '#cfd6dd', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }

  const slope = Math.atan2(rise, W / 2)
  const roofLen = Math.hypot(W / 2, rise) + 0.3

  const startResize = (which: 'length+' | 'length-' | 'height') => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    setShellResizing(which)
  }

  const off = building.centerZ
  // Door panels drawn on the OUTSIDE of the shell, at each placed door's spot
  // (local coords — the whole shell group is shifted by the z offset).
  // rot encodes the wall the door snapped to: 0 = north (-z), 4 = south (+z),
  // 2 = west (-x), 6 = east (+x).
  const doorPanels = (): ReactNode[] =>
    doors.map((d) => {
      const frame = '#6b7280'
      if (d.rot === 0 || d.rot === 4) {
        const z = (d.rot === 0 ? -L / 2 - t - 0.05 : L / 2 + t + 0.05)
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
    })

  return (
    // key remounts the shell when the mode changes — otherwise r3f keeps the
    // transparent-mode material props (opacity/depthWrite) on the solid shell.
    // The z offset lets one gable end be moved while the other stays put.
    <group key={shell.mode} position={[0, 0, off]}>
      {transparent ? (
        <>
          {/* long side walls */}
          <mesh position={[-W / 2 - t / 2, eave / 2, 0]}>
            <boxGeometry args={[t, eave, L]} />
            <meshStandardMaterial {...wallMat} />
            <Edges color="#5c7fa6" />
          </mesh>
          <mesh position={[W / 2 + t / 2, eave / 2, 0]}>
            <boxGeometry args={[t, eave, L]} />
            <meshStandardMaterial {...wallMat} />
            <Edges color="#5c7fa6" />
          </mesh>
          {/* gable end walls (short sides) */}
          <mesh position={[0, 0, -L / 2 - t / 2]}>
            <shapeGeometry args={[gable]} />
            <meshStandardMaterial {...gableMat} />
          </mesh>
          <mesh position={[0, 0, L / 2 + t / 2]}>
            <shapeGeometry args={[gable]} />
            <meshStandardMaterial {...gableMat} />
          </mesh>
        </>
      ) : (
        <>
          {/* long side walls: solid cladding, opened where glass is placed */}
          {([-1, 1] as const).map((sx) => (
            <group key={sx} position={[sx * (W / 2 + t / 2), 0, 0]}>
              {wallPanels(L, eave, sx < 0 ? westGlass : eastGlass).map((p, i) => (
                <mesh key={i} position={[0, (p.y0 + p.y1) / 2, (p.u0 + p.u1) / 2]} castShadow receiveShadow>
                  <boxGeometry args={[t, p.y1 - p.y0, p.u1 - p.u0]} />
                  <meshStandardMaterial {...wallMat} />
                </mesh>
              ))}
            </group>
          ))}
          {/* gable ends: one pentagon per end with the glazing punched out */}
          {([-1, 1] as const).map((sz) => (
            <group key={`e${sz}`} position={[0, 0, sz * (L / 2 + t / 2)]}>
              <mesh>
                <shapeGeometry args={[gableWith(sz < 0 ? northGlass : southGlass)]} />
                <meshStandardMaterial {...gableMat} />
              </mesh>
            </group>
          ))}
        </>
      )}
      {/* roof planes with translucent skylight strips */}
      <group position={[-W / 4, (eave + ridge) / 2, 0]} rotation-z={slope}>
        <mesh>
          <boxGeometry args={[roofLen, 0.12, L + 0.4]} />
          <meshStandardMaterial {...roofMat} />
          {transparent && <Edges color="#5c7fa6" />}
        </mesh>
        {!transparent &&
          skylights.map((z, i) => (
            <mesh key={i} position={[0, 0.08, z]}>
              <boxGeometry args={[roofLen * 0.55, 0.05, 1.2]} />
              <meshStandardMaterial color="#f2f7fa" transparent opacity={0.55} roughness={0.25} emissive="#dfeaf2" emissiveIntensity={0.25} />
            </mesh>
          ))}
      </group>
      <group position={[W / 4, (eave + ridge) / 2, 0]} rotation-z={-slope}>
        <mesh>
          <boxGeometry args={[roofLen, 0.12, L + 0.4]} />
          <meshStandardMaterial {...roofMat} />
          {transparent && <Edges color="#5c7fa6" />}
        </mesh>
        {!transparent &&
          skylights.map((z, i) => (
            <mesh key={i} position={[0, 0.08, z]}>
              <boxGeometry args={[roofLen * 0.55, 0.05, 1.2]} />
              <meshStandardMaterial color="#f2f7fa" transparent opacity={0.55} roughness={0.25} emissive="#dfeaf2" emissiveIntensity={0.25} />
            </mesh>
          ))}
      </group>
      {/* ridge beam */}
      <mesh position={[0, ridge + 0.05, 0]}>
        <boxGeometry args={[0.3, 0.14, L + 0.4]} />
        <meshStandardMaterial color={transparent ? '#5c7fa6' : '#aab3bc'} transparent={transparent} opacity={transparent ? 0.5 : 1} />
      </mesh>

      {/* solid mode: the placed entrance / fire-exit doors on the facade */}
      {!transparent && (
        <group>
          {doorPanels()}
        </group>
      )}

      {/* adjustment arrows: each gable end moves ONLY its own end; height at the ridge */}
      {!presenting && (
        <>
          <ArrowHandle color="#f97316" pos={[0, 1.2, L / 2 + 0.6]} rot={[Math.PI / 2, 0, 0]} onDown={startResize('length+')} size={1.4} />
          <ArrowHandle color="#f97316" pos={[0, 1.2, -L / 2 - 0.6]} rot={[-Math.PI / 2, 0, 0]} onDown={startResize('length-')} size={1.4} />
          <ArrowHandle color="#f97316" pos={[0, ridge + 0.4, 0]} rot={[0, 0, 0]} onDown={startResize('height')} size={1.4} />
        </>
      )}
    </group>
  )
}
