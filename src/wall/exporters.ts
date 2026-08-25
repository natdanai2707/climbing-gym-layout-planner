import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WallDesign } from '../types'
import { designDepth, designMaxOff, designWidth, sectionPoints } from './profile'

/**
 * File exporters for wall designs. One merged triangle mesh (panels + steel
 * skeleton + landing mat) feeds all three formats:
 *  - STL  (binary, millimeters — ready for slicers)
 *  - 3MF  (OPC zip with a 3D/3dmodel.model, millimeters)
 *  - DAE  (COLLADA, meters, Z-up — SketchUp: File → Import)
 * .skp itself is a closed proprietary format, so COLLADA is the exchange
 * format SketchUp imports natively.
 */

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotX = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rotX !== 0) g.rotateX(rotX)
  g.translate(x, y, z)
  return g
}

// Build the wall as one merged geometry, in the same local frame the app
// renders: x across the width, y up, z toward the mat.
export function buildWallGeometry(design: WallDesign): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const W = designWidth(design)
  const depth = designDepth(design)
  const t = design.thickness
  const backZ = -depth / 2
  const wallBack = backZ + design.skeletonDepth
  const H = design.height

  // climbing panels per section
  let x = -W / 2
  for (const sec of design.sections) {
    const cx = x + sec.width / 2
    const pts = sectionPoints(sec, H)
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]
      const p1 = pts[i + 1]
      const dy = p1.y - p0.y
      const doff = p1.off - p0.off
      const len = Math.hypot(dy, doff) + 0.1
      const ang = Math.atan2(doff, dy)
      parts.push(
        box(sec.width, len, t, cx, (p0.y + p1.y) / 2, wallBack + t / 2 + (p0.off + p1.off) / 2, ang),
      )
    }
    // top cap
    const topOff = pts[pts.length - 1].off
    parts.push(box(sec.width, 0.12, 0.5, cx, H + 0.06, wallBack + t / 2 + topOff))
    x += sec.width
  }

  // steel skeleton: rear posts + cross beams + diagonals
  const nPosts = Math.max(2, Math.round(W / 1.6))
  const maxOff = designMaxOff(design)
  for (let i = 0; i < nPosts; i++) {
    const px = -W / 2 + 0.15 + (i * (W - 0.3)) / (nPosts - 1)
    parts.push(box(0.08, H, 0.08, px, H / 2, backZ + 0.06))
    parts.push(box(0.07, 0.07, design.skeletonDepth + 0.3, px, H * 0.35, backZ + (design.skeletonDepth + 0.3) / 2))
    parts.push(
      box(0.07, 0.07, design.skeletonDepth + maxOff * 0.7, px, H * 0.85, backZ + (design.skeletonDepth + maxOff * 0.7) / 2),
    )
    parts.push(
      box(
        0.06,
        Math.hypot(H * 0.5, design.skeletonDepth + 0.2),
        0.06,
        px,
        H * 0.6,
        backZ + (design.skeletonDepth + 0.2) / 2,
        Math.atan2(design.skeletonDepth + 0.2, H * 0.5),
      ),
    )
  }

  // landing mat in front
  if (design.matDepth > 0.05) {
    parts.push(box(W, design.matThick, design.matDepth, 0, design.matThick / 2, depth / 2 - design.matDepth / 2))
  }

  const merged = mergeGeometries(parts, false)!
  parts.forEach((p) => p.dispose())
  return merged
}

