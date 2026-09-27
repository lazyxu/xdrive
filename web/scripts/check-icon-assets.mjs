import fs from 'node:fs'
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

const master = fs.readFileSync(masterPath)
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

const manifest = JSON.parse(read('site.webmanifest').toString('utf8'))
assert(manifest.theme_color === '#1787FA', 'site.webmanifest: theme color drifted')
assert(manifest.icons.some((icon) => icon.src === '/pwa-192.png' && icon.sizes === '192x192'), 'site.webmanifest: missing 192 icon')
assert(manifest.icons.some((icon) => icon.src === '/pwa-512.png' && icon.sizes === '512x512'), 'site.webmanifest: missing 512 icon')

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
assert((appSource.match(/src=\{xDriveBrandIcon\}/g) || []).length === 3, 'Web must use the shared master icon in all three brand lockups')
assert(!appSource.includes('src="/xdrive-icon-master.svg"'), 'Web must not reference a stale public master-icon path')

const dockerfile = fs.readFileSync(path.join(repo, 'web', 'Dockerfile'), 'utf8')
assert(
  dockerfile.includes('COPY assets/icon/ /app/assets/icon/'),
  'Web Docker build must copy shared icon assets before Vite resolves the master SVG and public derivatives',
)

console.log('xDrive Web icon assets passed validation')
