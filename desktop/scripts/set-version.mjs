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

function env(name, fallback = '') {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function decodeBase64(value) {
  if (!value) return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8').trim()
  } catch {
    return ''
  }
}

const buildInfo = {
  version: env('XDRIVE_BUILD_VERSION', version),
  channel: env('XDRIVE_BUILD_CHANNEL', 'dev'),
  commit: env('XDRIVE_BUILD_COMMIT'),
  commit_message: decodeBase64(env('XDRIVE_BUILD_COMMIT_MESSAGE_B64')),
  commit_time: env('XDRIVE_BUILD_COMMIT_TIME'),
  build_time: env('XDRIVE_BUILD_TIME'),
}

const metadataPath = path.join(root, 'src', 'main', 'build_metadata.cts')
writeFileSync(metadataPath, `export const desktopBuildInfo = Object.freeze(${JSON.stringify(buildInfo, null, 2)})\n`)
