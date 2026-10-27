const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const desktop = read('desktop/src/renderer/App.tsx')
const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const routes = read('ui/shared/src/mui/WorkspaceRoute.ts')
const host = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
const dsm = read('web/src/synology.tsx')

test('all owning Desktop backup actions feed one typed shared view, no DSM writer', () => {
  assert.match(desktop, /deviceBackupPage:\s*\{/)
  assert.match(outlet, /<XDriveDeviceBackupPage key=\{revision\} \{\.\.\.services\.deviceBackupPage\} \/>/)
  assert.ok(routes.includes("'device-backup'"))
  assert.ok(host.includes('readonly deviceBackupPage?: ComponentProps<typeof XDriveDeviceBackupPage>'))
  assert.equal(dsm.includes('deviceBackupPage:'), false, 'DSM may not borrow Desktop owning writer')
  for (const [key, value] of Object.entries({
    source: 'deviceBackupSource',
    localCreate: 'localBackupCreate', localDrafts: 'localBackupDraftReader',
    localSettings: 'localBackupSettings', localTarget: 'localBackupTarget',
    localMode: 'localBackupMode', localRules: 'localBackupRules',
    localSchedule: 'localBackupSchedule', localPreview: 'localBackupPreview',
    localSnapshot: 'localBackupSnapshot', localFirstFile: 'localBackupFirstFile',
    localCommonBatch: 'localBackupCommonBatch', localDelta: 'localBackupDelta',
    localEvidence: 'localBackupEvidence', localEvidenceSummary: 'localBackupEvidenceSummary',
    localEvidencePreflight: 'localBackupEvidencePreflight', localRemove: 'localBackupRemove',
  })) {
    const pattern = new RegExp('\\b' + key + ':\\s*' + value + '\\b')
    assert.match(desktop, pattern, 'missing real owning Agent port ' + key)
  }
  assert.equal(outlet.includes('window.xdriveDesktop'), false)
})
