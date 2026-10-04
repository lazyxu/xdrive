const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'App.tsx'), 'utf8') + sourceManager
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + sourceManager
const sharedFields = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceConnectorConfigFields.tsx'), 'utf8')

test('Synology File Station is a distinct generic Pull preset', () => {
  assert.match(shared, /SupportedExternalSourceKind = 'synology_photos' \| 'synology_files' \| 'yike_photos'/)
  assert.match(shared, /value: 'synology_files_pull'/)
  assert.match(shared, /kind: 'synology_files'/)
  assert.match(shared, /label: '群晖 File Station · Pull'/)
  assert.match(shared, /同步选定目录中的任意文件和文件夹/)
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
