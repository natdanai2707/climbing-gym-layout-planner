import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Building, LayoutFile, ObjectDef, Placed, ShellConfig } from './types'
import { clampInside, computeDrop, elevationFor, fp, resolveAfterResize } from './placement'

interface Snapshot {
  building: Building
  objects: Placed[]
  shell: ShellConfig
}

let lastSnapAt = 0

const STORAGE_KEY = 'gym-layout-planner-v1'
const FILE_VERSION = 2 // v2: rot is in 45° steps (v1 was 90° steps)

let seq = 1
const uid = () => `obj-${Date.now().toString(36)}-${seq++}`

const DEFAULT_BUILDING: Building = { width: 20, length: 60, cell: 1, apron: 6, centerZ: 0 }

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

  // warehouse shell: 0 off, 1 transparent, 2 complete solid shell.
  // The shell footprint IS the building (width/length/centerZ).
  shell: ShellConfig
  cycleShell: () => void
  setShellEave: (v: number) => void
  shellResizing: 'length+' | 'length-' | 'height' | null
  setShellResizing: (v: 'length+' | 'length-' | 'height' | null) => void

  panelLeft: boolean
  panelRight: boolean
  setPanelLeft: (v: boolean) => void
  setPanelRight: (v: boolean) => void

  // undo / redo history (snapshots of building + objects + shell)
  past: Snapshot[]
  future: Snapshot[]
  snapshot: (coalesce?: boolean) => void
  undo: () => void
  redo: () => void

  setBuilding: (patch: Partial<Building>) => void
  setBuildingUndoable: (patch: Partial<Building>) => void
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

// v1 files stored rot in 90° steps; v2 uses 45° steps. Older files kept an
// independent shell length/offset — those now fold into the building itself.
function normalizeFile(file: LayoutFile): { building: Building; objects: Placed[] } {
  const version = file.version ?? 1
  const objects = (file.objects ?? []).map((o) => ({
    ...o,
    rot: version < 2 ? (o.rot * 2) % 8 : o.rot % 8,
  }))
  const building = { ...DEFAULT_BUILDING, ...file.building }
  const legacyShell = file.shell as (ShellConfig & { length?: number | null; offset?: number }) | undefined
  if (legacyShell) {
    if (typeof legacyShell.length === 'number') building.length = legacyShell.length
    if (typeof legacyShell.offset === 'number' && building.centerZ === 0) building.centerZ = legacyShell.offset
  }
  return { building, objects }
}

const DEFAULT_SHELL: ShellConfig = { mode: 0, eave: 6 }

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
    setShellEave: (v) => set({ shell: { ...get().shell, eave: Math.max(3, Math.min(20, v)) } }),
    shellResizing: null,
    setShellResizing: (v) => {
      if (v !== null) get().snapshot() // one undo step per shell-arrow gesture
      set({ shellResizing: v })
    },

    past: [],
    future: [],
    // Push the current state onto the undo stack. State updates are immutable,
    // so storing references is safe and cheap. `coalesce` merges rapid changes
    // (typing in the inspector) into a single undo step.
    snapshot: (coalesce = false) => {
      const now = Date.now()
      if (coalesce && now - lastSnapAt < 800) return
      lastSnapAt = now
      const { building, objects, shell, past } = get()
      set({ past: [...past.slice(-99), { building, objects, shell }], future: [] })
    },
    undo: () => {
      const { past, future, building, objects, shell } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      set({
        past: past.slice(0, -1),
        future: [...future.slice(-99), { building, objects, shell }],
        building: prev.building,
        objects: prev.objects,
        shell: prev.shell,
        selectedId: null,
        pendingId: null,
        resizing: null,
        draggingId: null,
        placingDef: null,
        ghost: null,
        shellResizing: null,
      })
    },
    redo: () => {
      const { past, future, building, objects, shell } = get()
      if (future.length === 0) return
      const next = future[future.length - 1]
      set({
        future: future.slice(0, -1),
        past: [...past.slice(-99), { building, objects, shell }],
        building: next.building,
        objects: next.objects,
        shell: next.shell,
        selectedId: null,
        pendingId: null,
        resizing: null,
        draggingId: null,
        placingDef: null,
        ghost: null,
        shellResizing: null,
      })
    },
    panelLeft: false,
    panelRight: false,
    setPanelLeft: (v) => set({ panelLeft: v }),
    setPanelRight: (v) => set({ panelRight: v }),

    // Resizing never squeezes the layout: floor items stay exactly where they
    // are, and the building simply refuses to shrink past their outer edges.
    setBuilding: (patch) => {
      const building = { ...get().building, ...patch }
      building.width = Math.max(2, building.width)
      building.length = Math.max(4, Math.min(300, building.length))
      building.apron = Math.max(0, building.apron)

      const floors = get().objects.filter((o) => o.rule === 'floor')
      if (floors.length > 0) {
        let minX = Infinity
        let maxX = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity
        for (const o of floors) {
          const { fw, fd } = fp(o)
          minX = Math.min(minX, o.x - fw / 2)
          maxX = Math.max(maxX, o.x + fw / 2)
          minZ = Math.min(minZ, o.z - fd / 2)
          maxZ = Math.max(maxZ, o.z + fd / 2)
        }
        // width is centered on x = 0
        const needW = 2 * Math.max(maxX, -minX, 0)
        if (building.width < needW) building.width = needW
        // length bounds must keep containing every item
        let bMin = building.centerZ - building.length / 2
        let bMax = building.centerZ + building.length / 2
        bMin = Math.min(bMin, minZ)
        bMax = Math.max(bMax, maxZ)
        building.length = bMax - bMin
        building.centerZ = (bMin + bMax) / 2
      }

      // doors follow their wall; outdoor items get pushed back into the apron
      const objects = get().objects.map((o) =>
        o.rule === 'floor' ? o : { ...o, ...resolveAfterResize(o, building) },
      )
      set({ building, objects })
    },

    setBuildingUndoable: (patch) => {
      get().snapshot(true)
      get().setBuilding(patch)
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
      get().snapshot()
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

    setResizing: (r) => {
      if (r !== null) get().snapshot() // one undo step per resize gesture
      set({ resizing: r })
    },

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
          const minZ = building.centerZ - building.length / 2
          const maxZ = building.centerZ + building.length / 2
          if (next.rule === 'outdoor') {
            const ow = hw + building.apron
            next.x = clampInside(next.x, fw, -ow, ow)
            next.z = clampInside(next.z, fd, minZ - building.apron, maxZ + building.apron)
          } else {
            next.x = clampInside(next.x, fw, -hw, hw)
            next.z = clampInside(next.z, fd, minZ, maxZ)
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
      get().snapshot() // one undo step per move gesture
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
      get().snapshot()
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
      get().snapshot()
      set({
        objects: get().objects.filter((o) => o.id !== selectedId),
        selectedId: null,
        pendingId: pendingId === selectedId ? null : pendingId,
      })
    },

    updateObject: (id, patch) => {
      get().snapshot(true) // coalesce rapid inspector edits into one step
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

    clearAll: () => {
      get().snapshot()
      set({ objects: [], selectedId: null, placingDef: null, ghost: null, pendingId: null })
    },

    importLayout: (file) => {
      if (!file || !file.building || !Array.isArray(file.objects)) throw new Error('Invalid layout file')
      get().snapshot()
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

