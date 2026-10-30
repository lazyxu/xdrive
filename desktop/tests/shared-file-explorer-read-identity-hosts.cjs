'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
function compile(text, fileName) {
  const result = ts.transpileModule(text, {
    fileName, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((result.diagnostics || [])
    .filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\\n')), [])
  return result.outputText
}
const mod = { exports: {} }
new Function('module', 'exports', compile(
  read('ui/shared/src/file-explorer-read-identity.ts'), 'file-explorer-read-identity.ts',
))(mod, mod.exports)
const readNodeID = mod.exports.xDriveFileExplorerReadNodeID
const canonicalReadNodeID = mod.exports.xDriveFileExplorerCanonicalReadNodeID
const thumbnailRequest = mod.exports.xDriveFileExplorerThumbnailRequest

function actualCallback(file, name, injected) {
  const source = read(file)
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const matches = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) {
      matches.push(node.initializer?.getText(parsed))
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(matches.length, 1, 'one production callback '+name+' in '+file)
  const code = compile('const action = ' + matches[0] + ';', file+'.callback.ts')
  return new Function(...Object.keys(injected), code + '\nreturn action')(...Object.values(injected))
}
function load(name, host) {
  const file = (host === 'desktop' ? 'desktop/src/renderer/DesktopFileExplorer.tsx'
    : 'web/src/WebFileExplorer.tsx')
  return { file, action: actualCallback(file,name,{
    useCallback: fn => fn, xDriveFileExplorerReadNodeID: readNodeID,
    textPreviewSupported: true, mediaPropertiesSupported: true,
    nextDesktopFilePropertiesRequestID: () => 'read-a',
    hostPort: { requestViewport: async (_signal, callback) =>
      callback('read-a'), media: {
      cloudTextPreview: async id => ({ok:true,data:'text#'+id}),
      getMediaItem: async id => ({ok:true,data:{id}}),
      cancelMediaItem: () => {},
    }},
    api: { fileTextPreview: async id => 'text#'+id, mediaItem: async id => ({id}) },
  }) }
}
const file = { id: 12, kind:'file', revision: 7, name:'movie.mp4' }
const invalids = [
  { ...file, id:0 }, { ...file, id:-1 }, { ...file, id:Number.MAX_SAFE_INTEGER+1 },
  { ...file, id:'bogus' }, { ...file, id:1.5 }, { ...file, kind:'dir' },
  { ...file, id:'' }, { ...file, id:' 12 ' }, { ...file, id:'012' },
  { ...file, id:'0xC' }, { ...file, id:'1.2e1' }, { ...file, id:'+12' },
  { ...file, id:'12.0' }, { ...file, id:'12\n' }, { ...file, id:'0' },
]
test('shared read projection retains legitimate numeric and numeric-string IDs, blocks invalid rows', () => {
  assert.equal(readNodeID(file),12)
  assert.equal(readNodeID({...file,id:'12'}),12)
  assert.equal(readNodeID(file,false),null)
  for (const item of invalids) assert.equal(readNodeID(item),null,JSON.stringify(item))
})
test('Web and Desktop text preview reject invalid/aborted selections before Host IO', async () => {
  for (const host of ['web','desktop']) {
    const {action}=load('loadTextPreview',host)
    assert.equal(await action(file), 'text#12')
    assert.equal(await action({...file,id:'12'}),'text#12')
    const cancelled = new AbortController(); cancelled.abort()
    assert.equal(await action(file,cancelled.signal),null,host)
    for(const item of invalids) assert.equal(await action(item),null,host+' '+JSON.stringify(item))
  }
})
test('Web and Desktop media info use the same read-only admission, without native privilege', async () => {
  for (const host of ['web','desktop']) {
    const {action}=load('loadMediaItem',host)
    const active = new AbortController()
    assert.deepEqual(await action(file,active.signal),{id:12})
    const cancelled = new AbortController(); cancelled.abort()
    assert.equal(await action(file,cancelled.signal),null,host)
    for(const item of invalids) assert.equal(await action(item,active.signal),null,host+' '+JSON.stringify(item))
  }
})
test('real Host adapters and cancellation are not replaced with browser fallbacks', () => {
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  const publicAPI = read('ui/shared/src/index.ts')
  assert.match(publicAPI,/export \* from '\.\/file-explorer-read-identity'/)
  for(const source of [desktop,web]) {
    assert.match(source,/xDriveFileExplorerReadNodeID\(item,/)
  }
  assert.match(desktop,/hostPort\.requestViewport\(/)
  assert.match(desktop,/hostPort\.media\.getMediaItem\(nodeID, requestID\)/)
  assert.match(web,/api\.fileTextPreview\(nodeID, signal\)/)
  assert.match(web,/api\.mediaItem\(nodeID, signal\)/)
  assert.match(desktop,/archiveDownloadSupported/)
  assert.match(desktop,/folderTreeDownloadSupported/)
  assert.doesNotMatch(read('ui/shared/src/file-explorer-read-identity.ts'),
    /window\.|ipcRenderer|fetch\s*\(|credentials|mountPath/)
})


test('preview and thumbnail share canonical positive read IDs, not numeric aliases', () => {
  assert.equal(canonicalReadNodeID(12), 12)
  assert.equal(canonicalReadNodeID('12'), 12)
  assert.equal(canonicalReadNodeID('9007199254740991'), Number.MAX_SAFE_INTEGER)
  for (const alias of [
    '', ' ', ' 12 ', '012', '0xC', '1.2e1', '+12', '12.0', '12\n',
    0, 1.2, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '9007199254740992', null, undefined,
  ]) {
    assert.equal(canonicalReadNodeID(alias), null, String(alias))
    assert.equal(readNodeID({ ...file, id: alias }), null, String(alias))
    assert.equal(thumbnailRequest({ ...file, id: alias }), null, String(alias))
  }
})

test('optional thumbnail revision never imports an ambiguous cache identity', () => {
  assert.deepEqual(thumbnailRequest(file), { nodeID: 12, revision: 7 })
  assert.deepEqual(thumbnailRequest({ ...file, id: '12', revision: '7' }),
    { nodeID: 12, revision: 7 })
  for (const revision of [undefined, '', ' ', '07', '0x7', '+7', '7.0',
    '7e0', 0, -1, 7.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(thumbnailRequest({ ...file, revision }), { nodeID: 12 },
      'unverified optional revision must be omitted: ' + String(revision))
  }
  assert.equal(thumbnailRequest(file, false), null)
  assert.equal(thumbnailRequest({ ...file, kind: 'dir' }), null)
})