function download(filename: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

const safe = (name: string) => name.replace(/[^\w\-]+/g, '_') || 'wall'

/* --------------------------------- STL --------------------------------- */

export function exportSTL(design: WallDesign) {
  const geo = buildWallGeometry(design)
  const mesh = new THREE.Mesh(geo)
  mesh.scale.setScalar(1000) // meters → millimeters for slicers
  mesh.updateMatrixWorld(true)
  const data = new STLExporter().parse(mesh, { binary: true }) as unknown as DataView
  download(`${safe(design.name)}.stl`, new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' }))
  geo.dispose()
}

/* --------------------------------- 3MF --------------------------------- */

// minimal STORED (uncompressed) zip writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function makeZip(entries: Array<{ name: string; data: Uint8Array }>): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const nameB = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = new Uint8Array(30 + nameB.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, nameB.length, true)
    local.set(nameB, 30)
    chunks.push(local, e.data)

    const cd = new Uint8Array(46 + nameB.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, nameB.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nameB, 46)
    central.push(cd)
    offset += local.length + e.data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, eocd] as BlobPart[], { type: 'model/3mf' })
}

// vertices/triangles from an indexed or non-indexed geometry, with an
// axis/scale transform applied per vertex
function extractMesh(geo: THREE.BufferGeometry, tf: (x: number, y: number, z: number) => [number, number, number]) {
  const pos = geo.getAttribute('position')
  const verts: number[][] = []
  for (let i = 0; i < pos.count; i++) verts.push(tf(pos.getX(i), pos.getY(i), pos.getZ(i)))
  let tris: number[]
  if (geo.index) tris = Array.from(geo.index.array as ArrayLike<number>)
  else tris = Array.from({ length: pos.count }, (_, i) => i)
  return { verts, tris }
}

export function export3MF(design: WallDesign) {
  const geo = buildWallGeometry(design)
  // 3MF is Z-up, millimeters
  const { verts, tris } = extractMesh(geo, (x, y, z) => [x * 1000, -z * 1000, y * 1000])
  geo.dispose()
  const vXml = verts.map((v) => `<vertex x="${v[0].toFixed(2)}" y="${v[1].toFixed(2)}" z="${v[2].toFixed(2)}"/>`).join('')
  const tXml: string[] = []
  for (let i = 0; i < tris.length; i += 3) tXml.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`)
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources><object id="1" type="model"><mesh><vertices>${vXml}</vertices><triangles>${tXml.join('')}</triangles></mesh></object></resources>` +
    `<build><item objectid="1"/></build></model>`
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
  const enc = new TextEncoder()
  const blob = makeZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ])
  download(`${safe(design.name)}.3mf`, blob)
}

/* ------------------------------ COLLADA (.dae) ------------------------------ */

export function exportDAE(design: WallDesign) {
  const geo = buildWallGeometry(design)
  // SketchUp is Z-up; COLLADA declared in meters
  const { verts, tris } = extractMesh(geo, (x, y, z) => [x, -z, y])
  geo.dispose()
  const flat = verts.map((v) => `${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`).join(' ')
  const dae =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">` +
    `<asset><contributor><authoring_tool>Gym Layout Planner</authoring_tool></contributor>` +
    `<unit meter="1" name="meter"/><up_axis>Z_UP</up_axis></asset>` +
    `<library_geometries><geometry id="wall" name="${safe(design.name)}"><mesh>` +
    `<source id="pos"><float_array id="posa" count="${verts.length * 3}">${flat}</float_array>` +
    `<technique_common><accessor source="#posa" count="${verts.length}" stride="3">` +
    `<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>` +
    `</accessor></technique_common></source>` +
    `<vertices id="verts"><input semantic="POSITION" source="#pos"/></vertices>` +
    `<triangles count="${tris.length / 3}"><input semantic="VERTEX" source="#verts" offset="0"/>` +
    `<p>${tris.join(' ')}</p></triangles>` +
    `</mesh></geometry></library_geometries>` +
    `<library_visual_scenes><visual_scene id="Scene" name="Scene">` +
    `<node id="wallNode" name="${safe(design.name)}"><instance_geometry url="#wall"/></node>` +
    `</visual_scene></library_visual_scenes>` +
    `<scene><instance_visual_scene url="#Scene"/></scene></COLLADA>`
  download(`${safe(design.name)}.dae`, new Blob([dae], { type: 'model/vnd.collada+xml' }))
}
