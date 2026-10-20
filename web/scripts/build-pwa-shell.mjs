import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const swTemplate = path.resolve(webRoot, '../assets/icon/web/sw.js')
const MAX_SHELL_BYTES = 24 * 1024 * 1024
const MAX_SHELL_FILES = 120
const PUBLIC_BUNDLE = /^assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|svg|png|webp|woff2?)$/

export function buildXDrivePublicShell(dist = path.join(webRoot, 'dist'), template = swTemplate) {
  const manifest = JSON.parse(readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
  const entryKeys = Object.keys(manifest).filter(key => manifest[key]?.isEntry === true)
  if (entryKeys.length !== 1) throw new Error('PWA build must have one Vite application entry')
  const discovered = new Set()
  const visited = new Set()
  function visit(key) {
    if (visited.has(key)) return
    const entry = manifest[key]
    if (!entry) throw new Error('Missing static Vite import: ' + key)
    visited.add(key)
    for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (!file) continue
      if (!PUBLIC_BUNDLE.test(file) || file.split('/').some(part =>
          !part || part === '.' || part === '..'))
        throw new Error('Unexpected public bundle path: ' + file)
      discovered.add('/' + file)
    }
    // Exclude dynamic imports: those are optional viewers/diagnostics/perf tools,
    // rather than the mandatory, small startup App Shell.
    for (const dependency of entry.imports || []) visit(dependency)
  }
  visit(entryKeys[0])
  const urls = ['/index.html', ...[...discovered].sort()]
  if (!discovered.size || ![...discovered].some(p => p.endsWith('.js')) ||
      urls.length > MAX_SHELL_FILES) throw new Error('Missing/oversized PWA static dependency graph')
  const hash = createHash('sha256')
  const templateSource = readFileSync(template, 'utf8')
  hash.update(templateSource)
  let bytes = 0
  for (const url of urls) {
    const root = path.resolve(dist)
    const filename = path.resolve(root, url.slice(1))
    if (!filename.startsWith(root + path.sep)) throw new Error('Escaped PWA build output root')
    const info = lstatSync(filename)
    if (!info.isFile() || !Number.isSafeInteger(info.size)) throw new Error('Invalid public bundle file: ' + url)
    bytes += info.size
    if (bytes > MAX_SHELL_BYTES) throw new Error('PWA startup resources exceed 24 MiB pre-cache limit')
    hash.update(url)
    hash.update(readFileSync(filename))
  }
  const revision = hash.digest('hex').slice(0, 20)
  const compiled = templateSource
    .replace("const SHELL_REVISION = 'template'", "const SHELL_REVISION = '" + revision + "'")
    .replace('const SHELL_URLS = []', 'const SHELL_URLS = ' + JSON.stringify(urls))
  if (compiled === templateSource || compiled.includes("SHELL_REVISION = 'template'"))
    throw new Error('Invalid PWA SW template injection markers')
  writeFileSync(path.join(dist, 'sw.js'), compiled)
  return { revision, fileCount: urls.length, bytes }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (['VITE_XDRIVE_FILE_EXPLORER_PERF', 'VITE_XDRIVE_GALLERY_PERF',
    'VITE_XDRIVE_LARGE_TRANSFER_PERF'].some(key => process.env[key] === '1')) {
    console.log('PWA shell generation skipped for isolated performance build')
  } else {
    const result = buildXDrivePublicShell()
    console.log('Public PWA App Shell: ' + result.fileCount + ' files, ' +
      result.bytes + ' bytes, ' + result.revision)
  }
}
