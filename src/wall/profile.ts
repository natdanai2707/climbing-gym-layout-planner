import type { WallDesign } from '../types'

/**
 * Geometry core for freeform faceted walls. The design is a grid of control
 * vertices; this module turns it into a triangle soup (used by both the 3D
 * renderer and the STL/3MF/DAE exporters), plus grid utilities: presets,
 * resampling when the grid resolution changes, and migration of the old
 * section-based designs.
 */

export const vIdx = (d: Pick<WallDesign, 'nx'>, i: number, j: number) => j * d.nx + i

// world-space position of control vertex (i, j) in the wall's local frame
// (x across, y up, z out of the back plane which sits at z = 0)
export function vertexPos(d: WallDesign, i: number, j: number): [number, number, number] {
  const k = vIdx(d, i, j)
  const bx = -d.width / 2 + (i / (d.nx - 1)) * d.width
  const by = (j / (d.ny - 1)) * d.height
  return [bx + (d.ox[k] ?? 0), Math.max(0, by + (d.oy[k] ?? 0)), Math.max(0.05, d.z[k] ?? 0.15)]
}

export function maxDepthOf(d: WallDesign): number {
  let m = 0.1
  for (let k = 0; k < d.nx * d.ny; k++) m = Math.max(m, d.z[k] ?? 0)
  return m
}

// footprint width: the widest x-extent of the deformed surface
export function designWidth(d: WallDesign): number {
  let mn = Infinity
  let mx = -Infinity
  for (let j = 0; j < d.ny; j++)
    for (const i of [0, d.nx - 1]) {
      const [x] = vertexPos(d, i, j)
      mn = Math.min(mn, x)
      mx = Math.max(mx, x)
    }
  return Math.max(1, mx - mn)
}

// footprint depth: frame zone + surface reach, at least the mat
export function designDepth(d: WallDesign): number {
  return d.skeletonDepth + Math.max(maxDepthOf(d) + 0.2, d.matDepth)
}

/* ------------------------------ triangle soup ------------------------------ */

function pushTri(out: number[], a: number[], b: number[], c: number[]) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
}

function pushQuad(out: number[], a: number[], b: number[], c: number[], dd: number[]) {
  pushTri(out, a, b, c)
  pushTri(out, a, c, dd)
}

function pushBox(out: number[], cx: number, cy: number, cz: number, w: number, h: number, dep: number) {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  const z0 = cz - dep / 2
  const z1 = cz + dep / 2
  const p = (x: number, y: number, z: number) => [x, y, z]
  pushQuad(out, p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)) // front
  pushQuad(out, p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0)) // back
  pushQuad(out, p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)) // left
  pushQuad(out, p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1)) // right
  pushQuad(out, p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0)) // top
  pushQuad(out, p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)) // bottom
}

export interface BuildOpts {
  skeleton?: boolean
  mat?: boolean
}

// Build the whole wall as a triangle soup in the placement frame: the volume
// is recentered so the footprint (skeleton + surface + mat) is centered on z=0.
export function buildWallTriangles(d: WallDesign, opts: BuildOpts = {}): Float32Array {
  const { skeleton = true, mat = true } = opts
  const out: number[] = []
  const depth = designDepth(d)
  const zShift = -depth / 2 + d.skeletonDepth // back plane position in the placement frame

  const P = (i: number, j: number) => {
    const [x, y, z] = vertexPos(d, i, j)
    return [x, y, z + zShift]
  }
  const B = (i: number, j: number) => {
    const [x, y] = vertexPos(d, i, j)
    return [x, y, zShift]
  }

  // faceted front surface
  for (let j = 0; j < d.ny - 1; j++)
    for (let i = 0; i < d.nx - 1; i++)
      pushQuad(out, P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1))
  // close left / right sides back to the back plane
  for (let j = 0; j < d.ny - 1; j++) {
    pushQuad(out, B(0, j), P(0, j), P(0, j + 1), B(0, j + 1))
    pushQuad(out, P(d.nx - 1, j), B(d.nx - 1, j), B(d.nx - 1, j + 1), P(d.nx - 1, j + 1))
  }
  // top + bottom
  for (let i = 0; i < d.nx - 1; i++) {
    pushQuad(out, P(i, d.ny - 1), P(i + 1, d.ny - 1), B(i + 1, d.ny - 1), B(i, d.ny - 1))
    pushQuad(out, B(i, 0), B(i + 1, 0), P(i + 1, 0), P(i, 0))
  }
  // back plane
  for (let j = 0; j < d.ny - 1; j++)
    for (let i = 0; i < d.nx - 1; i++)
      pushQuad(out, B(i + 1, j), B(i, j), B(i, j + 1), B(i + 1, j + 1))

  if (skeleton && d.skeletonDepth > 0.05) {
    const n = Math.max(2, Math.round(d.width / 1.6))
    for (let i = 0; i < n; i++) {
      const px = -d.width / 2 + 0.15 + (i * (d.width - 0.3)) / (n - 1)
      pushBox(out, px, d.height / 2, zShift - d.skeletonDepth / 2, 0.08, d.height, 0.08)
      pushBox(out, px, d.height * 0.4, zShift - d.skeletonDepth / 2, 0.07, 0.07, d.skeletonDepth)
      pushBox(out, px, d.height * 0.85, zShift - d.skeletonDepth / 2, 0.07, 0.07, d.skeletonDepth)
    }
  }
  if (mat && d.matDepth > 0.05) {
    pushBox(out, 0, d.matThick / 2, zShift + d.matDepth / 2, designWidth(d), d.matThick, d.matDepth)
  }
  return new Float32Array(out)
}

