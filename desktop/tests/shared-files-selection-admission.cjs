'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const code = file => fs.readFileSync(path.join(repo, file), 'utf8')
const sources = {
  core: 'ui/shared/src/file-explorer-controller.ts',
  policy: 'ui/shared/src/file-explorer-selection-admission.ts',
}
function load(file, dependencies = {}) {
  const result = ts.transpileModule(code(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((result.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\\n')), [])
  const module = { exports: {} }
  new Function('module','exports','require',result.outputText)(
    module,module.exports,name => {
      assert.ok(Object.hasOwn(dependencies,name), 'unexpected data port: ' + name)
      return dependencies[name]
    })
  return module.exports
}
const core = load(sources.core)
const policy = load(sources.policy, { './file-explorer-controller': core })
const reason = policy.xDriveFileExplorerSelectionAdmissionReason
const one = { id: 7, revision: 5 }
const nodes = new Map([[7,one]])
function admit(action, overrides = {}) {
  return reason({
    action, selected: [{ id: 7 }], selectedCount: 1, nodeByID: nodes,
    downloadMaxItems: 1000, ...overrides,
  })
}
test('all write intents require real immutable Node revision and 200-item bound', () => {
  for (const action of ['copy','cut','delete','move-to','copy-to']) {
    assert.equal(admit(action), null, action)
    assert.match(admit(action, { nodeByID: new Map([[7,{id:7}]]) }), /版本信息不可用/, action)
    assert.match(admit(action, { selectedCount: 201 }), /200 个项目/, action)
    assert.match(admit(action, { selectedCount: 200 }), /尚未完整加载/, action)
  }
})
test('tags and downloads retain distinct limits; read-only actions do not inherit write revision', () => {
  assert.match(admit('manage-tags', { selectedCount:501 }), /500 个项目/)
  assert.match(admit('download', { selectedCount:1001 }), /1000 个项目/)
  assert.equal(admit('download', { nodeByID:new Map([[7,{id:7}]]) }), null)
  assert.equal(admit('download', { downloadMaxItems: undefined }), null)
  assert.equal(admit('open', { nodeByID:new Map([[7,{id:7}]]) }), null)
})
test('missing or incorrect loaded Owner metadata never becomes authorized', () => {
  assert.match(admit('copy',{ selectedCount:0 }), /请先选择项目/)
  assert.match(admit('copy',{ nodeByID:new Map() }), /尚未完整加载/)
  assert.match(admit('copy',{ selected:[{id:8}] }), /尚未完整加载/)
  assert.match(admit('copy',{ selected:[{id:'bad'}] }), /尚未完整加载/)
  assert.match(admit('copy',{ selected:[{id:7},{id:7}],selectedCount:2 }),
    /尚未完整加载/)
})
test('Web Wide/Compact use one policy; native Desktop extended limits remain Host-owned', () => {
  const web = code('web/src/WebFileExplorer.tsx')
  const desktop = code('desktop/src/renderer/DesktopFileExplorer.tsx')
  assert.match(web, /xDriveFileExplorerSelectionAdmissionReason\(\{/)
  assert.match(web, /downloadMaxItems: 1000/)
  assert.doesNotMatch(web, /const mutation = \['copy', 'cut', 'delete'/)
  assert.match(desktop, /archiveDownloadSupported/)
  assert.match(desktop, /folderTreeDownloadSupported/)
  assert.match(desktop, /xDriveFileExplorerSelectionAdmissionReason\(/)
  assert.doesNotMatch(code(sources.policy), /window\.|ipcRenderer|fetch\s*\(/)
})
