'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
function transpile(source, fileName) {
  const compiled = ts.transpileModule(source, {
    fileName, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((compiled.diagnostics ?? [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return compiled.outputText
}
function loadModule(file, dependencies = {}) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', transpile(read(file), file))(
    mod, mod.exports, name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw Error('unexpected shared policy dependency: ' + name)
    })
  return mod.exports
}
const core = loadModule('ui/shared/src/file-explorer-controller.ts')
const policy = loadModule('ui/shared/src/file-explorer-selection-admission.ts', {
  './file-explorer-controller': core,
})
function actualReason(file, dependencies) {
  const content = read(file)
  const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const matches = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) &&
        node.name.getText(ast) === 'getSelectionActionDisabledReason') {
      matches.push(node.initializer?.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, 'real current source must own one selection callback')
  assert.ok(matches[0])
  const output = transpile('const selectionGuard = ' + matches[0] + ';',
    file + '.selection.ts')
  return new Function(...Object.keys(dependencies), output + '\nreturn selectionGuard')(
    ...Object.values(dependencies))
}
const baseNodes = new Map([[17, { id: 17, revision: 3, type: 'file', name: 'x.txt' }]])
const choose = [{ id: 17 }]
function desktop(options = {}) {
  return actualReason('desktop/src/renderer/DesktopFileExplorer.tsx', {
    xDriveFileExplorerSelectionAdmissionReason: policy.xDriveFileExplorerSelectionAdmissionReason,
    xDriveFileExplorerResolveSelectionNodes: core.xDriveFileExplorerResolveSelectionNodes,
    nodeByID: options.nodeByID ?? baseNodes,
    fileTagsSupported: options.tags !== false,
    archiveDownloadSupported: options.archive === true,
    folderTreeDownloadSupported: options.folder === true,
  })
}
function browser(options = {}) {
  return actualReason('web/src/WebFileExplorer.tsx', {
    xDriveFileExplorerSelectionAdmissionReason: policy.xDriveFileExplorerSelectionAdmissionReason,
    nodeByID: options.nodeByID ?? baseNodes,
  })
}

test('Web Wide/Compact and Desktop are identical for mutable Owner selection limits', () => {
  const native = desktop(), web = browser()
  for (const action of ['copy', 'cut', 'delete', 'move-to', 'copy-to']) {
    assert.equal(native(action, choose, 1), web(action, choose, 1), action)
    assert.match(native(action, choose, 201), /200 个项目/, action)
    assert.equal(native(action, choose, 201), web(action, choose, 201), action)
    assert.match(native(action, [{ id: 77 }], 1), /尚未完整加载/, action)
  }
  assert.equal(native('copy', [{ id: 17 }], 1), null, 'valid mutable selection remains authorized')
})

test('missing revisions and sparse virtual selection cannot authorize mutations', () => {
  const notVersioned = new Map([[17, { id: 17, type: 'file' }]])
  const native = desktop({ nodeByID: notVersioned })
  const web = browser({ nodeByID: notVersioned })
  assert.match(native('delete', choose, 1), /版本信息不可用/)
  assert.equal(native('delete', choose, 1), web('delete', choose, 1))
  assert.match(native('copy', choose, 10000), /200 个项目/)
  assert.match(native('copy', [{ id: 17 }, { id: 17 }], 2), /尚未完整加载/)
})

test('tags share 500-item cap but native Agent support is still required', () => {
  const native = desktop({ tags: false })
  const web = browser()
  assert.match(native('manage-tags', choose, 501), /500 个项目/)
  assert.equal(native('manage-tags', choose, 501), web('manage-tags', choose, 501))
  assert.match(native('manage-tags', choose, 1), /当前客户端不支持标签/)
  assert.equal(desktop()('manage-tags', choose, 1), null)
})

test('Desktop keeps its native download archive/folder capabilities after common admission', () => {
  const folder = new Map([[17, { id: 17, revision: 3, type: 'dir', name: 'Folder' }]])
  const native = desktop({ nodeByID: folder })
  assert.match(native('download', choose, 1), /不支持下载所选文件夹/)
  assert.equal(desktop({ nodeByID: folder, folder: true })('download', choose, 1), null)
  assert.equal(desktop({ nodeByID: folder, archive: true })('download', choose, 1), null)
  const items = Array.from({ length: 1001 }, (_, i) => ({
    id: i + 1, revision: 2, type: 'file', name: 'f' + i,
  }))
  const selected = items.map(x => ({ id: x.id }))
  const manyNodes = new Map(items.map(x => [x.id, x]))
  assert.match(desktop({ nodeByID: manyNodes })('download', selected, selected.length), /1000 个文件/)
  assert.match(desktop({ nodeByID: manyNodes, archive: true })('download', selected, selected.length), /1000 个项目/)
  assert.match(browser({ nodeByID: manyNodes })('download', selected, selected.length), /1000 个项目/)
})

test('Desktop native opener/writer and Web transport stay on their authentic Host ports', () => {
  const renderer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  const publicApi = read('ui/shared/src/index.ts')
  const policySource = read('ui/shared/src/file-explorer-selection-admission.ts')
  assert.match(publicApi, /export \* from '\.\/file-explorer-selection-admission'/)
  assert.match(renderer, /xDriveFileExplorerSelectionAdmissionReason\(\{/)
  assert.match(web, /xDriveFileExplorerSelectionAdmissionReason\(\{/)
  assert.match(renderer, /hostPort\.write\.cloudDownload\(/)
  assert.match(renderer, /hostPort\.native/)
  assert.match(renderer, /archiveDownloadSupported/)
  assert.match(renderer, /folderTreeDownloadSupported/)
  assert.doesNotMatch(policySource, /window\.|ipcRenderer|fetch\s*\(/)
})
