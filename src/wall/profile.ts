import type { WallDesign, WallSection } from '../types'

export interface ProfilePoint {
  y: number
  off: number
}

const rad = (a: number) => (a * Math.PI) / 180

// Build the 2D profile (height / forward-offset polyline) of one section:
// vertical kicker at the bottom, then one or two angled parts. Slab angles
// (negative) are handled by shifting the whole profile so offsets stay >= 0.
export function sectionPoints(sec: WallSection, H: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [{ y: 0, off: 0 }]
  let y = 0
  let off = 0
  const kick = Math.max(0, Math.min(sec.kickerH, H - 0.1))
  if (kick > 0.01) {
    y = kick
    pts.push({ y, off })
  }
  const breakH = sec.breakH > y + 0.05 && sec.breakH < H - 0.05 ? sec.breakH : null
  if (breakH !== null) {
    off += Math.tan(rad(sec.angle1)) * (breakH - y)
    pts.push({ y: breakH, off })
    off += Math.tan(rad(sec.angle2)) * (H - breakH)
    pts.push({ y: H, off })
  } else {
    off += Math.tan(rad(sec.angle1)) * (H - y)
    pts.push({ y: H, off })
  }
  const mn = Math.min(...pts.map((p) => p.off))
  return pts.map((p) => ({ y: p.y, off: p.off - mn }))
}

export function designWidth(d: WallDesign): number {
  return d.sections.reduce((a, s) => a + s.width, 0)
}

export function designMaxOff(d: WallDesign): number {
  let m = 0
  for (const s of d.sections) for (const p of sectionPoints(s, d.height)) m = Math.max(m, p.off)
  return m
}

// Total footprint depth: frame space + wall reach + panel + mats
export function designDepth(d: WallDesign): number {
  return d.skeletonDepth + designMaxOff(d) + d.thickness + d.matDepth
}