/* -------------------------------- presets -------------------------------- */

export type PresetName = 'flat' | 'prow' | 'cave' | 'bulge' | 'ridge' | 'boulder' | 'random'

export function applyPresetZ(d: WallDesign, name: PresetName): number[] {
  const z: number[] = new Array(d.nx * d.ny).fill(0.15)
  const rnd = () => Math.random()
  for (let j = 0; j < d.ny; j++) {
    for (let i = 0; i < d.nx; i++) {
      const ti = d.nx > 1 ? i / (d.nx - 1) : 0
      const tj = d.ny > 1 ? j / (d.ny - 1) : 0
      let v = 0.15
      switch (name) {
        case 'flat':
          v = 0.15
          break
        case 'prow': // central spine leaning further out with height
          v = 0.15 + Math.pow(Math.max(0, 1 - Math.abs(ti - 0.5) * 2.4), 1.4) * (0.3 + 1.8 * tj)
          break
        case 'cave': // steepening into a roof
          v = 0.15 + 2.4 * tj * tj
          break
        case 'bulge': // belly at mid height
          v = 0.15 + 1.7 * Math.exp(-(Math.pow(ti - 0.5, 2) + Math.pow(tj - 0.55, 2)) / 0.09)
          break
        case 'ridge': // diagonal arête
          v = 0.15 + 1.4 * Math.max(0, 1 - Math.abs(ti - tj) * 2.6)
          break
        case 'boulder': // rounded freestanding lump
          v = 0.2 + 1.9 * Math.sin(Math.PI * Math.min(1, tj * 1.15)) * (0.55 + 0.45 * Math.sin(Math.PI * ti))
          break
        case 'random':
          v = 0.15 + rnd() * 1.5
          break
      }
      z[j * d.nx + i] = Math.round(v * 20) / 20
    }
  }
  if (name === 'random') {
    // one smoothing pass so it reads as facets, not noise
    const s = z.slice()
    for (let j = 0; j < d.ny; j++)
      for (let i = 0; i < d.nx; i++) {
        let sum = 0
        let n = 0
        for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di
          const jj = j + dj
          if (ii >= 0 && ii < d.nx && jj >= 0 && jj < d.ny) {
            sum += s[jj * d.nx + ii]
            n++
          }
        }
        z[j * d.nx + i] = Math.round((sum / n) * 20) / 20
      }
  }
  return z
}

