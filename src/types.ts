export type Category =
  | 'door'
  | 'parking'
  | 'reception'
  | 'room'
  | 'fixture'
  | 'zone'
  | 'wall_low'
  | 'wall_high'
  | 'mat'
  | 'mezzanine'
  | 'stairs'
  | 'furniture'
  | 'wall_island'
  | 'wall_custom'
  | 'column'
  | 'partition'
  | 'person'
  | 'ceiling'
  | 'hvac'
  | 'tech'
  | 'site'

export type Rule = 'floor' | 'edge' | 'outdoor'

export interface ObjectDef {
  id: string
  label: string
  category: Category
  w: number // footprint width (m)
  d: number // footprint depth (m)
  h: number // height (m)
  color: string
  rule: Rule
}

export interface Placed {
  id: string
  defId: string
  label: string
  category: Category
  w: number
  d: number
  h: number
  x: number // world center x (m), building centered at origin
  z: number // world center z (m)
  rot: number // 0..7, times 45 degrees
  color: string
  rule: Rule
  level?: 'ground' | 'upper' // 'upper' = sits on a mezzanine floor
  material?: 'epdm' | 'concrete' | 'birch' | 'glass' // surface finish (zones/mats) or glass partitions
  drop?: number // vertical ceiling (bulkhead): panel extent hanging below its top hangers (m)
}

export interface FloorFinish {
  material: 'paint' | 'epdm' | 'concrete' | 'birch'
  color: string
}

export interface Building {
  width: number // x extent (m)
  length: number // z extent (m)
  cell: number // grid cell (m)
  apron: number // outdoor margin around building (m)
  centerZ: number // z position of the building/shell center (one-end resizing shifts it)
}

// The shell IS the building: its footprint is the building width/length/centerZ.
export interface ShellConfig {
  mode: number // 0 = off, 1 = transparent, 2 = complete solid shell
  eave: number // side-wall height (m); ridge = eave + gable rise
}

/**
 * Freeform faceted wall ("shaping rocks"): a nx × ny grid of control vertices
 * over the back plane. Each vertex k = j*nx + i has offsets from its base grid
 * position — ox (sideways), oy (up/down) and z (depth out of the back plane) —
 * and the surface is the flat-faceted mesh over the grid, closed at the sides
 * and back into a solid volume.
 */
export interface WallDesign {
  id: string
  name: string
  color: string
  width: number
  height: number
  nx: number
  ny: number
  ox: number[]
  oy: number[]
  z: number[]
  skeletonDepth: number // free space behind the back plane for the steel frame (m)
  matDepth: number // landing mat in front (m)
  matThick: number
}

/* ---- freeform building designer ---- */

export type ShellRoof = 'gable' | 'slopeL' | 'slopeR' | 'flat'

// One zone of the building along its length, with its own height, roof and skin
export interface ShellSegment {
  len: number // meters along the building length (scaled to fit the footprint)
  eave: number // wall height of this zone
  roof: ShellRoof
  rise: number // roof rise above the eave (slope amount)
  color: string // cladding tint for this zone's metal sheet
  clear?: boolean // translucent daylight sheeting instead of metal
}

export type FacadeSide = 'N' | 'S' | 'E' | 'W'

// Free-shape glazing / cladding patch drawn on one facade (u along the wall, y up)
export interface FacadePanel {
  side: FacadeSide
  pts: Array<[number, number]> // polygon, any shape — not just rectangles
  kind: 'glass' | 'clear' | 'solid'
  color?: string
}

// Canopy / awning attached to one side of the building
export interface CanopyDef {
  side: FacadeSide
  u0: number // start along the wall (m)
  len: number
  depth: number // how far it sticks out
  h: number // outer edge height
  support: 'posts' | 'hung'
  material: 'metal' | 'canvas' | 'clear'
  color: string
}

export interface ShellDesign {
  segments: ShellSegment[]
  panels: FacadePanel[]
  canopies: CanopyDef[]
}

export interface LayoutFile {
  version: number
  building: Building
  objects: Placed[]
  shell?: ShellConfig
  shellDesign?: ShellDesign | null
  wallDesigns?: WallDesign[]
  coolFactor?: number // aircon sizing assumption (BTU/hr per m³ of hall volume)
  floor?: FloorFinish
}
