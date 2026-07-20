import type { Category, ObjectDef } from './types'

// Palette of placeable objects. All dimensions in meters; editable per-instance after placement.
export const CATALOG: ObjectDef[] = [
  { id: 'door_main', label: 'Main Entrance', category: 'door', w: 2.0, d: 0.3, h: 2.4, color: '#f59e0b', rule: 'edge' },
  { id: 'door_fire', label: 'Fire Exit', category: 'door', w: 1.5, d: 0.3, h: 2.4, color: '#ef4444', rule: 'edge' },
  { id: 'parking', label: 'Parking (1 car)', category: 'parking', w: 5.0, d: 2.5, h: 0.05, color: '#8ea0b5', rule: 'outdoor' },
  { id: 'reception', label: 'Reception Counter', category: 'reception', w: 3.0, d: 1.5, h: 1.1, color: '#d9995f', rule: 'floor' },
  { id: 'storage', label: 'Storage Room', category: 'room', w: 4.0, d: 3.0, h: 2.6, color: '#b9b2a6', rule: 'floor' },
  { id: 'shoes', label: 'Shoe Rack', category: 'fixture', w: 2.0, d: 1.0, h: 1.6, color: '#a78bfa', rule: 'floor' },
  { id: 'toilet', label: 'Restrooms', category: 'room', w: 4.0, d: 3.0, h: 2.6, color: '#7dd3fc', rule: 'floor' },
  { id: 'cowork', label: 'Co-working Space', category: 'zone', w: 6.0, d: 5.0, h: 0.1, color: '#86efac', rule: 'floor' },
  { id: 'boulder', label: 'Boulder Wall (4.5 m)', category: 'wall_low', w: 15.0, d: 2.5, h: 4.5, color: '#60a5fa', rule: 'floor' },
  { id: 'lead', label: 'Lead Wall (12 m)', category: 'wall_high', w: 8.0, d: 2.5, h: 12.0, color: '#3b82f6', rule: 'floor' },
  { id: 'island', label: 'Island Boulder', category: 'wall_island', w: 6.0, d: 4.0, h: 4.0, color: '#818cf8', rule: 'floor' },
  { id: 'mats', label: 'Landing Mats', category: 'mat', w: 15.0, d: 4.0, h: 0.3, color: '#5b8ee6', rule: 'floor' },
  { id: 'mezzanine', label: 'Mezzanine Floor', category: 'mezzanine', w: 10.0, d: 6.0, h: 4.5, color: '#dcbd90', rule: 'floor' },
  { id: 'stairs', label: 'Staircase', category: 'stairs', w: 2.0, d: 5.0, h: 4.5, color: '#b0a695', rule: 'floor' },
  { id: 'training', label: 'Training Area', category: 'zone', w: 8.0, d: 6.0, h: 0.1, color: '#fca5a5', rule: 'floor' },
  { id: 'hyrox', label: 'Hyrox Zone', category: 'zone', w: 20.0, d: 15.0, h: 0.1, color: '#fdba74', rule: 'floor' },
  { id: 'icebath', label: 'Ice Bath', category: 'fixture', w: 3.0, d: 2.0, h: 1.0, color: '#38bdf8', rule: 'floor' },
  { id: 'sauna', label: 'Sauna', category: 'room', w: 3.0, d: 3.0, h: 2.4, color: '#d4a373', rule: 'floor' },
  { id: 'table', label: 'Table', category: 'furniture', w: 1.6, d: 0.8, h: 0.75, color: '#b98a5a', rule: 'floor' },
  { id: 'stool', label: 'Stool', category: 'furniture', w: 0.5, d: 0.5, h: 0.45, color: '#8a6f52', rule: 'floor' },
]

export const CATEGORY_LABELS: Record<Category, string> = {
  door: 'Doors',
  parking: 'Parking',
  reception: 'Reception',
  room: 'Rooms',
  fixture: 'Fixtures',
  zone: 'Activity Zones',
  wall_low: 'Boulder Wall',
  wall_high: 'Lead Wall (Tall)',
  wall_island: 'Island Boulder',
  mat: 'Landing Mats',
  mezzanine: 'Mezzanine',
  stairs: 'Stairs',
  furniture: 'Furniture',
}

// Order in which categories appear in the palette
export const CATEGORY_ORDER: Category[] = [
  'wall_low',
  'wall_high',
  'wall_island',
  'mat',
  'mezzanine',
  'stairs',
  'zone',
  'room',
  'reception',
  'fixture',
  'furniture',
  'door',
  'parking',
]
