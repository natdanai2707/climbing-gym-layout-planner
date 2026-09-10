import { create } from 'zustand'
import type { WindowDesign } from '../types'

const STORAGE_KEY = 'gym-window-designs-v1'

let seq = 1
const uid = () => `wn-${Date.now().toString(36)}-${seq++}`

export type WindowPreset = 'rect' | 'arch' | 'round' | 'gable' | 'rake' | 'porthole'

const round2 = (v: number) => Math.round(v * 100) / 100

/** Outline for a starting shape, sized w × h with the origin at bottom-left. */
export function presetPts(name: WindowPreset, w = 3, h = 2): Array<[number, number]> {
  const p: Array<[number, number]> = []
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      p.push([round2(cx + Math.cos(a) * rx), round2(cy + Math.sin(a) * ry)])
    }
  }
  switch (name) {
    case 'arch': {
      // square-headed sides with a semicircular head
      const r = w / 2
      const straight = Math.max(0.1, h - r)
      p.push([0, 0], [w, 0], [w, round2(straight)])
      arc(w / 2, straight, r, r, 0, Math.PI, 14)
      p.push([0, round2(straight)])
      break
    }
    case 'round':
      arc(w / 2, h / 2, w / 2, h / 2, 0, Math.PI * 2, 28)
      p.pop()
      break
    case 'porthole':
      arc(w / 2, h / 2, Math.min(w, h) / 2, Math.min(w, h) / 2, 0, Math.PI * 2, 20)
      p.pop()
      break
    case 'gable':
      p.push([0, 0], [w, 0], [w, round2(h * 0.55)], [round2(w / 2), round2(h)], [0, round2(h * 0.55)])
      break
    case 'rake':
      p.push([0, 0], [w, 0], [w, round2(h)], [0, round2(h * 0.5)])
      break
    default:
      p.push([0, 0], [w, 0], [w, round2(h)], [0, round2(h)])
  }
  return p
}

export function defaultWindow(): WindowDesign {
  return {
    id: uid(),
    name: 'My Window',
    pts: presetPts('rect', 3, 2),
    frame: '#6b7280',
    glass: '#9ec8d8',
    frameW: 0.06,
    barsX: 1,
    barsY: 0,
    sill: 0.9,
  }
}

/** Bounding box of an outline — the placed item's width and height. */
export function windowSize(d: WindowDesign): { w: number; h: number } {
  if (!d.pts.length) return { w: 1, h: 1 }
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [x, y] of d.pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return { w: Math.max(0.1, round2(x1 - x0)), h: Math.max(0.1, round2(y1 - y0)) }
}

/** Outline shifted so the bounding box starts at the origin. */
export function normalizedPts(d: WindowDesign): Array<[number, number]> {
  if (!d.pts.length) return []
  const x0 = Math.min(...d.pts.map((p) => p[0]))
  const y0 = Math.min(...d.pts.map((p) => p[1]))
  return d.pts.map(([x, y]) => [x - x0, y - y0] as [number, number])
}

function normalize(d: unknown): WindowDesign | null {
  if (!d || typeof d !== 'object') return null
  const o = d as Partial<WindowDesign>
  const pts = Array.isArray(o.pts)
    ? o.pts.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number'))
    : []
  if (pts.length < 3) return null
  return {
    id: typeof o.id === 'string' ? o.id : uid(),
    name: typeof o.name === 'string' ? o.name : 'Window',
    pts,
    frame: typeof o.frame === 'string' ? o.frame : '#6b7280',
    glass: typeof o.glass === 'string' ? o.glass : '#9ec8d8',
    frameW: typeof o.frameW === 'number' ? o.frameW : 0.06,
    barsX: typeof o.barsX === 'number' ? Math.max(0, Math.round(o.barsX)) : 0,
    barsY: typeof o.barsY === 'number' ? Math.max(0, Math.round(o.barsY)) : 0,
    sill: typeof o.sill === 'number' ? o.sill : 0.9,
  }
}

function loadSaved(): WindowDesign[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = raw ? JSON.parse(raw) : null
    if (Array.isArray(data)) return data.map(normalize).filter((d): d is WindowDesign => d !== null)
  } catch {
    // ignore unreadable storage
  }
  return []
}

function persist(designs: WindowDesign[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(designs))
  } catch {
    // ignore quota errors
  }
}

interface WindowState {
  designs: WindowDesign[]
  draft: WindowDesign
  selected: number | null // vertex index
  setSelected: (k: number | null) => void
  setDraft: (patch: Partial<WindowDesign>) => void
  movePoint: (k: number, x: number, y: number) => void
  addPointAfter: (k: number) => void
  removePoint: (k: number) => void
  applyPreset: (name: WindowPreset) => void
  scaleTo: (w: number, h: number) => void
  saveDraft: () => void
  loadDesign: (id: string) => void
  newDraft: () => void
  deleteDesign: (id: string) => void
  mergeDesigns: (designs: WindowDesign[]) => void
}

export const useWindowStore = create<WindowState>((set, get) => ({
  designs: loadSaved(),
  draft: defaultWindow(),
  selected: null,
  setSelected: (k) => set({ selected: k }),
  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
  movePoint: (k, x, y) => {
    const pts = get().draft.pts.map((p, i) => (i === k ? ([round2(x), round2(y)] as [number, number]) : p))
    set({ draft: { ...get().draft, pts } })
  },
  addPointAfter: (k) => {
    const pts = [...get().draft.pts]
    const a = pts[k]
    const b = pts[(k + 1) % pts.length]
    pts.splice(k + 1, 0, [round2((a[0] + b[0]) / 2), round2((a[1] + b[1]) / 2)])
    set({ draft: { ...get().draft, pts }, selected: k + 1 })
  },
  removePoint: (k) => {
    const pts = get().draft.pts
    if (pts.length <= 3) return // a shape needs three corners
    set({ draft: { ...get().draft, pts: pts.filter((_, i) => i !== k) }, selected: null })
  },
  applyPreset: (name) => {
    const { w, h } = windowSize(get().draft)
    set({ draft: { ...get().draft, pts: presetPts(name, w, h) }, selected: null })
  },
  scaleTo: (w, h) => {
    const d = get().draft
    const cur = windowSize(d)
    const pts = normalizedPts(d).map(
      ([x, y]) => [round2((x * w) / cur.w), round2((y * h) / cur.h)] as [number, number],
    )
    set({ draft: { ...d, pts } })
  },
  saveDraft: () => {
    const { draft, designs } = get()
    const i = designs.findIndex((d) => d.id === draft.id)
    const next = i >= 0 ? designs.map((d, k) => (k === i ? draft : d)) : [...designs, draft]
    persist(next)
    set({ designs: next })
  },
  loadDesign: (id) => {
    const d = get().designs.find((x) => x.id === id)
    if (d) set({ draft: { ...d, pts: d.pts.map((p) => [...p] as [number, number]) }, selected: null })
  },
  newDraft: () => set({ draft: defaultWindow(), selected: null }),
  deleteDesign: (id) => {
    const next = get().designs.filter((d) => d.id !== id)
    persist(next)
    set({ designs: next })
  },
  mergeDesigns: (incoming) => {
    const clean = incoming.map(normalize).filter((d): d is WindowDesign => d !== null)
    if (!clean.length) return
    const byId = new Map(get().designs.map((d) => [d.id, d]))
    for (const d of clean) byId.set(d.id, d)
    const next = [...byId.values()]
    persist(next)
    set({ designs: next })
  },
}))
