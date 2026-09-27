import crypto from 'node:crypto'
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
const trayDir = path.join(repoRoot, 'assets', 'icon', 'tray')
const generatedManifestPath = path.join(repoRoot, 'assets', 'icon', 'generated-assets.json')

function gitBlobSha(data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return crypto
    .createHash('sha1')
    .update(`blob ${payload.length}\0`)
    .update(payload)
    .digest('hex')
}

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

function trayVariantSvg(svg, kind) {
  const badges = {
    normal: '',
    syncing: `
  <g aria-label="syncing status">
    <circle cx="790" cy="790" r="150" fill="#FFFFFF" stroke="#1787FA" stroke-width="34"/>
    <path d="M 716 788 A 78 78 0 0 1 835 726" fill="none" stroke="#1787FA" stroke-width="38" stroke-linecap="round"/>
    <path d="M 834 726 L 824 665 L 884 690" fill="#1787FA"/>
    <path d="M 864 792 A 78 78 0 0 1 745 853" fill="none" stroke="#1787FA" stroke-width="38" stroke-linecap="round"/>
    <path d="M 746 853 L 756 914 L 696 889" fill="#1787FA"/>
  </g>`,
    paused: `
  <g aria-label="paused status">
    <circle cx="790" cy="790" r="150" fill="#FFFFFF" stroke="#1787FA" stroke-width="34"/>
    <rect x="730" y="714" width="42" height="152" rx="18" fill="#1787FA"/>
    <rect x="808" y="714" width="42" height="152" rx="18" fill="#1787FA"/>
  </g>`,
    conflict: `
  <g aria-label="conflict status">
    <circle cx="790" cy="790" r="150" fill="#E5484D" stroke="#FFFFFF" stroke-width="34"/>
    <path d="M 790 706 L 790 812" stroke="#FFFFFF" stroke-width="42" stroke-linecap="round"/>
    <circle cx="790" cy="862" r="24" fill="#FFFFFF"/>
  </g>`,
    offline: `
  <g aria-label="offline status">
    <circle cx="790" cy="790" r="150" fill="#667085" stroke="#FFFFFF" stroke-width="34"/>
    <path d="M 705 875 L 875 705" stroke="#FFFFFF" stroke-width="42" stroke-linecap="round"/>
  </g>`,
  }
  if (!(kind in badges)) throw new Error(`Unknown tray icon kind: ${kind}`)
  return svg.replace('</svg>', `${badges[kind]}\n</svg>`)
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
fs.mkdirSync(trayDir, { recursive: true })

const renderer = resolveRenderer()
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-icons-'))
try {
  const sourceSvg = path.join(tempDir, 'xdrive-icon-render.svg')
  const compatibleMasterSvg = rendererCompatibleSvg(fs.readFileSync(masterPath, 'utf8'))
  fs.writeFileSync(sourceSvg, compatibleMasterSvg, 'utf8')

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
  const trayKinds = ['normal', 'syncing', 'paused', 'conflict', 'offline']
  for (const kind of trayKinds) {
    const traySvgPath = path.join(tempDir, `tray-${kind}.svg`)
    const trayPngPath = path.join(trayDir, `tray-${kind}.png`)
    fs.writeFileSync(traySvgPath, trayVariantSvg(compatibleMasterSvg, kind), 'utf8')
    renderSvg(renderer, traySvgPath, 16, trayPngPath)
  }

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

  const sourceRelative = 'assets/icon/master/xdrive-icon-master.svg'
  const generatedRelativePaths = [
    'assets/icon/web/favicon.svg',
    'assets/icon/web/favicon.ico',
    'assets/icon/web/apple-touch-icon.png',
    'assets/icon/web/pwa-192.png',
    'assets/icon/web/pwa-512.png',
    'assets/icon/web/site.webmanifest',
    'assets/icon/windows/app.ico',
    'assets/icon/tray/tray-normal.png',
    'assets/icon/tray/tray-syncing.png',
    'assets/icon/tray/tray-paused.png',
    'assets/icon/tray/tray-conflict.png',
    'assets/icon/tray/tray-offline.png',
  ]
  const generatedAssets = {
    version: 2,
    source: {
      path: sourceRelative,
      git_blob_sha: gitBlobSha(fs.readFileSync(path.join(repoRoot, sourceRelative))),
    },
    generated: Object.fromEntries(
      generatedRelativePaths.map((relative) => [
        relative,
        gitBlobSha(fs.readFileSync(path.join(repoRoot, relative))),
      ]),
    ),
  }
  fs.writeFileSync(generatedManifestPath, `${JSON.stringify(generatedAssets, null, 2)}\n`, 'utf8')

  console.log(`Generated xDrive icon derivatives from ${path.relative(repoRoot, masterPath)} using ${renderer}.`)
  console.log('Web: favicon.svg, favicon.ico, apple-touch-icon.png, pwa-192.png, pwa-512.png, site.webmanifest')
  console.log('Windows: app.ico (16/32/48/64/256)')
  console.log('Tray: tray-normal/syncing/paused/conflict/offline.png (16x16, master-derived)')
  console.log('Contract: assets/icon/generated-assets.json')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
