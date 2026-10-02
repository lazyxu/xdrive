const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer controller owns typed-path parsing and traversal rules', () => {
  for (const token of [
    'xDriveFileExplorerPathParts',
    'xDriveResolveFileExplorerPath',
    "replace(/\\\\/g, '/')",
    ".split('/')",
    '.map((part) => part.trim())',
    '.filter(Boolean)',
    "parts[0] === rootName || parts[0] === '我的文件'",
    "node.type === 'dir' && node.name === part",
    '找不到文件夹：',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer controller missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './file-explorer-controller'"), 'shared FileExplorer controller must be exported')
})

test('Web and Desktop delegate typed-path resolution while keeping transport adapters local', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/xDriveResolveFileExplorerPath\(/g) || []).length, 1, `${label} must use shared typed-path resolution`)
    assert.equal(source.includes(".split('/')"), false, `${label} must not duplicate typed-path splitting`)
    assert.equal(source.includes("parts[0] === rootName"), false, `${label} must not duplicate root-prefix handling`)
    assert.equal(source.includes('找不到文件夹：'), false, `${label} must not duplicate missing-folder semantics`)
  }
  assert.ok(web.includes('listChildren: (parentID) => api.list(parentID)'), 'Web must keep REST directory loading local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildren(parentID)'), 'Desktop must keep Agent directory loading local')
})
