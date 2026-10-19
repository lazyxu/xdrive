'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('A3c18 owner-safe Server release reasons cannot enable the map', () => {
  const api = read('internal/api/baidu_jsapi_config.go')
  const report = read('internal/api/baidu_jsapi4_release_readiness.go')
  const managed = read('internal/api/baidu_jsapi4_managed_runtime.go')
  assert.match(managed, /loadBaiduJSAPI4ManagedMaterials\(/)
  assert.match(managed, /JSAPI4ApprovedPolicySHA256\(/)
  assert.match(managed, /RefreshBaiduJSAPI4ManagedRelease\(/)
  assert.match(api, /ReleaseBlockers:\s+s\.baiduJSAPI4ReleaseBlockers\(cfg, approved\)/)
  assert.match(report, /baiduJSAPI4ManagedSignerReady\(\)/)
  assert.match(report, /JSAPI4ChildInventoryComplete\(\)/)
  assert.match(report, /TrustedProxyBase\(s\.AllowedOrigin\)/)
  assert.match(read('internal/baidumapjsapi/release_attestation.go'),
    /VerifyManagedJSAPI4ProductionRelease\(/)
  assert.match(read('internal/baidumapjsapi/resource_policy.go'),
    /reviewedJSAPI4ChildResourceCount = 1/)
  assert.doesNotMatch(report, /os\.Getenv|http\.Get|window\.|browser_ak\s*:/)
})

test('A3c18 single shared Web/Mobile/PWA/Desktop Verify view never reads existing AK', () => {
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const source = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(read('ui/shared/src/service-dependencies.ts'), /release_blockers\?:/)
  assert.match(read('desktop/src/main/agent_client.cts'), /release_blockers\?:/)
  assert.match(source, /XDriveBaiduJSAPIDesiredPanel/)
  assert.match(panel, /data-xdrive-baidu-jsapi4-release-blockers/)
  assert.match(panel, /config\.release_blockers\.map/)
  assert.match(panel, /releaseBlockerLabels\[reason\]/)
  assert.match(panel, /releaseBlockerIDs\.includes\(reason\)/)
  assert.doesNotMatch(panel, /_BMapSecurityConfig|api\.map\.baidu\.com|src="\/_BMapService/)
})
