'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Web, Mobile Web and installed PWA no longer expose redundant manual origin navigation', () => {
  const app = read('web/src/App.tsx')
  assert.doesNotMatch(app, /XDriveManualConnectionDialog|data-xdrive-manual-connection-(login|menu)/)
  assert.doesNotMatch(app, /\bconnectionOpen\b|\bsetConnectionOpen\b|手动切换公网\s*\/\s*局域网入口/)
  for (const oldFile of [
    'web/src/manualConnection.ts',
    'web/src/ManualConnectionDialog.tsx',
    'web/scripts/test-https-manual-connection.mjs',
  ]) assert.equal(fs.existsSync(path.join(root, oldFile)), false, 'retired Web-only file: ' + oldFile)
  assert.match(read('web/package.json'), /node scripts\/test-no-manual-connection\.mjs/)
  assert.doesNotMatch(read('web/package.json'), /test-https-manual-connection\.mjs/)
})

test('Removing the shortcut preserves Web/PWA login, offline routes, upload guard and origin isolation', () => {
  const app = read('web/src/App.tsx')
  const api = read('web/src/api.ts')
  const worker = read('assets/icon/web/sw.js')
  const manifest = read('assets/icon/web/site.webmanifest')
  const offline = read('web/src/pwaOfflineDirectory.ts')
  assert.match(app, /data-xdrive-pwa-login-entry/)
  assert.match(app, /data-xdrive-pwa-offline-login-entry/)
  assert.match(app, /data-xdrive-pwa-account-entry/)
  assert.match(app, /xDriveObservePwaBeforeUnload\(window\)/)
  assert.match(app, /setTransferSessionKey\(username \?/)
  assert.match(app, /XDriveAccountMenuActions/)
  assert.match(api, /Browser refresh requires HTTPS/)
  assert.match(api, /credentials: 'same-origin'/)
  assert.match(api, /const API_BASE = /)
  assert.match(worker, /url\.origin !== self\.location\.origin/)
  assert.match(offline, /owner\.origin !== window\.location\.origin/)
  assert.match(manifest, /"start_url": "\/"/)
  assert.match(manifest, /"scope": "\/"/)
  // Do not erase previously saved, nonsecret endpoint hints during this UI cleanup.
  assert.doesNotMatch(app, /(?:removeItem|localStorage\.clear)\([^)]*manual_endpoint/)
})

test('Desktop native manual server switch still requires logout and an editable login origin', () => {
  const app = read('desktop/src/renderer/App.tsx')
  assert.match(app, /data-xdrive-manual-server-switch/)
  assert.match(app, /const requestSwitchServer = \(\) => \{/)
  assert.match(app, /requestConfirmation\(/)
  assert.match(app, /await run\('logout', \(\) => window\.xdriveDesktop\.agent\.logout\(\)\)/)
  assert.match(app, /id="desktop-login-server"/)
  assert.match(app, /freeSolo/)
  assert.match(app, /server: server\.trim\(\)/)
  assert.doesNotMatch(app, /setServer\('192\.168\.2\.4'\)/)
})
