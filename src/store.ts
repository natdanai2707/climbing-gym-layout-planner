import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Building, FloorFinish, LayoutFile, ObjectDef, Placed, ShellConfig } from './types'
import { clampInside, computeDrop, elevationFor, fp, resolveAfterResize } from './placement'
import { useWallStore } from './wall/wallStore'
import defaultLayoutJson from './defaultLayout.json'

// Example gym shipped with the app — shown on the very first visit
const DEFAULT_LAYOUT_FILE = defaultLayoutJson as unknown as LayoutFile

interface Snapshot {
  building: Building
  objects: Placed[]
  shell: ShellConfig
  floor: FloorFinish
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
  showCeilings: boolean
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
  setShellEaveUndoable: (v: number) => void
  coolFactor: number // BTU/hr per m³ for the aircon estimate
  setCoolFactor: (v: number) => void
  shellResizing: 'length+' | 'length-' | 'height' | null
  setShellResizing: (v: 'length+' | 'length-' | 'height' | null) => void

  panelLeft: boolean
  panelRight: boolean
  setPanelLeft: (v: boolean) => void
  setPanelRight: (v: boolean) => void

  // app page: main layout planner or the wall designer
  page: 'layout' | 'wall'
  setPage: (p: 'layout' | 'wall') => void

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
  syncDesignDims: (
    defId: string,
    oldDims: { w: number; d: number; h: number },
    newDims: { w: number; d: number; h: number },
  ) => void
  clearAll: () => void
  importLayout: (file: LayoutFile) => void
  toggleGrid: () => void
  toggleLabels: () => void
  toggleCeilings: () => void
  resetView: () => void

  // presentation & navigation
  viewMode: 'iso' | 'walk'
  setViewMode: (v: 'iso' | 'walk') => void
  viewPreset: 'iso' | 'top' | 'front' | 'side'
  setViewPreset: (v: 'iso' | 'top' | 'front' | 'side') => void
  planMode: boolean // 2D architectural plan view: items draw as flat symbols
  enterPlan: () => void
  lightMood: 'day' | 'golden' | 'night'
  setLightMood: (m: 'day' | 'golden' | 'night') => void
  clayMode: boolean
  toggleClay: () => void
  realMode: boolean // realistic presentation: sky, soft shadows, reflective floor
  toggleReal: () => void

  // whole-hall floor finish + one-tap color/material themes
  floor: FloorFinish
  setFloor: (f: Partial<FloorFinish>) => void
  applyTheme: (name: ThemeName) => void

  // measuring tape: click two floor points, repeat for more runs
  measuring: boolean
  toggleMeasure: () => void
  measures: Array<{ a: [number, number]; b: [number, number] }>
  measureDraft: [number, number] | null
  addMeasurePoint: (x: number, z: number) => void

  // walkthrough snapshot gallery (session only)
  shots: string[]
  addShot: (dataUrl: string) => void
  clearShots: () => void
}

export type ThemeName = 'teal' | 'birch' | 'mono'

// Preset looks matched to typical architect boards: walls cycle through the
// accent palette, zones become EPDM rubber patches, mats and the hall floor
// follow suit.
const THEMES: Record<
  ThemeName,
  { floor: FloorFinish; walls: string[]; mat: string; zone: string; zoneSurface?: 'epdm' | 'concrete' | 'birch' }
> = {
  teal: {
    floor: { material: 'concrete', color: '#ffffff' },
    walls: ['#1fb2a6', '#eef0ec', '#0e8f86', '#f4f6f2'],
    mat: '#9aa2ab',
    zone: '#cbd4d2',
    zoneSurface: 'epdm',
  },
  birch: {
    floor: { material: 'concrete', color: '#f4ede3' },
    walls: ['#e6cfa4', '#f2c9c9', '#5b6472', '#efe1c2'],
    mat: '#cdd7e2',
    zone: '#e0d9cd',
    zoneSurface: 'epdm',
  },
  mono: {
    floor: { material: 'paint', color: '#f0eee8' },
    walls: ['#f4f1ea', '#e6e3dc', '#f4f1ea', '#dbd8d1'],
    mat: '#e3e0d9',
    zone: '#e9e6df',
  },
}

