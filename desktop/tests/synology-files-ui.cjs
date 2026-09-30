const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8')
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')

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
  assert.match(desktop, /sourceCreateKind === 'synology_files'[\s\S]*synologyFileRootsValidationError/)
})

test('Web and Desktop persist roots and explicitly activate File Station sources', () => {
  assert.match(web, /option\.kind === 'synology_files'[\s\S]*\{ roots \}/)
  assert.match(web, /option\.kind === 'synology_files'[\s\S]*updateSource\(created\.id, created\.revision, \{ status: 'active' \}\)/)
  assert.match(desktop, /sourceCreateKind === 'synology_files'[\s\S]*\{ roots \}/)
  assert.match(desktop, /sourceCreateKind === 'synology_files'[\s\S]*updateSource\(created\.data\.id, created\.data\.revision, \{ status: 'active' \}\)/)
})

test('File Station forms explain arbitrary-file semantics', () => {
  for (const source of [web, desktop]) {
    assert.match(source, /File Station 根目录/)
    assert.match(source, /所有文件和文件夹/)
  }
})
