import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { create } from 'zustand'
import { CATALOG } from '../catalog'
import type { ObjectDef, Placed } from '../types'
import { useWallStore } from '../wall/wallStore'
import { designDepth, designWidth } from '../wall/profile'
import { ObjectMesh } from './details'

/**
 * Palette thumbnails: a tiny hidden canvas renders each catalog item's real
 * 3D model once (including saved custom walls), snapshots it to a data URL
 * and caches it, so the palette can show actual pictures of the items.
 */

interface ThumbState {
  thumbs: Record<string, string>
  put: (k: string, v: string) => void
  drop: (ks: string[]) => void
}

export const useThumbStore = create<ThumbState>((set, get) => ({
  thumbs: {},
  put: (k, v) => set({ thumbs: { ...get().thumbs, [k]: v } }),
  drop: (ks) => {
    const t = { ...get().thumbs }
    for (const k of ks) delete t[k]
    set({ thumbs: t })
  },
}))

// items whose H is a MOUNT height — only the fixture itself should fill the frame
const SUSPENDED = new Set(['duct', 'fcu', 'bigfan', 'highbay', 'tracklight', 'cctv', 'speaker', 'ceiling', 'bulkhead'])

function Subject() {
  const thumbs = useThumbStore((s) => s.thumbs)
  const put = useThumbStore((s) => s.put)
  const designs = useWallStore((s) => s.designs)
  const gl = useThree((s) => s.gl)

  const defs = useMemo(() => {
    const list: ObjectDef[] = [...CATALOG]
    for (const d of designs)
      list.push({
        id: `custom:${d.id}`,
        label: d.name,
        category: 'wall_custom',
        w: designWidth(d),
        d: designDepth(d),
        h: d.height,
        color: d.color,
        rule: 'floor',
      })
    return list
  }, [designs])

  const def = defs.find((df) => !thumbs[df.id]) ?? null
  const frames = useRef(0)
  const cur = useRef<string | null>(null)
  if (cur.current !== (def?.id ?? null)) {
    cur.current = def?.id ?? null
    frames.current = 0
  }
  useFrame(() => {
    if (!def) return
    frames.current++
    // give the model a few frames to mount, then snapshot
    if (frames.current === 4) put(def.id, gl.domElement.toDataURL('image/png'))
  })
  if (!def) return null

  const o: Placed = {
    id: 'thumb',
    defId: def.id,
    label: def.label,
    category: def.category,
    w: def.w,
    d: def.d,
    h: def.h,
    x: 0,
    z: 0,
    rot: 0,
    color: def.color,
    rule: def.rule,
  }
  const suspended = SUSPENDED.has(def.id) || def.category === 'ceiling' || def.category === 'tech'
  const visH = suspended ? 1.8 : def.h
  const s = 2.4 / Math.max(def.w, def.d, visH, 0.6)
  let yOff = (-def.h * s) / 2
  if (suspended) yOff = -def.h * s
  if (def.id === 'bulkhead') yOff = -(def.h + 0.8) * s
  return (
    <group key={def.id} scale={s} position={[0, yOff, 0]}>
      <ObjectMesh o={o} tint={null} />
    </group>
  )
}

export function ThumbnailFactory() {
  const designs = useWallStore((s) => s.designs)
  // regenerate custom-wall thumbnails whenever a design's shape/color changes
  const sig = useMemo(
    () => JSON.stringify(designs.map((d) => [d.id, d.z, d.ox, d.oy, d.width, d.height, d.color])),
    [designs],
  )
  useEffect(() => {
    useThumbStore.getState().drop(designs.map((d) => `custom:${d.id}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return (
    <div style={{ position: 'fixed', left: -220, top: 0, width: 108, height: 108, pointerEvents: 'none' }} aria-hidden>
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={1}
        camera={{ position: [2.7, 2.1, 2.7], fov: 34 }}
        style={{ background: '#f6f4ee' }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 3]} intensity={1.15} />
        <hemisphereLight intensity={0.25} groundColor="#c8bfae" />
        <Subject />
      </Canvas>
    </div>
  )
}
