/** Rasterize the icon's rounded rectangles without adding a build dependency. */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const source = new URL('../assets/icon.svg', import.meta.url)
const svg = readFileSync(source, 'utf8')
if (!/viewBox="0 0 64 64"/.test(svg) || /<(?:path|circle|ellipse|polygon|image|use)\b/.test(svg)) {
  throw new Error('The rasterizer supports the 64×64 rounded-rectangle icon only')
}
const rectangles = [...svg.matchAll(/<rect\b([^>]+)\/>/g)].map(([, raw]) => {
  const a = Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
  const values = ['x', 'y', 'width', 'height', 'rx'].map((key) => Number(a[key]))
  if (!values.every(Number.isFinite) || !/^#[\da-f]{6}$/i.test(a.fill)) throw new Error('Invalid icon rectangle')
  const [x, y, width, height, radius] = values
  if (width <= 0 || height <= 0 || radius < 0 || radius > Math.min(width, height) / 2) throw new Error('Invalid icon bounds')
  return { x, y, width, height, radius, rgb: [1, 3, 5].map((offset) => parseInt(a.fill.slice(offset, offset + 2), 16)) }
})
if (rectangles.length !== 4) throw new Error('Expected one tile and three keys')
const size = 512
const samples = 4
const scanlines = Buffer.alloc(size * (1 + size * 4))
const contains = (r, x, y) => {
  if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return false
  const cx = Math.max(r.x + r.radius, Math.min(x, r.x + r.width - r.radius))
  const cy = Math.max(r.y + r.radius, Math.min(y, r.y + r.height - r.radius))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r.radius ** 2
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const total = [0, 0, 0]
    let covered = 0
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = (x + (sx + 0.5) / samples) * 64 / size
      const py = (y + (sy + 0.5) / samples) * 64 / size
      let color
      for (const r of rectangles) if (contains(r, px, py)) color = r.rgb
      if (color) { covered++; for (let channel = 0; channel < 3; channel++) total[channel] += color[channel] }
    }
    const offset = y * (1 + size * 4) + 1 + x * 4
    for (let channel = 0; channel < 3; channel++) scanlines[offset + channel] = covered ? Math.round(total[channel] / covered) : 0
    scanlines[offset + 3] = Math.round(covered * 255 / samples ** 2)
  }
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of payload) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  payload.copy(result, 4)
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}
const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
writeFileSync(new URL('../assets/icon.png', import.meta.url), png)
console.log(`Built assets/icon.png: ${size}×${size}, ${png.length} bytes`)
