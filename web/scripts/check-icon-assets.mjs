import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const webIcons = path.join(repo, 'assets', 'icon', 'web')
const masterPath = path.join(repo, 'assets', 'icon', 'master', 'xdrive-icon-master.svg')
const read = (name) => fs.readFileSync(path.join(webIcons, name))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function pngSize(name, width, height) {
  const data = read(name)
  assert(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name}: invalid PNG signature`)
  assert(data.readUInt32BE(16) === width && data.readUInt32BE(20) === height, `${name}: expected ${width}x${height}`)
}


// Validate alpha channel pixels directly with Node's zlib, not with an
// optional raster tool. iOS and maskable PWA launchers must have no transparent
// corners or inset outlines: the operating system owns the corner mask.
function assertOpaqueLauncherPng(name) {
  const data = read(name)
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const bitDepth = data[24]
  const colorType = data[25]
  assert(bitDepth === 8, `${name}: expected 8-bit PNG`)
  assert([2, 3, 6].includes(colorType), `${name}: unexpected PNG color mode ${colorType}`)
  let offset = 8
  const payloads = []
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const end = offset + 12 + length
    assert(end <= data.length, `${name}: truncated PNG chunk`)
    const type = data.toString('ascii', offset + 4, offset + 8)
    assert(type !== 'tRNS', `${name}: transparent indexed/RGB colors are not allowed`)
    if (type === 'IDAT') payloads.push(data.subarray(offset + 8, offset + 8 + length))
    offset = end
    if (type === 'IEND') break
  }
  assert(payloads.length > 0, `${name}: missing image data`)
  if (colorType !== 6) return // RGB / palette without tRNS is fully opaque.
  // PNG Sub/Up/Average/Paeth filters operate independently per RGBA channel.
  // Reconstructing alpha alone tests every pixel without decoding color data.
  const stride = width * 4
  const pixels = inflateSync(Buffer.concat(payloads))
  assert(pixels.length === height * (stride + 1), `${name}: unexpected scanline size`)
  let previous = new Uint8Array(width)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1)
    const filter = pixels[rowOffset]
    assert(filter >= 0 && filter <= 4, `${name}: unsupported PNG filter`)
    const alphas = new Uint8Array(width)
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? alphas[x - 1] : 0
      const b = previous[x]
      const c = x > 0 ? previous[x - 1] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      if (filter === 2) predictor = b
      if (filter === 3) predictor = Math.floor((a + b) / 2)
      if (filter === 4) {
        const estimate = a + b - c
        const da = Math.abs(estimate - a)
        const db = Math.abs(estimate - b)
        const dc = Math.abs(estimate - c)
        predictor = da <= db && da <= dc ? a : db <= dc ? b : c
      }
      const alpha = (pixels[rowOffset + 1 + x * 4 + 3] + predictor) & 255
      assert(alpha === 255, `${name}: transparent pixel at ${x},${y}`)
      alphas[x] = alpha
    }
    previous = alphas
  }
}

const master = fs.readFileSync(masterPath)
const masterText = master.toString('utf8')
assert(masterText.split('<rect x="0" y="0" width="1024" height="1024" rx="242"').length - 1 === 2,
  'Master SVG must have two full-bleed rounded blue background rectangles')
assert(!masterText.includes('<rect x="48" y="48" width="928" height="928"'),
  'Master SVG must not retain the old 48px transparent outside margin')
assert(read('favicon.svg').equals(master), 'favicon.svg must be regenerated exactly from the approved master SVG')

const ico = read('favicon.ico')
assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'favicon.ico: invalid ICO header')
const count = ico.readUInt16LE(4)
const sizes = []
for (let i = 0; i < count; i++) {
  const offset = 6 + i * 16
  const width = ico[offset] || 256
  const height = ico[offset + 1] || 256
  assert(width === height, 'favicon.ico: frames must be square')
  sizes.push(width)
}
for (const size of [16, 32, 48]) assert(sizes.includes(size), `favicon.ico: missing ${size}x${size} frame`)

pngSize('apple-touch-icon.png', 180, 180)
pngSize('pwa-192.png', 192, 192)
pngSize('pwa-512.png', 512, 512)
for (const name of ['apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png']) {
  assertOpaqueLauncherPng(name)
}

const manifest = JSON.parse(read('site.webmanifest').toString('utf8'))
assert(manifest.theme_color === '#1787FA', 'site.webmanifest: theme color drifted')
assert(manifest.icons.some((icon) => icon.src === '/pwa-192.png' && icon.sizes === '192x192'), 'site.webmanifest: missing 192 icon')
assert(manifest.icons.some((icon) => icon.src === '/pwa-512.png' && icon.sizes === '512x512'), 'site.webmanifest: missing 512 icon')
assert(manifest.icons.every((icon) => icon.purpose === 'any maskable'), 'site.webmanifest: launcher icons must be maskable')

const html = fs.readFileSync(path.join(repo, 'web', 'index.html'), 'utf8')
for (const asset of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest']) {
  assert(html.includes(asset), `web/index.html: missing ${asset}`)
}

const vite = fs.readFileSync(path.join(repo, 'web', 'vite.config.ts'), 'utf8')
assert(vite.includes("publicDir: '../assets/icon/web'"), 'Vite must serve the generated Web icon directory')

const appSource = fs.readFileSync(path.join(repo, 'web', 'src', 'App.tsx'), 'utf8')
assert(
  appSource.includes("import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'"),
  'Web brand lockups must import the approved master SVG directly',
)
assert((appSource.match(/iconSrc=\{xDriveBrandIcon\}/g) || []).length === 3, 'Web must pass the shared master icon to all three brand lockups')
assert(!appSource.includes('src="/xdrive-icon-master.svg"'), 'Web must not reference a stale public master-icon path')

const caddyDockerfile = fs.readFileSync(path.join(repo, 'deploy', 'Caddy.Dockerfile'), 'utf8')
assert(
  caddyDockerfile.includes('COPY web/dist/ /srv/'),
  'Merged Caddy/Web image must copy the CI-built Web dist into /srv',
)

console.log('xDrive Web icon assets passed validation')
