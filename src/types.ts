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
}

export interface Building {
  width: number // x extent (m)
  length: number // z extent (m)
  cell: number // grid cell (m)
  apron: number // outdoor margin around building (m)
}

export interface LayoutFile {
  version: number
  building: Building
  objects: Placed[]
}
