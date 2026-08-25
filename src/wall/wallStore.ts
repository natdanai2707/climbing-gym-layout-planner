import { create } from 'zustand'
import type { WallDesign, WallSection } from '../types'

const STORAGE_KEY = 'gym-wall-designs-v1'

let seq = 1
const uid = () => `wd-${Date.now().toString(36)}-${seq++}`

export function defaultSection(): WallSection {
  return { width: 3, kickerH: 0.8, angle1: 15, breakH: 0, angle2: 30 }
}

export function defaultDesign(): WallDesign {
  return {
    id: uid(),
    name: 'My Wall',
    height: 4.5,
    thickness: 0.15,
    skeletonDepth: 0.6,
    matDepth: 3.0,
    matThick: 0.3,
    color: '#60a5fa',
    sections: [
      { width: 3, kickerH: 0.8, angle1: 20, breakH: 0, angle2: 0 },
      { width: 3, kickerH: 0.4, angle1: 0, breakH: 3, angle2: 40 },
      { width: 3, kickerH: 0, angle1: -8, breakH: 0, angle2: 0 },
    ],
  }
}

interface WallState {
  designs: WallDesign[]
  draft: WallDesign
  setDraft: (patch: Partial<WallDesign>) => void
  setSection: (i: number, patch: Partial<WallSection>) => void
  addSection: () => void
  removeSection: (i: number) => void
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
      if (Array.isArray(data)) return data
    }
  } catch {
    // ignore
  }
  return []
}

export const useWallStore = create<WallState>()((set, get) => ({
  designs: loadSaved(),
  draft: defaultDesign(),

  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),

  setSection: (i, patch) =>
    set({
      draft: {
        ...get().draft,
        sections: get().draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)),
      },
    }),

  addSection: () => set({ draft: { ...get().draft, sections: [...get().draft.sections, defaultSection()] } }),

  removeSection: (i) => {
    const secs = get().draft.sections
    if (secs.length <= 1) return
    set({ draft: { ...get().draft, sections: secs.filter((_, j) => j !== i) } })
  },

  // upsert the draft into the library (same id replaces)
  saveDraft: () => {
    const { draft, designs } = get()
    const others = designs.filter((d) => d.id !== draft.id)
    set({ designs: [...others, { ...draft }] })
  },

  loadDesign: (id) => {
    const d = get().designs.find((v) => v.id === id)
    if (d) set({ draft: JSON.parse(JSON.stringify(d)) })
  },

  newDraft: () => set({ draft: defaultDesign() }),

  deleteDesign: (id) => set({ designs: get().designs.filter((d) => d.id !== id) }),

  // used by layout JSON import — upsert by id so shared files bring their walls
  mergeDesigns: (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return
    const byId = new Map(get().designs.map((d) => [d.id, d]))
    for (const d of incoming) if (d && d.id && Array.isArray(d.sections)) byId.set(d.id, d)
    set({ designs: [...byId.values()] })
  },
}))

// persist the library
useWallStore.subscribe((s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s.designs))
  } catch {
    // ignore
  }
})