const THEME_WALL_CATS = new Set(['wall_low', 'wall_high', 'wall_island', 'wall_custom', 'partition'])

// Items whose catalog color was later replaced with a realistic one: saved
// layouts store the color per instance, so old placements are migrated on load.
const LEGACY_COLORS: Record<string, Record<string, string>> = {
  shoes: { '#a78bfa': '#b59b7c' },
  hyrox: { '#fdba74': '#33363b' },
}

// v1 files stored rot in 90° steps; v2 uses 45° steps. Older files kept an
// independent shell length/offset — those now fold into the building itself.
function normalizeFile(file: LayoutFile): { building: Building; objects: Placed[] } {
  const version = file.version ?? 1
  const objects = (file.objects ?? []).map((o) => ({
    ...o,
    rot: version < 2 ? (o.rot * 2) % 8 : o.rot % 8,
    color: LEGACY_COLORS[o.defId]?.[o.color] ?? o.color,
  }))
  const building = { ...DEFAULT_BUILDING, ...file.building }
  if (version < 2) {
    const legacyShell = file.shell as (ShellConfig & { length?: number | null; offset?: number }) | undefined
    if (legacyShell) {
      if (typeof legacyShell.length === 'number') building.length = legacyShell.length
      if (typeof legacyShell.offset === 'number' && building.centerZ === 0) building.centerZ = legacyShell.offset
    }
  }
  // open at the right size: the shell must already cover every placed item
  return { building: growToFit(building, objects), objects }
}

// Grow the building (never shrink) so its footprint contains every floor
// item. Used by resizing AND on every load/import, so a saved layout whose
// items outgrew the stored building opens with the shell at the right size
// instead of snapping only when an arrow is first touched.
function growToFit(building: Building, objects: Placed[]): Building {
  const b = { ...building }
  const floors = objects.filter((o) => o.rule === 'floor')
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
    if (b.width < needW) b.width = needW
    // length bounds must keep containing every item
    let bMin = b.centerZ - b.length / 2
    let bMax = b.centerZ + b.length / 2
    bMin = Math.min(bMin, minZ)
    bMax = Math.max(bMax, maxZ)
    b.length = bMax - bMin
    b.centerZ = (bMin + bMax) / 2
  }
  // the outdoor apron stretches so garden items placed beyond the original
  // grid still get ground under them
  const hw = b.width / 2
  const zMin = b.centerZ - b.length / 2
  const zMax = b.centerZ + b.length / 2
  let needA = b.apron
  for (const o of objects) {
    if (o.rule !== 'outdoor') continue
    const { fw, fd } = fp(o)
    needA = Math.max(needA, o.x + fw / 2 - hw, -(o.x - fw / 2) - hw, o.z + fd / 2 - zMax, zMin - (o.z - fd / 2))
  }
  b.apron = Math.ceil(needA * 4) / 4
  return b
}

const DEFAULT_SHELL: ShellConfig = { mode: 0, eave: 6 }

// Old saves smuggled legacy shell keys (length/offset) along via object spread;
// picking the fields explicitly keeps exports clean.
function cleanShell(s?: ShellConfig): ShellConfig {
  return { mode: s?.mode ?? DEFAULT_SHELL.mode, eave: s?.eave ?? DEFAULT_SHELL.eave }
}

const DEFAULT_COOL_FACTOR = 220 // ~600 BTU/m² at a 2.7 m ceiling, volume-based
const DEFAULT_FLOOR: FloorFinish = { material: 'paint', color: '#e4c9a3' }

