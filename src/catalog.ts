import type { Category, ObjectDef } from './types'

// Palette of placeable objects. All dimensions in meters; editable per-instance after placement.
export const CATALOG: ObjectDef[] = [
  { id: 'door_main', label: 'ประตูทางเข้า', category: 'door', w: 2.0, d: 0.3, h: 2.4, color: '#f59e0b', rule: 'edge' },
  { id: 'door_fire', label: 'ประตูหนีไฟ', category: 'door', w: 1.5, d: 0.3, h: 2.4, color: '#ef4444', rule: 'edge' },
  { id: 'parking', label: 'ลานจอดรถ (ต่อคัน)', category: 'parking', w: 5.0, d: 2.5, h: 0.05, color: '#8ea0b5', rule: 'outdoor' },
  { id: 'reception', label: 'เคาน์เตอร์ต้อนรับ', category: 'reception', w: 3.0, d: 1.5, h: 1.1, color: '#d9995f', rule: 'floor' },
  { id: 'storage', label: 'ห้องเก็บของ', category: 'room', w: 4.0, d: 3.0, h: 2.6, color: '#b9b2a6', rule: 'floor' },
  { id: 'shoes', label: 'จุดวางรองเท้า', category: 'fixture', w: 2.0, d: 1.0, h: 1.6, color: '#a78bfa', rule: 'floor' },
  { id: 'toilet', label: 'ห้องน้ำ', category: 'room', w: 4.0, d: 3.0, h: 2.6, color: '#7dd3fc', rule: 'floor' },
  { id: 'cowork', label: 'Co-working Space', category: 'zone', w: 6.0, d: 5.0, h: 0.1, color: '#86efac', rule: 'floor' },
  { id: 'boulder', label: 'ผาเตี้ย (Boulder 4.5 ม.)', category: 'wall_low', w: 15.0, d: 8.0, h: 4.5, color: '#60a5fa', rule: 'floor' },
  { id: 'lead', label: 'ผาสูง (12 ม.)', category: 'wall_high', w: 8.0, d: 4.0, h: 12.0, color: '#3b82f6', rule: 'floor' },
  { id: 'training', label: 'จุด Training', category: 'zone', w: 8.0, d: 6.0, h: 0.1, color: '#fca5a5', rule: 'floor' },
  { id: 'hyrox', label: 'Hyrox', category: 'zone', w: 20.0, d: 15.0, h: 0.1, color: '#fdba74', rule: 'floor' },
  { id: 'icebath', label: 'Ice Bath', category: 'fixture', w: 3.0, d: 2.0, h: 1.0, color: '#38bdf8', rule: 'floor' },
  { id: 'sauna', label: 'Sauna', category: 'room', w: 3.0, d: 3.0, h: 2.4, color: '#d4a373', rule: 'floor' },
]

export const CATEGORY_LABELS: Record<Category, string> = {
  door: 'ประตู',
  parking: 'ที่จอดรถ',
  reception: 'เคาน์เตอร์',
  room: 'ห้อง',
  fixture: 'อุปกรณ์ / Fixture',
  zone: 'โซนกิจกรรม',
  wall_low: 'ผาเตี้ย (Boulder)',
  wall_high: 'ผาสูง (Lead)',
}

// Order in which categories appear in the palette
export const CATEGORY_ORDER: Category[] = [
  'wall_low',
  'wall_high',
  'zone',
  'room',
  'reception',
  'fixture',
  'door',
  'parking',
]
