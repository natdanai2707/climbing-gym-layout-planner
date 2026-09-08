import { useMemo } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { useStore } from '../store'
import { ArrowHandle } from './gizmo'
import { surfaceMap, surfaceMapWorld } from '../materials'

// Roof pitch of the gable (rise over half-width). ~15°.
export const ROOF_PITCH = Math.tan((15 * Math.PI) / 180)

const GLASS = { color: '#9fc8e0', roughness: 0.25, metalness: 0.15 }
// the wrap-around window band is really see-through (walk mode looks out)
const BAND_GLASS = {
  color: '#aed3e4',
  transparent: true,
  opacity: 0.35,
  roughness: 0.1,
  metalness: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
}
const MULLION = { color: '#8f979f', roughness: 0.4, metalness: 0.55 }

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

  // continuous glazing band around all four sides, 0.5 m – 2.5 m
  const bandBot = 0.5
  const bandTop = Math.min(2.5, eave - 0.4)
  const bandH = bandTop - bandBot
  // gable cladding above the band (the band replaces the wall below it)
  const gableUpper = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-W / 2, bandTop)
    s.lineTo(W / 2, bandTop)
    s.lineTo(W / 2, eave)
    s.lineTo(0, ridge)
    s.lineTo(-W / 2, eave)
    s.closePath()
    return s
  }, [W, eave, ridge, bandTop])
  const sideMullions = useMemo(() => spread(Math.max(2, Math.round(L / 2.2)), L - 0.3), [L])
  const endMullions = useMemo(() => spread(Math.max(2, Math.round(W / 2.2)), W - 0.3), [W])

  // window band segments along the long walls, high near the eave
  const sideWindows = useMemo(() => {
    const y = Math.max(2.2, eave - 1.4)
    const segW = 2.2
    const gap = 0.6
    const usable = L - 3
    const n = Math.max(0, Math.floor(usable / (segW + gap)))
    const startZ = (-(n * (segW + gap)) + gap) / 2
    return Array.from({ length: n }, (_, i) => ({ z: startZ + i * (segW + gap) + segW / 2, y, segW, h: 1.1 }))
  }, [L, eave])

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
        roughness: 0.45,
        metalness: 0.35,
        side: THREE.DoubleSide,
      }
  const gableMat = transparent
    ? wallMat
    : {
        color: '#ffffff',
        map: surfaceMapWorld('metalsheet'),
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
          {/* long side walls: cladding below/above a see-through glazing band */}
          {[-1, 1].map((sx) => (
            <group key={sx} position={[sx * (W / 2 + t / 2), 0, 0]}>
              <mesh position={[0, bandBot / 2, 0]}>
                <boxGeometry args={[t, bandBot, L]} />
                <meshStandardMaterial {...wallMat} />
              </mesh>
              <mesh position={[0, (bandTop + eave) / 2, 0]}>
                <boxGeometry args={[t, Math.max(0.05, eave - bandTop), L]} />
                <meshStandardMaterial {...wallMat} />
              </mesh>
              <mesh position={[0, bandBot + bandH / 2, 0]}>
                <boxGeometry args={[t * 0.35, bandH, L]} />
                <meshStandardMaterial {...BAND_GLASS} />
              </mesh>
              {/* sill + head rails and mullions */}
              <mesh position={[0, bandBot - 0.03, 0]}>
                <boxGeometry args={[t + 0.02, 0.07, L]} />
                <meshStandardMaterial {...MULLION} />
              </mesh>
              <mesh position={[0, bandTop + 0.03, 0]}>
                <boxGeometry args={[t + 0.02, 0.07, L]} />
                <meshStandardMaterial {...MULLION} />
              </mesh>
              {sideMullions.map((z, i) => (
                <mesh key={i} position={[0, bandBot + bandH / 2, z]}>
                  <boxGeometry args={[t * 0.7, bandH, 0.09]} />
                  <meshStandardMaterial {...MULLION} />
                </mesh>
              ))}
            </group>
          ))}
          {/* gable ends: cladding above the band, band + base below */}
          {[-1, 1].map((sz) => (
            <group key={`e${sz}`} position={[0, 0, sz * (L / 2 + t / 2)]}>
              <mesh>
                <shapeGeometry args={[gableUpper]} />
                <meshStandardMaterial {...gableMat} />
              </mesh>
              <mesh position={[0, bandBot / 2, 0]}>
                <boxGeometry args={[W, bandBot, t]} />
                <meshStandardMaterial {...gableMat} />
              </mesh>
              <mesh position={[0, bandBot + bandH / 2, 0]}>
                <boxGeometry args={[W, bandH, t * 0.35]} />
                <meshStandardMaterial {...BAND_GLASS} />
              </mesh>
              <mesh position={[0, bandBot - 0.03, 0]}>
                <boxGeometry args={[W, 0.07, t + 0.02]} />
                <meshStandardMaterial {...MULLION} />
              </mesh>
              <mesh position={[0, bandTop + 0.03, 0]}>
                <boxGeometry args={[W, 0.07, t + 0.02]} />
                <meshStandardMaterial {...MULLION} />
              </mesh>
              {endMullions.map((x, i) => (
                <mesh key={i} position={[x, bandBot + bandH / 2, 0]}>
                  <boxGeometry args={[0.09, bandH, t * 0.7]} />
                  <meshStandardMaterial {...MULLION} />
                </mesh>
              ))}
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

      {/* solid mode: facade openings — placed doors + window bands */}
      {!transparent && (
        <group>
          {doorPanels()}
          {/* high window strips on both long walls */}
          {sideWindows.map((wd, i) => (
            <group key={i}>
              <mesh position={[-W / 2 - t - 0.02, wd.y, wd.z]}>
                <boxGeometry args={[0.06, wd.h, wd.segW]} />
                <meshStandardMaterial {...GLASS} />
              </mesh>
              <mesh position={[W / 2 + t + 0.02, wd.y, wd.z]}>
                <boxGeometry args={[0.06, wd.h, wd.segW]} />
                <meshStandardMaterial {...GLASS} />
              </mesh>
            </group>
          ))}
          {/* windows flanking the gable centers, above door height */}
          {[-L / 2 - t - 0.02, L / 2 + t + 0.02].map((z, i) => (
            <group key={`g${i}`}>
              <mesh position={[-W / 4, Math.max(2.6, eave - 1.4), z]}>
                <boxGeometry args={[2.4, 1.1, 0.06]} />
                <meshStandardMaterial {...GLASS} />
              </mesh>
              <mesh position={[W / 4, Math.max(2.6, eave - 1.4), z]}>
                <boxGeometry args={[2.4, 1.1, 0.06]} />
                <meshStandardMaterial {...GLASS} />
              </mesh>
            </group>
          ))}
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