function loadSaved(): {
  building: Building
  objects: Placed[]
  shell: ShellConfig
  coolFactor: number
  floor: FloorFinish
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as LayoutFile
      if (data && data.building && Array.isArray(data.objects)) {
        return {
          ...normalizeFile(data),
          shell: cleanShell(data.shell),
          coolFactor: typeof data.coolFactor === 'number' ? data.coolFactor : DEFAULT_COOL_FACTOR,
          floor: { ...DEFAULT_FLOOR, ...data.floor },
        }
      }
    }
  } catch {
    // ignore corrupt saves
  }
  // first visit: open with the bundled example gym instead of an empty hall
  const demo = DEFAULT_LAYOUT_FILE
  return {
    ...normalizeFile(demo),
    shell: cleanShell(demo.shell),
    coolFactor: typeof demo.coolFactor === 'number' ? demo.coolFactor : DEFAULT_COOL_FACTOR,
    floor: { ...DEFAULT_FLOOR, ...demo.floor },
  }
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
    showCeilings: true,
    showLabels: false,
    viewKey: 0,
    moveArmed: false,
    setMoveArmed: (v) => set({ moveArmed: v }),
    cycleShell: () => set({ shell: { ...get().shell, mode: (get().shell.mode + 1) % 3 } }),
    setShellEave: (v) => set({ shell: { ...get().shell, eave: Math.max(3, Math.min(20, v)) } }),
    setShellEaveUndoable: (v) => {
      get().snapshot(true)
      get().setShellEave(v)
    },
    setCoolFactor: (v) => set({ coolFactor: Math.max(50, Math.min(1000, v)) }),
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
      const { building, objects, shell, floor, past } = get()
      set({ past: [...past.slice(-99), { building, objects, shell, floor }], future: [] })
    },
    undo: () => {
      const { past, future, building, objects, shell, floor } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      set({
        past: past.slice(0, -1),
        future: [...future.slice(-99), { building, objects, shell, floor }],
        building: prev.building,
        objects: prev.objects,
        shell: prev.shell,
        floor: prev.floor ?? floor,
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
      const { past, future, building, objects, shell, floor } = get()
      if (future.length === 0) return
      const next = future[future.length - 1]
      set({
        future: future.slice(0, -1),
        past: [...past.slice(-99), { building, objects, shell, floor }],
        building: next.building,
        objects: next.objects,
        shell: next.shell,
        floor: next.floor ?? floor,
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
    page: 'layout',
    setPage: (p) => set({ page: p }),

    // Resizing never squeezes the layout: floor items stay exactly where they
    // are, and the building simply refuses to shrink past their outer edges.
    setBuilding: (patch) => {
      let building = { ...get().building, ...patch }
      building.width = Math.max(2, building.width)
      building.length = Math.max(4, Math.min(300, building.length))
      building.apron = Math.max(0, building.apron)
      building = growToFit(building, get().objects)

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

    confirmPending: () => set({ pendingId: null, building: growToFit(get().building, get().objects) }),

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
      set(
        r === null
          ? { resizing: null, building: growToFit(get().building, get().objects) }
          : { resizing: r },
      )
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
            // outdoor items resize freely — the apron grows to reach them
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
      // the shell/building always covers the layout, even right after a move
      set({ draggingId: null, dragOrigin: null, dragValid: true, building: growToFit(get().building, get().objects) })
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
      set({ building: growToFit(get().building, get().objects) })
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
      set({ building: growToFit(get().building, get().objects) })
    },

    // After a wall design is edited on the Wall Design page, refit every placed
    // instance to the new natural size, preserving any intentional scaling the
    // user applied relative to the old natural size.
    syncDesignDims: (defId, oldDims, newDims) => {
      const { building, objects } = get()
      if (!objects.some((o) => o.defId === defId)) return
      get().snapshot()
      const refit = (placed: number, oldNat: number, newNat: number) =>
        Math.round((placed / Math.max(0.1, oldNat)) * newNat * 100) / 100
      set({
        objects: objects.map((o) => {
          if (o.defId !== defId) return o
          const next = {
            ...o,
            w: Math.max(0.1, refit(o.w, oldDims.w, newDims.w)),
            d: Math.max(0.1, refit(o.d, oldDims.d, newDims.d)),
            h: Math.max(0.05, refit(o.h, oldDims.h, newDims.h)),
          }
          const r = computeDrop(next, next.x, next.z, building)
          return { ...next, x: r.x, z: r.z, rot: r.rot }
        }),
      })
      set({ building: growToFit(get().building, get().objects) })
    },

    clearAll: () => {
      get().snapshot()
      set({ objects: [], selectedId: null, placingDef: null, ghost: null, pendingId: null })
    },

    importLayout: (file) => {
      if (!file || !file.building || !Array.isArray(file.objects)) throw new Error('Invalid layout file')
      get().snapshot()
      if (file.wallDesigns) useWallStore.getState().mergeDesigns(file.wallDesigns)
      set({
        ...normalizeFile(file),
        shell: cleanShell(file.shell),
        coolFactor: typeof file.coolFactor === 'number' ? file.coolFactor : get().coolFactor,
        floor: { ...DEFAULT_FLOOR, ...file.floor },
        selectedId: null,
        placingDef: null,
        ghost: null,
        pendingId: null,
      })
    },

    toggleGrid: () => set({ showGrid: !get().showGrid }),
    toggleLabels: () => set({ showLabels: !get().showLabels }),
    // Hide ceiling panels / vertical ceilings to look inside; a hidden
    // ceiling can't stay selected (its arrows would float in empty space).
    toggleCeilings: () => {
      const show = !get().showCeilings
      const sel = get().objects.find((o) => o.id === get().selectedId)
      set({
        showCeilings: show,
        selectedId: !show && sel?.category === 'ceiling' ? null : get().selectedId,
      })
    },
    resetView: () => set({ viewKey: get().viewKey + 1, viewPreset: 'iso', planMode: false }),

    viewMode: 'iso',
    setViewMode: (v) => {
      if (v === 'walk')
        set({ viewMode: v, selectedId: null, moveArmed: false, placingDef: null, ghost: null, planMode: false })
      else set({ viewMode: v, viewKey: get().viewKey + 1 })
    },
    viewPreset: 'iso',
    setViewPreset: (v) => set({ viewPreset: v, viewMode: 'iso', planMode: false, viewKey: get().viewKey + 1 }),
    planMode: false,
    enterPlan: () => set({ planMode: true, viewPreset: 'top', viewMode: 'iso', viewKey: get().viewKey + 1 }),
    lightMood: 'day',
    setLightMood: (m) => set({ lightMood: m }),
    clayMode: false,
    toggleClay: () => set({ clayMode: !get().clayMode, realMode: false }),
    realMode: false,
    toggleReal: () => set({ realMode: !get().realMode, clayMode: false }),

    setFloor: (f) => {
      get().snapshot(true)
      set({ floor: { ...get().floor, ...f } })
    },

    // One undo step restores both the previous colors and the previous floor.
    applyTheme: (name) => {
      const t = THEMES[name]
      if (!t) return
      get().snapshot()
      let wi = 0
      set({
        floor: t.floor,
        objects: get().objects.map((o) => {
          // steel railings keep their metal finish through theme changes
          if (THEME_WALL_CATS.has(o.category) && o.defId !== 'rail') return { ...o, color: t.walls[wi++ % t.walls.length] }
          if (o.category === 'mat') return { ...o, color: t.mat }
          if (o.category === 'zone') return { ...o, color: t.zone, material: t.zoneSurface }
          return o
        }),
      })
    },

    measuring: false,
    measures: [],
    measureDraft: null,
    toggleMeasure: () => {
      const on = !get().measuring
      set({
        measuring: on,
        measures: on ? get().measures : [],
        measureDraft: null,
        selectedId: on ? null : get().selectedId,
        moveArmed: on ? false : get().moveArmed,
      })
    },
    addMeasurePoint: (x, z) => {
      const d = get().measureDraft
      if (!d) set({ measureDraft: [x, z] })
      else set({ measureDraft: null, measures: [...get().measures, { a: d, b: [x, z] }] })
    },

    shots: [],
    addShot: (dataUrl) => set({ shots: [...get().shots.slice(-23), dataUrl] }),
    clearShots: () => set({ shots: [] }),
  })),
)

// ---- auto-save to localStorage (debounced) ----
let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe(
  (s) => [s.building, s.objects, s.shell, s.coolFactor, s.floor] as const,
  ([building, objects, shell, coolFactor, floor]) => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        const file: LayoutFile = { version: FILE_VERSION, building, objects, shell, coolFactor, floor }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
      } catch {
        // storage full / unavailable — ignore
      }
    }, 300)
  },
)

export function exportLayout(): LayoutFile {
  const { building, objects, shell, coolFactor, floor } = useStore.getState()
  return { version: FILE_VERSION, building, objects, shell, coolFactor, floor, wallDesigns: useWallStore.getState().designs }
}

// handy for debugging / automated UI tests
declare global {
  interface Window {
    __gymStore?: typeof useStore
  }
}
if (typeof window !== 'undefined') window.__gymStore = useStore

