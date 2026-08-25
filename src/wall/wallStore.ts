import { create } from 'zustand'
import type { WallDesign } from '../types'
import { applyPresetZ, normalizeDesign, resampleGrid, type PresetName } from './profile'

const STORAGE_KEY = 'gym-wall-designs-v1'

let seq = 1
const uid = () => `wd-${Date.now().toString(36)}-${seq++}`

export function defaultDesign(): WallDesign {
  const d: WallDesign = {
    id: uid(),
    name: 'My Wall',
    color: '#60a5fa',
    width: 9,
    height: 4.5,
    nx: 7,
    ny: 5,
    ox: new Array(7 * 5).fill(0),
    oy: new Array(7 * 5).fill(0),
    z: [],
    skeletonDepth: 0.6,
    matDepth: 3.0,
    matThick: 0.3,
  }
  d.z = applyPresetZ(d, 'prow')
  return d
}

interface WallState {
  designs: WallDesign[]
  draft: WallDesign
  selected: number | null // control-vertex index in the draft grid
  setSelected: (k: number | null) => void
  setDraft: (patch: Partial<WallDesign>) => void
  setVertex: (k: number, patch: { ox?: number; oy?: number; z?: number }) => void
  setGridSize: (nx: number, ny: number) => void
  applyPreset: (name: PresetName) => void
  saveDraft: () => void
  loadDesign: (id: string) => void
  newDraft: () => void
  deleteDesign: (id: string) => void
  mergeDesigns: (designs: WallDesign[]) => void
}

function loadSaved(): WallDesign[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        return data.map((d) => normalizeDesign(d)).filter((d): d is WallDesign => d !== null)
      }
    }
  } catch {
    // ignore
  }
  return []
}

export const useWallStore = create<WallState>()((set, get) => ({
  designs: loadSaved(),
  draft: defaultDesign(),
  selected: null,

  setSelected: (k) => set({ selected: k }),

  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),

  setVertex: (k, patch) => {
    const d = get().draft
    if (k < 0 || k >= d.nx * d.ny) return
    const next = { ...d }
    if (patch.ox !== undefined) next.ox = d.ox.map((v, i) => (i === k ? patch.ox! : v))
    if (patch.oy !== undefined) next.oy = d.oy.map((v, i) => (i === k ? patch.oy! : v))
    if (patch.z !== undefined) next.z = d.z.map((v, i) => (i === k ? Math.max(0.05, patch.z!) : v))
    set({ draft: next })
  },

  setGridSize: (nx, ny) => {
    const d = get().draft
    nx = Math.max(2, Math.min(15, Math.round(nx)))
    ny = Math.max(2, Math.min(12, Math.round(ny)))
    if (nx === d.nx && ny === d.ny) return
    set({
      selected: null,
      draft: {
        ...d,
        nx,
        ny,
        ox: resampleGrid(d.ox, d.nx, d.ny, nx, ny),
        oy: resampleGrid(d.oy, d.nx, d.ny, nx, ny),
        z: resampleGrid(d.z, d.nx, d.ny, nx, ny),
      },
    })
  },

  applyPreset: (name) => {
    const d = get().draft
    set({
      draft: {
        ...d,
        ox: new Array(d.nx * d.ny).fill(0),
        oy: new Array(d.nx * d.ny).fill(0),
        z: applyPresetZ(d, name),
      },
    })
  },

  // upsert the draft into the library (same id replaces)
  saveDraft: () => {
    const { draft, designs } = get()
    const others = designs.filter((d) => d.id !== draft.id)
    set({ designs: [...others, JSON.parse(JSON.stringify(draft))] })
  },

  loadDesign: (id) => {
    const d = get().designs.find((v) => v.id === id)
    if (d) set({ draft: JSON.parse(JSON.stringify(d)), selected: null })
  },

  newDraft: () => set({ draft: defaultDesign(), selected: null }),

  deleteDesign: (id) => set({ designs: get().designs.filter((d) => d.id !== id) }),

  // used by layout JSON import — upsert by id so shared files bring their walls
  mergeDesigns: (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return
    const byId = new Map(get().designs.map((d) => [d.id, d]))
    for (const raw of incoming) {
      const d = normalizeDesign(raw)
      if (d) byId.set(d.id, d)
    }
    set({ designs: [...byId.values()] })
  },
}))

// handy for debugging / automated UI tests
declare global {
  interface Window {
    __wallStore?: typeof useWallStore
  }
}
if (typeof window !== 'undefined') window.__wallStore = useWallStore

// persist the library
useWallStore.subscribe((s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s.designs))
  } catch {
    // ignore
  }
})
