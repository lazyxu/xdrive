#!/usr/bin/env node
// Deterministic allowlist for a DSM-only React+MUI static bundle.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('..', import.meta.url))
const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(web, 'dist-synology')
if (!fs.statSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink()) {
  throw new Error('DSM bundle must be a real directory')
}
const entries = []
for (const name of fs.readdirSync(dist, { withFileTypes: true })) {
  if (!name.isDirectory() && !name.isFile()) throw new Error('unsupported DSM bundle entry')
}
function walk(dir) {
  for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, child.name)
    if (child.isSymbolicLink() || (!child.isFile() && !child.isDirectory())) {
      throw new Error('unsafe DSM bundle filesystem item')
    }
    if (child.isDirectory()) walk(filename)
    else entries.push(path.relative(dist, filename).replaceAll(path.sep, '/'))
  }
}
walk(dist)
if (!entries.includes('synology.html') || !entries.includes('.vite/manifest.json') ||
    entries.some(x => x === 'index.html' || x.includes('..') ||
      x.includes('service-worker') || x.includes('sw.js') || x.includes('site.webmanifest') ||
      !/^(synology\.html|\.vite\/manifest\.json|assets\/[a-zA-Z0-9_./-]+\.(?:css|js|png))$/.test(x))) {
  throw new Error('DSM bundle contains unsafe or unexpected artifacts: ' + entries.join(', '))
}
// Vite may emit imported media icons from shared MUI. Admit only bounded,
// valid PNG payloads; reject arbitrary media or files from unrelated Web apps.
const pngMagic = Buffer.from('89504e470d0a1a0a', 'hex')
for (const asset of entries.filter((name) => name.startsWith('assets/') && name.endsWith('.png'))) {
  const bytes = fs.readFileSync(path.join(dist, asset))
  if (bytes.length < 24 || bytes.length > 2 * 1024 * 1024 ||
      !bytes.subarray(0, pngMagic.length).equals(pngMagic)) {
    throw new Error('Invalid or oversized DSM PNG asset: ' + asset)
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
const entry = manifest['synology.html']
if (!entry?.isEntry || !entry.file?.endsWith('.js') || !entries.includes(entry.file)) {
  throw new Error('DSM UI entrypoint is not bundled')
}
const html = fs.readFileSync(path.join(dist, 'synology.html'), 'utf8')
if (!html.includes('type="module"') || !html.includes('./assets/') ||
    html.includes('http://') || html.includes('https://') || html.includes('serviceWorker')) {
  throw new Error('DSM UI HTML is not same-path static only')
}
console.log('Synology shared MUI static app verified: ' + entries.length + ' files')
