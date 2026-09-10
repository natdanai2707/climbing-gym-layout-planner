import type { LayoutFile } from '../types'
import layout1 from './layout1.json'
import demo from '../defaultLayout.json'

/**
 * Layouts that ship with the app. localStorage only ever holds the copy on the
 * device in front of you, so without these a phone and a laptop open on two
 * different designs; a preset is the same drawing everywhere, and the one the
 * app starts on for anyone who has not saved anything yet.
 */
export interface LayoutPreset {
  id: string
  name: string
  file: LayoutFile
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'layout1', name: 'Layout 1', file: layout1 as unknown as LayoutFile },
  { id: 'demo', name: 'Demo gym', file: demo as unknown as LayoutFile },
]

export const DEFAULT_PRESET_ID = 'layout1'

export const presetById = (id: string): LayoutPreset | undefined => LAYOUT_PRESETS.find((p) => p.id === id)
