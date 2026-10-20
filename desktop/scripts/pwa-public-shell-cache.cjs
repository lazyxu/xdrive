'use strict'
// Strict, test-only proof that production PWA caches contain public bundled files.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const VALID_HASHED_ASSET = /^\/assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|svg|png|webp|woff2?)$/

function expectedXDrivePublicShell() {
  const source = fs.readFileSync(path.join(root, 'web/dist/sw.js'), 'utf8')
  const revision = source.match(/^const SHELL_REVISION = '([a-f0-9]{20})'$/m)?.[1]
  const list = source.match(/^const SHELL_URLS = (\[[^\n]+\])$/m)?.[1]
  assert(revision && list, 'Production Vite build must inject its public shell revision')
  const urls = JSON.parse(list)
  assert(Array.isArray(urls) && urls[0] === '/index.html' && urls.length >= 2)
  assert(urls.slice(1).every(p => typeof p === 'string' && VALID_HASHED_ASSET.test(p)))
  assert(urls.some(p => p.endsWith('.js')))
  assert.equal(new Set(urls).size, urls.length)
  return { names: ['xdrive-pwa-public-offline-v1', 'xdrive-pwa-public-shell-' + revision],
    urls: ['/offline.html', ...urls] }
}

function assertXDrivePublicShellCache(snapshot) {
  const expected = expectedXDrivePublicShell()
  const paths = Array.isArray(snapshot) ? snapshot :
    snapshot.paths || snapshot.resources || snapshot.files
  assert(Array.isArray(paths), 'CacheStorage path audit must provide paths')
  assert.deepEqual([...paths].sort(), [...expected.urls].sort(),
    'PWA CacheStorage contains a missing public App Shell file or unauthorized private URL')
  if (!Array.isArray(snapshot) && snapshot.names) {
    assert.deepEqual([...snapshot.names].sort(), [...expected.names].sort(),
      'PWA CacheStorage must contain only the public offline and current shell cache')
  }
}

module.exports = { expectedXDrivePublicShell, assertXDrivePublicShellCache }
