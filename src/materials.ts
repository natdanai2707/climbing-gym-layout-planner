import * as THREE from 'three'

/**
 * Procedural surface materials — birch plywood, cast concrete and EPDM rubber
 * granule flooring — drawn once into small canvases and tiled. No external
 * texture files needed, so they work offline and load instantly.
 */

export type SurfaceKind = 'epdm' | 'concrete' | 'birch' | 'metalsheet'

export const SURFACE_LABELS: Record<SurfaceKind, string> = {
  epdm: 'EPDM rubber',
  concrete: 'Concrete',
  birch: 'Birch plywood',
  metalsheet: 'Corrugated metal sheet',
}

// EPDM is drawn near-white so the item's own color tints the rubber;
// concrete and birch carry their real colors in the texture itself.
export const SURFACE_TINTED: Record<SurfaceKind, boolean> = {
  epdm: true,
  concrete: false,
  birch: false,
  metalsheet: false,
}

const rnd = (() => {
  // deterministic so the tiles look identical every session
  let s = 42
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
})()

function drawCanvas(kind: SurfaceKind): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  if (kind === 'birch') {
    g.fillStyle = '#ead9b4'
    g.fillRect(0, 0, 256, 256)
    // vertical grain streaks with a gentle wiggle
    for (let i = 0; i < 46; i++) {
      const x0 = rnd() * 256
      const warm = 0.5 + rnd() * 0.5
      g.strokeStyle = `rgba(${170 + warm * 40}, ${130 + warm * 35}, ${80 + warm * 25}, ${0.10 + rnd() * 0.15})`
      g.lineWidth = 0.6 + rnd() * 2.2
      g.beginPath()
      g.moveTo(x0, -4)
      for (let y = 0; y <= 260; y += 16) g.lineTo(x0 + Math.sin(y * 0.02 + i) * 3.5, y)
      g.stroke()
    }
    // faint elliptical knots
    for (let i = 0; i < 4; i++) {
      const x = rnd() * 256
      const y = rnd() * 256
      g.strokeStyle = 'rgba(150, 110, 60, 0.22)'
      g.lineWidth = 1
      for (let r = 2; r < 9; r += 2.4) {
        g.beginPath()
        g.ellipse(x, y, r * 0.65, r * 1.6, 0, 0, Math.PI * 2)
        g.stroke()
      }
    }
  } else if (kind === 'concrete') {
    g.fillStyle = '#c9c8c3'
    g.fillRect(0, 0, 256, 256)
    // large soft blotches
    for (let i = 0; i < 18; i++) {
      const v = 185 + rnd() * 30
      g.fillStyle = `rgba(${v}, ${v}, ${v - 4}, 0.16)`
      g.beginPath()
      g.ellipse(rnd() * 256, rnd() * 256, 18 + rnd() * 44, 14 + rnd() * 36, rnd() * 3, 0, Math.PI * 2)
      g.fill()
    }
    // fine aggregate speckle
    for (let i = 0; i < 1600; i++) {
      const v = 120 + rnd() * 110
      g.fillStyle = `rgba(${v}, ${v}, ${v}, ${0.12 + rnd() * 0.2})`
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd(), 1 + rnd())
    }
    // a couple of hairline cracks
    for (let i = 0; i < 2; i++) {
      g.strokeStyle = 'rgba(90, 90, 88, 0.25)'
      g.lineWidth = 0.7
      g.beginPath()
      let x = rnd() * 256
      let y = 0
      g.moveTo(x, y)
      while (y < 256) {
        x += (rnd() - 0.5) * 22
        y += 12 + rnd() * 18
        g.lineTo(x, y)
      }
      g.stroke()
    }
  } else if (kind === 'metalsheet') {
    // corrugated wall cladding: vertical ribs shaded left-to-right so each
    // rib reads as a rounded flute, with faint panel seams
    g.fillStyle = '#dfe3e7'
    g.fillRect(0, 0, 256, 256)
    const rib = 32 // 8 ribs per tile
    for (let x = 0; x < 256; x += rib) {
      const gr = g.createLinearGradient(x, 0, x + rib, 0)
      gr.addColorStop(0, '#c4cad1')
      gr.addColorStop(0.28, '#eef1f4')
      gr.addColorStop(0.55, '#d7dce1')
      gr.addColorStop(0.8, '#b9c0c7')
      gr.addColorStop(1, '#c4cad1')
      g.fillStyle = gr
      g.fillRect(x, 0, rib, 256)
    }
    // subtle horizontal panel seam
    g.fillStyle = 'rgba(90, 98, 106, 0.35)'
    g.fillRect(0, 126, 256, 3)
    // faint weathering streaks
    for (let i = 0; i < 60; i++) {
      const v = 150 + rnd() * 80
      g.fillStyle = `rgba(${v}, ${v + 4}, ${v + 8}, 0.05)`
      g.fillRect(rnd() * 256, rnd() * 256, 2, 20 + rnd() * 60)
    }
  } else {
    // epdm: near-white base + dark/light granules (item color multiplies in)
    g.fillStyle = '#f3f3f3'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i++) {
      const dark = rnd() < 0.62
      const v = dark ? 30 + rnd() * 70 : 215 + rnd() * 40
      g.fillStyle = `rgba(${v}, ${v}, ${v}, ${dark ? 0.28 + rnd() * 0.3 : 0.5})`
      g.beginPath()
      g.arc(rnd() * 256, rnd() * 256, 0.7 + rnd() * 1.4, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

const canvases = new Map<SurfaceKind, HTMLCanvasElement>()
const texCache = new Map<string, THREE.CanvasTexture>()

// World-locked variant for geometries whose UVs are in meters (shapeGeometry):
// one tile every 1.5 world units on both axes.
export function surfaceMapWorld(kind: SurfaceKind): THREE.CanvasTexture {
  const key = `${kind}:world`
  let t = texCache.get(key)
  if (!t) {
    let c = canvases.get(kind)
    if (!c) {
      c = drawCanvas(kind)
      canvases.set(kind, c)
    }
    t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / 1.5, 1 / 1.5)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    texCache.set(key, t)
  }
  return t
}

// A tiled texture sized for a w × d surface (one tile ≈ 1.5 m).
export function surfaceMap(kind: SurfaceKind, w: number, d: number): THREE.CanvasTexture {
  const rw = Math.max(1, Math.round(w / 1.5))
  const rd = Math.max(1, Math.round(d / 1.5))
  const key = `${kind}:${rw}x${rd}`
  let t = texCache.get(key)
  if (!t) {
    let c = canvases.get(kind)
    if (!c) {
      c = drawCanvas(kind)
      canvases.set(kind, c)
    }
    t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(rw, rd)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    texCache.set(key, t)
  }
  return t
}
