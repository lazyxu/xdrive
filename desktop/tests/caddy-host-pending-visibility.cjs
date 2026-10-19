const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('shared Caddy HTTPS and AliDNS panels honor an unapplied Host reservation', () => {
  const types = read('ui/shared/src/service-dependencies.ts')
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  const serverHTTPS = read('internal/api/admin_caddy_https_desired.go')
  const serverAliDNS = read('internal/api/admin_caddy_alidns.go')
  assert.equal((types.match(/host_apply_pending\?: boolean/g) || []).length, 2)
  for (const server of [serverHTTPS, serverAliDNS]) {
    assert.match(server, /HostApplyPending/)
    assert.match(server, /readCaddyHostPendingUnappliedDB/)
    assert.match(server, /http.StatusServiceUnavailable/)
    assert.match(server, /ApplySupported: false/)
  }
  assert.match(https, /config\.host_apply_pending/)
  assert.match(https, /data-xdrive-caddy-host-pending-fence/)
  assert.match(https, /!config\.editable \|\| !source\.saveCaddyHTTPSConfig/)
  assert.match(https, /!config\.editable \|\| !source\.rollbackCaddyHTTPS/)
  assert.match(alidns, /data-xdrive-caddy-alidns-host-pending/)
  assert.match(alidns, /!config\.editable \|\| !source\.saveCaddyAliDNS/)
  assert.match(alidns, /!config\.editable && !config\.host_apply_pending/)
  for (const panel of [https, alidns]) {
    assert.doesNotMatch(panel, /docker\.sock|adminRestartHost|adminStopHost/)
  }
})