// bilinear resample of an offset grid to a new resolution
export function resampleGrid(src: number[], nx0: number, ny0: number, nx1: number, ny1: number): number[] {
  const out = new Array(nx1 * ny1)
  for (let j = 0; j < ny1; j++) {
    for (let i = 0; i < nx1; i++) {
      const fx = nx1 > 1 ? (i / (nx1 - 1)) * (nx0 - 1) : 0
      const fy = ny1 > 1 ? (j / (ny1 - 1)) * (ny0 - 1) : 0
      const x0 = Math.min(nx0 - 1, Math.floor(fx))
      const y0 = Math.min(ny0 - 1, Math.floor(fy))
      const x1 = Math.min(nx0 - 1, x0 + 1)
      const y1 = Math.min(ny0 - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const v =
        src[y0 * nx0 + x0] * (1 - tx) * (1 - ty) +
        src[y0 * nx0 + x1] * tx * (1 - ty) +
        src[y1 * nx0 + x0] * (1 - tx) * ty +
        src[y1 * nx0 + x1] * tx * ty
      out[j * nx1 + i] = Math.round(v * 100) / 100
    }
  }
  return out
}

/* ------------------------------- migration ------------------------------- */

interface LegacySection {
  width: number
  kickerH: number
  angle1: number
  breakH: number
  angle2: number
}

function legacyOffset(sec: LegacySection, H: number, y: number): number {
  const rad = (a: number) => (a * Math.PI) / 180
  const pts: Array<{ y: number; off: number }> = [{ y: 0, off: 0 }]
  let yy = 0
  let off = 0
  const kick = Math.max(0, Math.min(sec.kickerH, H - 0.1))
  if (kick > 0.01) {
    yy = kick
    pts.push({ y: yy, off })
  }
  const breakH = sec.breakH > yy + 0.05 && sec.breakH < H - 0.05 ? sec.breakH : null
  if (breakH !== null) {
    off += Math.tan(rad(sec.angle1)) * (breakH - yy)
    pts.push({ y: breakH, off })
    off += Math.tan(rad(sec.angle2)) * (H - breakH)
    pts.push({ y: H, off })
  } else {
    off += Math.tan(rad(sec.angle1)) * (H - yy)
    pts.push({ y: H, off })
  }
  const mn = Math.min(...pts.map((p) => p.off))
  const shifted = pts.map((p) => ({ y: p.y, off: p.off - mn + 0.15 }))
  for (let i = 0; i < shifted.length - 1; i++) {
    if (y >= shifted[i].y && y <= shifted[i + 1].y) {
      const t = (y - shifted[i].y) / Math.max(1e-6, shifted[i + 1].y - shifted[i].y)
      return shifted[i].off + t * (shifted[i + 1].off - shifted[i].off)
    }
  }
  return shifted[shifted.length - 1].off
}

// Accept both current grid designs and old section-based designs
export function normalizeDesign(raw: unknown): WallDesign | null {
  const d = raw as Partial<WallDesign> & { sections?: LegacySection[]; thickness?: number }
  if (!d || !d.id) return null
  if (Array.isArray(d.z) && d.nx && d.ny) {
    const n = d.nx * d.ny
    return {
      id: d.id,
      name: d.name ?? 'Wall',
      color: d.color ?? '#60a5fa',
      width: d.width ?? 9,
      height: d.height ?? 4.5,
      nx: d.nx,
      ny: d.ny,
      ox: Array.from({ length: n }, (_, k) => d.ox?.[k] ?? 0),
      oy: Array.from({ length: n }, (_, k) => d.oy?.[k] ?? 0),
      z: Array.from({ length: n }, (_, k) => d.z![k] ?? 0.15),
      skeletonDepth: d.skeletonDepth ?? 0.6,
      matDepth: d.matDepth ?? 3,
      matThick: d.matThick ?? 0.3,
    }
  }
  if (Array.isArray(d.sections) && d.sections.length > 0) {
    const H = d.height ?? 4.5
    const width = d.sections.reduce((a, s) => a + s.width, 0)
    const nx = Math.max(2, d.sections.length + 1)
    const ny = 5
    const z: number[] = []
    for (let j = 0; j < ny; j++) {
      const y = (j / (ny - 1)) * H
      for (let i = 0; i < nx; i++) {
        const si = Math.min(d.sections.length - 1, i)
        z.push(Math.round(legacyOffset(d.sections[si], H, y) * 20) / 20)
      }
    }
    return {
      id: d.id,
      name: d.name ?? 'Wall',
      color: d.color ?? '#60a5fa',
      width,
      height: H,
      nx,
      ny,
      ox: new Array(nx * ny).fill(0),
      oy: new Array(nx * ny).fill(0),
      z,
      skeletonDepth: d.skeletonDepth ?? 0.6,
      matDepth: d.matDepth ?? 3,
      matThick: d.matThick ?? 0.3,
    }
  }
  return null
}
