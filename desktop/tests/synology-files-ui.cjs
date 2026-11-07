const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const sourceCreate = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerCreateDialog.tsx'), 'utf8')
const sourceSettings = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManagerSettingsDialog.tsx'), 'utf8')
const sourceModule = sourceManager + sourceCreate + sourceSettings
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'App.tsx'), 'utf8') + sourceModule
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + sourceModule
const sharedFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceConnectorConfigFields.tsx'), 'utf8')

test('Synology File Station remains a history-only connector, not a new Pull preset', () => {
  assert.match(shared, /SupportedExternalSourceKind = 'synology_photos' \| 'synology_files' \| 'yike_photos'/)
  assert.match(shared, /if \(kind === 'synology_files'\) return 'synology_files_pull'/)
  const options = shared.slice(
    shared.indexOf('export const externalSourceCreateOptions:'),
    shared.indexOf('export const synologyPhotoSpaceOptions:'),
  )
  assert.ok(options.length > 0)
  assert.match(options, /value: 'yike_pull'/)
  assert.match(options, /value: 'local_push'/)
  assert.doesNotMatch(options, /value: 'synology_(files|photos)_pull'/)
  assert.match(shared, /isSynologyPullTemporarilyDisabled/)
})

test('File Station roots are validated separately from Photos spaces', () => {
  assert.match(shared, /function normalizeSynologyFileRoots/)
  assert.match(shared, /function synologyFileRootsValidationError/)
  assert.match(shared, /不能选择整个 NAS 根目录/)
  assert.match(web, /option\.kind === 'synology_files'[\s\S]*synologyFileRootsValidationError/)
  assert.match(sourceManager, /option\.kind === 'synology_files'[\s\S]*synologyFileRootsValidationError/)
})

test('Web and Desktop persist roots and explicitly activate File Station sources', () => {
  assert.match(web, /option\.kind === 'synology_files'[\s\S]*\{ roots \}/)
  assert.match(web, /option\.kind === 'synology_files'[\s\S]*updateSource\(created\.id, created\.revision, \{ status: 'active' \}\)/)
  assert.match(sourceManager, /option\.kind === 'synology_files'[\s\S]*\{ roots \}/)
  assert.match(sourceManager, /option\.kind === 'synology_files'[\s\S]*updateSource\(created\.id, created\.revision, \{ status: 'active' \}\)/)
})

test('File Station forms explain arbitrary-file semantics', () => {
  assert.match(sharedFields, /File Station 根目录/)
  assert.match(sharedFields, /每行一个 DSM 绝对目录/)
  for (const source of [web, desktop]) {
    assert.match(source, /XDriveSynologyFileRootsField/)
    assert.match(source, /所有文件和文件夹/)
  }
})
