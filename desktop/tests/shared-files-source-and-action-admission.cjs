'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function realModule(relative, dependencies = {}) {
  const source = read(relative)
  const compiled = ts.transpileModule(source, {
    fileName: relative, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const module = { exports: {} }
  new Function('module','exports','require', compiled.outputText)(module,module.exports,name => {
    assert.ok(Object.hasOwn(dependencies,name), 'unexpected business code import: '+name)
    return dependencies[name]
  })
  return module.exports
}
const core = realModule('ui/shared/src/file-explorer-controller.ts')
const admission = realModule('ui/shared/src/file-explorer-selection-admission.ts', {
  './file-explorer-controller': core,
})
const search = realModule('ui/shared/src/file-explorer-search.ts')

test('both Host sources project only allowed id/name fields, without passwords or native roots', () => {
  const input = [{id: 13, name:'Home NAS', password:'PRIVATE', cookie:'SECRET',
    local_path:'/private/secret', root_fingerprint:'hash'},
  {id:17,name:'Photo Files', credential:'NO'}]
  assert.deepEqual(search.xDriveFileExplorerProjectSearchSources(input), [
    {id:13,name:'Home NAS'}, {id:17,name:'Photo Files'},
  ])
  assert.equal(search.xDriveFileExplorerProjectSearchSources([]).length,0)
})

test('one real shared selection ticket deduplicates logical IDs and evaluates exactly once', () => {
  const seen = []
  const selected = [{id: 42},{id:'42'},{id: 47}]
  const ticket = admission.xDriveFileExplorerSelectionRequest('copy', selected, (action, rows, count) => {
    seen.push([action,rows,count])
    return count === 2 ? null : 'Invalid selection'
  })
  assert.deepEqual(ticket, { allowed:true, reason:null, selectedCount:2 })
  assert.equal(seen.length,1)
  assert.strictEqual(seen[0][1],selected)
  const reject = admission.xDriveFileExplorerSelectionRequest('delete', selected,
    (_action, _rows, count) => count === 2 ? 'Owner revision stale' : null)
  assert.deepEqual(reject, { allowed:false, reason:'Owner revision stale', selectedCount:2 })
  assert.deepEqual(admission.xDriveFileExplorerSelectionRequest('download', [],
    (_a,_s,count) => count===0?'empty':null),
  {allowed:false,reason:'empty',selectedCount:0})
})

test('Host-neutral ticket obeys the actual revision and 200/500-item protections', () => {
  const nodes = new Map([[42, { id:42, revision:3 }]])
  const selected = [{ id:42 }]
  const current = (action, selection, count) => admission.xDriveFileExplorerSelectionAdmissionReason({
    action,selected:selection,selectedCount:count,nodeByID:nodes,
  })
  assert.equal(admission.xDriveFileExplorerSelectionRequest('copy',selected,current).allowed,true)
  assert.equal(admission.xDriveFileExplorerSelectionRequest('copy',[{id:99}],current).allowed,false)
  assert.match(admission.xDriveFileExplorerSelectionRequest('delete',Array.from({length:201},(_,i)=>({id:i+1})),current).reason,/200/)
  assert.match(admission.xDriveFileExplorerSelectionRequest('manage-tags',Array.from({length:501},(_,i)=>({id:i+1})),current).reason,/500/)
})

test('actual Desktop and Web controllers both call the shared ticket and source projection', () => {
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  for(const source of [desktop,web]){
    assert.match(source,/xDriveFileExplorerSelectionRequest\(action, selected, getSelectionActionDisabledReason\)/)
    assert.match(source,/xDriveFileExplorerProjectSearchSources\(/)
    assert.doesNotMatch(source,/new Set\(selected\.map\(\(item\) => Number\(item\.id\)\)\)\.size/)
  }
  assert.match(desktop,/hostPort\.browse\.getSources\(\)/)
  assert.match(desktop,/archiveDownloadSupported/)
  assert.match(desktop,/folderTreeDownloadSupported/)
  assert.match(web,/api\.sources\(\)/)
  assert.doesNotMatch(read('ui/shared/src/file-explorer-search.ts'),/window\.xdriveDesktop|backup\.cgi/)
  assert.doesNotMatch(read('ui/shared/src/file-explorer-selection-admission.ts'),/window\.|ipcRenderer|fetch\s*\(/)
})
