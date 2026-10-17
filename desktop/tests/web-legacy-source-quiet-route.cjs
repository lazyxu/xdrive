const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname,'..','..')
const app = fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
const hook = fs.readFileSync(path.join(root,'ui/shared/src/mui/useDeferredLoading.ts'),'utf8')
const apps = fs.readFileSync(path.join(root,'web/src/webApps.ts'),'utf8')

test('legacy Sync Folders redirect stays quiet for a quick owner lookup', () => {
  assert.ok(app.includes("useXDriveDeferredLoading(\n    legacyPending, legacyGeneration,"))
  assert.ok(app.includes('data-xdrive-legacy-source-quiet-redirect'))
  assert.ok(app.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(app.includes('showDelayedLegacyLoading ? ('))
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
  assert.equal(app.includes('loading={!legacySourceMissing}'), false)
})

test('different route IDs and accounts never inherit old failure or delayed spinner', () => {
  for(const token of [
    "route.app === 'sync-folders' ? route.params.source : undefined",
    'legacyOwnerRef.current.api !== api',
    'legacyOwnerRef.current.sourceID !== legacySourceID',
    'legacyOwnerRef.current.generation + 1',
    'legacyResolution?.api === api',
    'legacyResolution.sourceID === legacySourceID',
    'legacyResolution.generation === legacyGeneration',
    'return () => { active = false }',
  ]) assert.ok(app.includes(token),token)
})

test('successful legacy deep link still selects real Server-authorized Push or Pull app', () => {
  assert.ok(app.includes('void api.sources().then((sources) => {'))
  assert.ok(app.includes('sources.find((item) => item.id === sourceID)'))
  assert.ok(app.includes("source.direction === 'push' ? 'device-backup' : 'remote-pull'"))
  assert.ok(app.includes('params: { source: sourceID }'))
  assert.ok(app.includes("app: 'remote-pull', params: {}"))
  assert.ok(app.includes("setLegacyResolution({ api, sourceID, generation: legacyGeneration, failed: true })"))
  assert.ok(app.includes('该来源不存在或没有查看权限'))
  assert.ok(apps.includes("if (app === 'sync-folders') return 'remote-pull'"))
})
