'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('A3g shared six-field config snapshot displays actual Server state, not synthetic toggle success', () => {
  const snapshot = read('ui/shared/src/mui/BaiduJSAPIConfigSnapshot.tsx')
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const server = read('internal/api/baidu_jsapi_config.go')
  const contract = read('ui/shared/src/service-dependencies.ts')
  for (const field of ['configured', 'desired_enabled', 'runtime_enabled', 'activation_state', 'release_blockers', 'requires_restart']) {
    assert.match(snapshot, new RegExp("key: '"+field+"'"))
    assert.match(server, new RegExp('json:"'+field+'"'))
  }
  assert.match(snapshot, /data-xdrive-baidu-jsapi4-six-field-state/)
  assert.match(snapshot, /key === 'runtime_enabled'/)
  assert.match(snapshot, /blockers === undefined \? '未返回'/)
  assert.match(panel, /XDriveBaiduJSAPIConfigSnapshot config=\{config\}/)
  assert.match(panel, /source\.loadBaiduJSAPIConfig\(\)/)
  assert.match(panel, /if \(busy \|\| refreshing \|\| dirty/)
  assert.match(panel, /if \(!validConfig\(value\)\)/)
  assert.match(contract, /activation_state: 'blocked_pending_licence_and_proxy' \| 'authorized_signed_release'/)
  assert.doesNotMatch(snapshot, /_BMapSecurityConfig|\.src\s*=|fetch\(|browser_ak\s*:/)
})

test('A3g never allows clients to edit derived runtime authorization or echo saved Browser AK', () => {
  const snapshot = read('ui/shared/src/mui/BaiduJSAPIConfigSnapshot.tsx')
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  assert.match(snapshot, /Server 实际状态/)
  assert.match(panel, /XDriveSensitiveField label="Browser AK"/)
  assert.match(panel, /onReveal=\{\(\) => \{ void revealAK\(\) \}\}/)
  assert.match(panel, /result\.runtime_enabled/)
  assert.doesNotMatch(snapshot, /onChange|TextField|Switch|setConfig|setEnabled/)
})
