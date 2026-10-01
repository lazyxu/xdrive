const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const shared = fs.readFileSync(
  path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceConnectorConfigFields.tsx'),
  'utf8',
)
const sourceManager = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8')
const web = fs.readFileSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx'), 'utf8') + sourceManager
const webApi = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
const desktopAdapter = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')
const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8') + sourceManager + desktopAdapter
const preload = fs.readFileSync(path.join(repo, 'desktop', 'src', 'preload', 'index.cts'), 'utf8')

test('shared File Station roots field keeps manual input and adds directory browser', () => {
  assert.match(shared, /export function XDriveSynologyFileRootsField/)
  assert.match(shared, /browse\?: ExternalSourceDirectoryBrowser/)
  assert.match(shared, /浏览群晖目录/)
  assert.match(shared, /选择 File Station 根目录/)
  assert.match(shared, /browseNextOffset/)
  assert.match(shared, /加载更多/)
  assert.match(shared, /使用所选目录/)
  assert.match(shared, /value\.join\('\\n'\)/)
})

test('Web browses existing File Station sources through the Server API', () => {
  assert.match(webApi, /sourceBrowseDirectories\(sourceID: number/)
  assert.match(sourceManager, /adapter\.sourceBrowseDirectories\(setting\.source\.id, path, limit, offset\)/)
  assert.match(web, /setting\.credential\?\.configured/)
  assert.equal((sourceManager.match(/sourceBrowseDirectories\(/g) || []).length >= 1, true)
})

test('Desktop browses existing File Station sources through Agent IPC', () => {
  assert.match(preload, /agent:browse-source-directories/)
  assert.match(desktop, /window\.xdriveDesktop\.agent\.browseSourceDirectories/)
  assert.match(sourceManager, /setting\.credential\?\.configured/)
  assert.equal((desktopAdapter.match(/browseSourceDirectories\(/g) || []).length, 1)
})
