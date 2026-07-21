import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Building, LayoutFile, ObjectDef, Placed, ShellConfig } from './types'
import { clampInside, computeDrop, elevationFor, fp, resolveAfterResize } from './placement'

const STORAGE_KEY = 'gym-layout-planner-v1'
const FILE_VERSION = 2 // v2: rot is in 45° steps (v1 was 90° steps)

let seq = 1
const uid = () => `obj-${Date.now().toString(36)}-${seq++}`

const DEFAULT_BUILDING: Building = { width: 20, length: 60, cell: 1, apron: 6 }

interface Ghost {
  x: number
  z: number
  rot: number
  valid: boolean
}

export type ResizeAxis = 'x' | 'y' | 'z'

export interface ResizeState {
  id: string
  axis: ResizeAxis
  sign: 1 | -1 // which side is being dragged; the opposite edge stays fixed
  start: { w: number; d: number; x: number; z: number }
}

export interface GymState {
  building: Building
  objects: Placed[]
  selectedId: string | null

  // palette placement in progress (ghost follows the pointer)
  placingDef: ObjectDef | null
  placingRot: number
  ghost: Ghost | null

  // freshly dropped object awaiting the user's ✓ confirm (resize arrows shown)
  pendingId: string | null

  // dimension-arrow drag in progress
  resizing: ResizeState | null

  // moving an existing object
  draggingId: string | null
  dragOffset: { dx: number; dz: number }
  dragOrigin: { x: number; z: number; rot: number } | null
  dragValid: boolean
  dragPlaneY: number // raycast plane height while moving (mezzanine top for elevated objects)

  showGrid: boolean
  showLabels: boolean
  viewKey: number

  // objects only drag when move mode is armed (prevents accidental touch-moves);
  // freshly dropped (pending) objects are always draggable
  moveArmed: boolean
  setMoveArmed: (v: boolean) => void

  // warehouse shell: 0 off, 1 transparent, 2 solid with solar roof
  shell: ShellConfig
  cycleShell: () => void
  setShellLength: (v: number) => void
  setShellEave: (v: number) => void
  shellResizing: 'length' | 'height' | null
  setShellResizing: (v: 'length' | 'height' | null) => void

  panelLeft: boolean
  panelRight: boolean
  setPanelLeft: (v: boolean) => void
  setPanelRight: (v: boolean) => void

  setBuilding: (patch: Partial<Building>) => void
  startPlacing: (def: ObjectDef) => void
  cancelPlacing: () => void
  updateGhost: (x: number, z: number) => void
  commitPlacing: () => void
  confirmPending: () => void
  cancelPending: () => void
  setResizing: (r: ResizeState | null) => void
  resizeObject: (id: string, patch: Partial<Placed>) => void
  select: (id: string | null) => void
  beginMove: (id: string, px: number, pz: number) => void
  moveTo: (px: number, pz: number) => void
  endMove: () => void
  rotate: () => void
  removeSelected: () => void
  updateObject: (id: string, patch: Partial<Placed>) => void
  clearAll: () => void
  importLayout: (file: LayoutFile) => void
  toggleGrid: () => void
  toggleLabels: () => void
  resetView: () => void
}

// v1 files stored rot in 90° steps; v2 uses 45° steps
function normalizeFile(file: LayoutFile): { building: Building; objects: Placed[] } {
  const version = file.version ?? 1
  const objects = (file.objects ?? []).map((o) => ({
    ...o,
    rot: version < 2 ? (o.rot * 2) % 8 : o.rot % 8,
  }))
  return { building: { ...DEFAULT_BUILDING, ...file.building }, objects }
}

const DEFAULT_SHELL: ShellConfig = { mode: 0, length: null, eave: 6 }

function loadSaved(): { building: Building; objects: Placed[]; shell: ShellConfig } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as LayoutFile
      if (data && data.building && Array.isArray(data.objects)) {
        return { ...normalizeFile(data), shell: { ...DEFAULT_SHELL, ...data.shell } }
      }
    }
  } catch {
    // ignore corrupt saves
  }
  return { building: DEFAULT_BUILDING, objects: [], shell: DEFAULT_SHELL }
}

