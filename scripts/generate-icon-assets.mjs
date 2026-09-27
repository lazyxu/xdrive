import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = process.env.XDRIVE_REPO_ROOT ? path.resolve(process.env.XDRIVE_REPO_ROOT) : path.resolve(here, '..')
const masterPath = path.join(repoRoot, 'assets', 'icon', 'master', 'xdrive-icon-master.svg')
const webDir = path.join(repoRoot, 'assets', 'icon', 'web')
const windowsDir = path.join(repoRoot, 'assets', 'icon', 'windows')

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function resolveRenderer() {
  if (process.env.XDRIVE_ICON_RENDERER) {
    const renderer = process.env.XDRIVE_ICON_RENDERER
    if (!commandAvailable(renderer)) throw new Error(`Configured icon renderer is unavailable: ${renderer}`)
    return renderer
  }
  for (const candidate of ['inkscape', 'rsvg-convert', 'magick']) {
    if (commandAvailable(candidate)) return candidate
  }
  throw new Error(
    'No SVG renderer found. Install Inkscape (recommended), librsvg/rsvg-convert, or ImageMagick, then rerun `node scripts/generate-icon-assets.mjs`.',
  )
}

function rendererCompatibleSvg(svg) {
  const dropShadow = '<feDropShadow dx=\"0\" dy=\"8\" stdDeviation=\"10\" flood-color=\"#0064E6\" flood-opacity=\"0.16\"/>'
  if (!svg.includes('<feDropShadow')) return svg
  if (!svg.includes(dropShadow)) {
    throw new Error('Master SVG uses an unsupported feDropShadow variant. Update the icon generator compatibility transform before exporting.')
  }
  return svg.replace(dropShadow, `
      <feGaussianBlur in=\"SourceAlpha\" stdDeviation=\"10\" result=\"shadowBlur\"/>
      <feOffset in=\"shadowBlur\" dx=\"0\" dy=\"8\" result=\"shadowOffset\"/>
      <feFlood flood-color=\"#0064E6\" flood-opacity=\"0.16\" result=\"shadowColor\"/>
      <feComposite in=\"shadowColor\" in2=\"shadowOffset\" operator=\"in\" result=\"shadow\"/>
      <feMerge>
        <feMergeNode in=\"shadow\"/>
        <feMergeNode in=\"SourceGraphic\"/>
      </feMerge>`)
}

function renderSvg(renderer, sourceSvg, size, outputPath) {
  let args
  if (path.basename(renderer).toLowerCase().startsWith('inkscape')) {
    args = [sourceSvg, '--export-type=png', `--export-filename=${outputPath}`, `--export-width=${size}`, `--export-height=${size}`]
  } else if (path.basename(renderer).toLowerCase().startsWith('rsvg-convert')) {
    args = ['-w', String(size), '-h', String(size), '-o', outputPath, sourceSvg]
  } else {
    args = ['-background', 'none', sourceSvg, '-resize', `${size}x${size}`, outputPath]
  }
  const result = spawnSync(renderer, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${renderer} failed while rendering ${size}x${size}`)
}

function buildIco(outputPath, frames) {
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let imageOffset = header.length
  const payloads = []
  frames.forEach(({ size, data }, index) => {
    const offset = 6 + index * 16
    header[offset] = size === 256 ? 0 : size
    header[offset + 1] = size === 256 ? 0 : size
    header[offset + 2] = 0
    header[offset + 3] = 0
    header.writeUInt16LE(1, offset + 4)
    header.writeUInt16LE(32, offset + 6)
    header.writeUInt32LE(data.length, offset + 8)
    header.writeUInt32LE(imageOffset, offset + 12)
    imageOffset += data.length
    payloads.push(data)
  })

  fs.writeFileSync(outputPath, Buffer.concat([header, ...payloads]))
}

if (!fs.existsSync(masterPath)) throw new Error(`Missing master SVG: ${masterPath}`)
fs.mkdirSync(webDir, { recursive: true })
fs.mkdirSync(windowsDir, { recursive: true })

const renderer = resolveRenderer()
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-icons-'))
try {
  const sourceSvg = path.join(tempDir, 'xdrive-icon-render.svg')
  fs.writeFileSync(sourceSvg, rendererCompatibleSvg(fs.readFileSync(masterPath, 'utf8')), 'utf8')

  const sizes = [16, 32, 48, 64, 180, 192, 256, 512]
  const rendered = new Map()
  for (const size of sizes) {
    const outputPath = path.join(tempDir, `${size}.png`)
    renderSvg(renderer, sourceSvg, size, outputPath)
    const data = fs.readFileSync(outputPath)
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`Renderer produced an invalid PNG for ${size}x${size}`)
    }
    if (data.readUInt32BE(16) !== size || data.readUInt32BE(20) !== size) {
      throw new Error(`Renderer produced unexpected dimensions for ${size}x${size}`)
    }
    rendered.set(size, data)
  }

  fs.copyFileSync(masterPath, path.join(webDir, 'favicon.svg'))
  fs.writeFileSync(path.join(webDir, 'apple-touch-icon.png'), rendered.get(180))
  fs.writeFileSync(path.join(webDir, 'pwa-192.png'), rendered.get(192))
  fs.writeFileSync(path.join(webDir, 'pwa-512.png'), rendered.get(512))

  buildIco(path.join(webDir, 'favicon.ico'), [16, 32, 48].map((size) => ({ size, data: rendered.get(size) })))
  buildIco(path.join(windowsDir, 'app.ico'), [16, 32, 48, 64, 256].map((size) => ({ size, data: rendered.get(size) })))

  const manifest = {
    name: 'xDrive',
    short_name: 'xDrive',
    icons: [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: '#1787FA',
    background_color: '#F5F7FB',
    display: 'standalone',
  }
  fs.writeFileSync(path.join(webDir, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`Generated xDrive icon derivatives from ${path.relative(repoRoot, masterPath)} using ${renderer}.`)
  console.log('Web: favicon.svg, favicon.ico, apple-touch-icon.png, pwa-192.png, pwa-512.png, site.webmanifest')
  console.log('Windows: app.ico (16/32/48/64/256)')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
