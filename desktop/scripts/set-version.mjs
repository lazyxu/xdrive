import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('usage: node scripts/set-version.mjs <semver>')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(root, 'package.json')
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
manifest.version = version
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
