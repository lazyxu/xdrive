import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = file => readFileSync(resolve(root, file), 'utf8')
const app = read('web/src/App.tsx')

assert.doesNotMatch(app, /XDriveManualConnectionDialog|data-xdrive-manual-connection-(login|menu)/)
assert.doesNotMatch(app, /\bconnectionOpen\b|\bsetConnectionOpen\b|手动切换公网\s*\/\s*局域网入口/)
for (const retired of [
  'web/src/manualConnection.ts',
  'web/src/ManualConnectionDialog.tsx',
  'web/scripts/test-https-manual-connection.mjs',
]) assert.equal(existsSync(resolve(root, retired)), false, retired + ' should be retired')

// Neither a new Origin nor a browser-local address bookmark is needed to
// authenticate or recover the existing installation's offline views.
assert.match(app, /data-xdrive-pwa-account-entry/)
assert.match(app, /data-xdrive-pwa-login-entry/)
assert.match(app, /data-xdrive-pwa-offline-login-entry/)
assert.match(app, /return xDriveObservePwaBeforeUnload\(window\)/)
assert.match(app, /setTransferSessionKey\(username \?/)
assert.match(read('web/src/api.ts'), /Browser refresh requires HTTPS/)
assert.match(read('web/src/api.ts'), /credentials: 'same-origin'/)
assert.match(read('web/src/pwaRuntime.ts'), /navigator\.serviceWorker\.register\('\/sw\.js'/)
assert.match(read('web/src/pwaOfflineDirectory.ts'), /owner\.origin !== window\.location\.origin/)
assert.match(read('assets/icon/web/sw.js'), /url\.origin !== self\.location\.origin/)
assert.match(read('web/package.json'), /node scripts\/test-no-manual-connection\.mjs/)

console.log('Web/PWA manual-origin navigation removed; same-origin login, offline data and transfer guard retained')