export const useStore = create<GymState>()(
  subscribeWithSelector((set, get) => ({
    ...loadSaved(),
    selectedId: null,
    placingDef: null,
    placingRot: 0,
    ghost: null,
    pendingId: null,
    resizing: null,
    draggingId: null,
    dragOffset: { dx: 0, dz: 0 },
    dragOrigin: null,
    dragValid: true,
    dragPlaneY: 0,
    showGrid: true,
    showLabels: false,
    viewKey: 0,
    moveArmed: false,
    setMoveArmed: (v) => set({ moveArmed: v }),
    cycleShell: () => set({ shell: { ...get().shell, mode: (get().shell.mode + 1) % 3 } }),
    setShellLength: (v) => set({ shell: { ...get().shell, length: Math.max(4, Math.min(300, v)) } }),
    setShellEave: (v) => set({ shell: { ...get().shell, eave: Math.max(3, Math.min(20, v)) } }),
    shellResizing: null,
    setShellResizing: (v) => set({ shellResizing: v }),
    panelLeft: false,
    panelRight: false,
    setPanelLeft: (v) => set({ panelLeft: v }),
    setPanelRight: (v) => set({ panelRight: v }),

    setBuilding: (patch) => {
      const building = { ...get().building, ...patch }
      building.width = Math.max(2, building.width)
      building.length = Math.max(2, building.length)
      building.apron = Math.max(0, building.apron)
      // Re-place every object so it stays legal in the new footprint
      const objects = get().objects.map((o) => ({ ...o, ...resolveAfterResize(o, building) }))
      set({ building, objects })
    },

    // picking a new item implicitly confirms any pending one
    startPlacing: (def) =>
      set({ placingDef: def, placingRot: 0, ghost: null, selectedId: null, panelLeft: false, pendingId: null }),
    cancelPlacing: () => set({ placingDef: null, ghost: null }),

    updateGhost: (x, z) => {
      const { placingDef, placingRot, building } = get()
      if (!placingDef) return
      const r = computeDrop({ ...placingDef, rot: placingRot }, x, z, building)
      set({ ghost: { x: r.x, z: r.z, rot: r.rot, valid: r.valid } })
    },

    // Drop the ghost as a PENDING object: it stays selected with resize arrows
    // and a ✓ confirm / ✕ cancel bar until the user finalizes it.
    commitPlacing: () => {
      const { placingDef, ghost } = get()
      if (!placingDef || !ghost || !ghost.valid) return
      const obj: Placed = {
        id: uid(),
        defId: placingDef.id,
        label: placingDef.label,
        category: placingDef.category,
        w: placingDef.w,
        d: placingDef.d,
        h: placingDef.h,
        x: ghost.x,
        z: ghost.z,
        rot: ghost.rot,
        color: placingDef.color,
        rule: placingDef.rule,
      }
      set({
        objects: [...get().objects, obj],
        placingDef: null,
        ghost: null,
        selectedId: obj.id,
        pendingId: obj.id,
      })
    },

    confirmPending: () => set({ pendingId: null }),

    cancelPending: () => {
      const { pendingId } = get()
      if (!pendingId) return
      set({
        objects: get().objects.filter((o) => o.id !== pendingId),
        pendingId: null,
        selectedId: null,
      })
    },

    setResizing: (r) => set({ resizing: r }),

    // Apply a resize WITHOUT re-snapping the center to the grid — the dragged
    // edge follows the pointer while the opposite edge stays exactly in place.
    // Only clamps the footprint back inside its legal area.
    resizeObject: (id, patch) => {
      const { building } = get()
      set({
        objects: get().objects.map((o) => {
          if (o.id !== id) return o
          const next = { ...o, ...patch }
          next.w = Math.max(0.1, next.w)
          next.d = Math.max(0.1, next.d)
          next.h = Math.max(0.05, next.h)
          if (next.rule === 'edge') {
            const r = computeDrop(next, next.x, next.z, building)
            return { ...next, x: r.x, z: r.z, rot: r.rot }
          }
          const { fw, fd } = fp(next)
          const hw = building.width / 2
          const hl = building.length / 2
          if (next.rule === 'outdoor') {
            const ow = hw + building.apron
            const ol = hl + building.apron
            next.x = clampInside(next.x, fw, -ow, ow)
            next.z = clampInside(next.z, fd, -ol, ol)
          } else {
            next.x = clampInside(next.x, fw, -hw, hw)
            next.z = clampInside(next.z, fd, -hl, hl)
          }
          return next
        }),
      })
    },

    select: (id) => {
      const { pendingId, selectedId } = get()
      // selecting elsewhere confirms the pending object; changing selection disarms move mode
      set({
        selectedId: id,
        pendingId: id === pendingId ? pendingId : null,
        moveArmed: id === selectedId ? get().moveArmed : false,
      })
    },

    beginMove: (id, px, pz) => {
      const o = get().objects.find((v) => v.id === id)
      if (!o) return
      const { pendingId } = get()
      set({
        selectedId: id,
        pendingId: id === pendingId ? pendingId : null,
        draggingId: id,
        dragOffset: { dx: o.x - px, dz: o.z - pz },
        dragOrigin: { x: o.x, z: o.z, rot: o.rot },
        dragValid: true,
        // keep raycasting at the object's current height: an object on a mezzanine
        // must be dragged in the mezzanine plane, not the ground plane, or the
        // camera parallax makes it jump off the platform
        dragPlaneY: elevationFor(o, get().objects),
      })
    },

    moveTo: (px, pz) => {
      const { draggingId, dragOffset, building } = get()
      if (!draggingId) return
      const objects = get().objects.map((o) => {
        if (o.id !== draggingId) return o
        const r = computeDrop(o, px + dragOffset.dx, pz + dragOffset.dz, building)
        set({ dragValid: r.valid })
        return { ...o, x: r.x, z: r.z, rot: r.rot }
      })
      set({ objects })
    },

    endMove: () => {
      const { draggingId, dragOrigin, dragValid } = get()
      if (!draggingId) return
      if (!dragValid && dragOrigin) {
        // Illegal drop → snap back to where the drag started
        set({
          objects: get().objects.map((o) => (o.id === draggingId ? { ...o, ...dragOrigin } : o)),
        })
      }
      set({ draggingId: null, dragOrigin: null, dragValid: true })
    },

    // rotates in 45° steps; edge objects (doors) stay flush with their wall
    rotate: () => {
      const { placingDef, selectedId, building } = get()
      if (placingDef) {
        const placingRot = (get().placingRot + 1) % 8
        const g = get().ghost
        set({ placingRot })
        if (g) {
          const r = computeDrop({ ...placingDef, rot: placingRot }, g.x, g.z, building)
          set({ ghost: { x: r.x, z: r.z, rot: r.rot, valid: r.valid } })
        }
        return
      }
      if (!selectedId) return
      set({
        objects: get().objects.map((o) => {
          if (o.id !== selectedId || o.rule === 'edge') return o
          const rot = (o.rot + 1) % 8
          const r = computeDrop({ ...o, rot }, o.x, o.z, building)
          return { ...o, rot, x: r.x, z: r.z }
        }),
      })
    },

    removeSelected: () => {
      const { selectedId, pendingId } = get()
      if (!selectedId) return
      set({
        objects: get().objects.filter((o) => o.id !== selectedId),
        selectedId: null,
        pendingId: pendingId === selectedId ? null : pendingId,
      })
    },

    updateObject: (id, patch) => {
      const { building } = get()
      set({
        objects: get().objects.map((o) => {
          if (o.id !== id) return o
          const next = { ...o, ...patch }
          next.w = Math.max(0.1, next.w)
          next.d = Math.max(0.1, next.d)
          next.h = Math.max(0.05, next.h)
          const r = computeDrop(next, next.x, next.z, building)
          return { ...next, x: r.x, z: r.z, rot: r.rot }
        }),
      })
    },

    clearAll: () => set({ objects: [], selectedId: null, placingDef: null, ghost: null, pendingId: null }),

    importLayout: (file) => {
      if (!file || !file.building || !Array.isArray(file.objects)) throw new Error('Invalid layout file')
      set({
        ...normalizeFile(file),
        shell: { ...DEFAULT_SHELL, ...file.shell },
        selectedId: null,
        placingDef: null,
        ghost: null,
        pendingId: null,
      })
    },

    toggleGrid: () => set({ showGrid: !get().showGrid }),
    toggleLabels: () => set({ showLabels: !get().showLabels }),
    resetView: () => set({ viewKey: get().viewKey + 1 }),
  })),
)

// ---- auto-save to localStorage (debounced) ----
let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe(
  (s) => [s.building, s.objects, s.shell] as const,
  ([building, objects, shell]) => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        const file: LayoutFile = { version: FILE_VERSION, building, objects, shell }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
      } catch {
        // storage full / unavailable — ignore
      }
    }, 300)
  },
)

export function exportLayout(): LayoutFile {
  const { building, objects, shell } = useStore.getState()
  return { version: FILE_VERSION, building, objects, shell }
}

// handy for debugging / automated UI tests
declare global {
  interface Window {
    __gymStore?: typeof useStore
  }
}
if (typeof window !== 'undefined') window.__gymStore = useStore

