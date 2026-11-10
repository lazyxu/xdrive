'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const portSource = read('web/src/clipboardDataPort.ts')
const ui = read('ui/shared/src/mui/ClipboardPage.tsx')

test('Web Clipboard imports user-chosen local file via current Owner Files UploadSession/CAS writer', async () => {
  const compiled = ts.transpileModule(portSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports,
    name => {
      if (name === './browserClipboard') return { xDriveBrowserCopyText: async () => {} }
      throw Error('unexpected Clipboard module ' + name)
    },
  )
  const calls = []
  const api = {
    root: async () => { calls.push('root'); return { id: 7, type: 'dir' } },
    uploadWithConflictPolicy: async (parent, file, policy) => {
      calls.push('upload')
      assert.equal(parent, 7)
      assert.equal(policy, 'fail')
      assert.ok(file.name)
      assert.ok(file.size > 0)
      return { node: { id: 118, parent_id: 7, type: 'file', revision: 1 }, skipped: false }
    },
  }
  const port = mod.exports.createXDriveWebClipboardPort(api, 'https://drive.example:7')
  const signal = new AbortController().signal
  const result = await port.uploadLocalFile(new File([Uint8Array.of(1,2,3)], 'report.txt'), signal)
  assert.deepEqual(result, { node_id: 118 })
  assert.deepEqual(calls, ['root','upload'])
  assert.doesNotMatch(portSource, /fetch\([^\n]*\/api\/v1\/uploads/)
})

test('Clipboard image import requires explicit browser gesture and completes file only, never posts a message', () => {
  assert.match(portSource, /const reading = navigator\.clipboard\.read\(\)/)
  const firstRead = portSource.indexOf('const reading = navigator.clipboard.read()')
  const ownerRead = portSource.indexOf('const root = await api.root(signal)')
  assert.ok(firstRead >= 0 && ownerRead >= 0)
  assert.match(portSource, /items\.find\(item => item\.types\.includes\('image\/png'\)\)/)
  assert.match(portSource, /png\.getType\('image\/png'\)/)
  assert.match(portSource, /file\.size > 64 \* 1024 \* 1024/)
  assert.match(ui, /importToOwnerFiles\(signal => port\.importImageFromClipboard!\(signal\)\)/)
  assert.match(ui, /请检查文件，然后明确点击“加密发送”/)
  assert.match(ui, /if \(pending\.current\) \{/)
  assert.doesNotMatch(portSource, /api\.clipboardCreate\(.*file/)
})

test('user-gesture PNG clipboard import precedes Owner root and canonical CAS upload', async () => {
  const compiled = ts.transpileModule(portSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const mod = { exports: {} }
  new Function('module','exports','require',compiled.outputText)(
    mod,mod.exports, name => {
      if (name === './browserClipboard') return { xDriveBrowserCopyText: async()=>{} }
      throw Error('unexpected module ' + name)
    },
  )
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis,'window')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis,'navigator')
  const calls = []
  try {
    Object.defineProperty(globalThis,'window',{
      value: { isSecureContext: true }, configurable: true,
    })
    Object.defineProperty(globalThis,'navigator',{
      value: { clipboard: { read: () => {
        calls.push('user-gesture clipboard.read')
        return Promise.resolve([{
          types: ['image/png'],
          getType: async type => {
            calls.push('clipboard.getType')
            assert.equal(type,'image/png')
            return new Blob([Uint8Array.of(0x89,0x50,0x4e,0x47)], {type:'image/png'})
          },
        }])
      } } }, configurable: true,
    })
    const api = {
      root: async()=>{ calls.push('Owner root'); return {id:45,type:'dir'} },
      uploadWithConflictPolicy: async(parent,file,policy)=>{
        calls.push('existing UploadSession/CAS')
        assert.equal(parent,45)
        assert.equal(policy,'fail')
        assert.match(file.name,/^Clipboard-[0-9a-f-]+\.png$/)
        assert.equal(file.type,'image/png')
        return { node:{id:92,parent_id:45,type:'file',revision:1},skipped:false }
      },
    }
    const port=mod.exports.createXDriveWebClipboardPort(api,'https://drive.example:7')
    assert.deepEqual(await port.importImageFromClipboard(new AbortController().signal),{node_id:92})
    assert.deepEqual(calls,['user-gesture clipboard.read','clipboard.getType','Owner root',
      'existing UploadSession/CAS'])
  } finally {
    for (const [name, before] of [['window',originalWindow],['navigator',originalNavigator]]) {
      if (before) Object.defineProperty(globalThis,name,before)
      else delete globalThis[name]
    }
  }
})

test('permission denial and missing PNG never issue a Server upload', async () => {
  const compiled=ts.transpileModule(portSource,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  const mod={exports:{}}
  new Function('module','exports','require',compiled.outputText)(
    mod,mod.exports,name => {
      if(name==='./browserClipboard') return {xDriveBrowserCopyText:async()=>{}}
      throw Error('unexpected module '+name)
    },
  )
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window')
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  let networkCalls=0
  const api={
    root: async()=>{networkCalls++;return{id:1,type:'dir'}},
    uploadWithConflictPolicy:async()=>{networkCalls++;throw Error('must not upload')},
  }
  try {
    Object.defineProperty(globalThis,'window',{
      value:{isSecureContext:true},configurable:true,
    })
    Object.defineProperty(globalThis,'navigator',{
      value:{clipboard:{read:async()=>[{types:['text/plain']}]}},configurable:true,
    })
    const port=mod.exports.createXDriveWebClipboardPort(api,'https://drive.example:7')
    await assert.rejects(port.importImageFromClipboard(new AbortController().signal),/没有可读取的 PNG/)
    Object.defineProperty(globalThis,'navigator',{
      value:{clipboard:{read:async()=>{throw Error('NotAllowedError')}}},configurable:true,
    })
    await assert.rejects(port.importImageFromClipboard(new AbortController().signal),/NotAllowedError/)
    assert.equal(networkCalls,0,'never send Owner or upload requests on clipboard read failure')
  } finally {
    for (const [name,before] of [['window',originalWindow],['navigator',originalNavigator]]) {
      if(before) Object.defineProperty(globalThis,name,before)
      else delete globalThis[name]
    }
  }
})

test('aborted Owner session prevents Browser file upload and never creates a Clipboard item', async () => {
  const compiled = ts.transpileModule(portSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, name => {
      if (name === './browserClipboard') return { xDriveBrowserCopyText: async () => {} }
      throw Error('unexpected dependency ' + name)
    },
  )
  let rootCalls = 0
  let uploadCalls = 0
  const controller = new AbortController()
  const api = {
    root: async () => { rootCalls++; controller.abort(); return {id: 8,type:'dir'} },
    uploadWithConflictPolicy: async () => { uploadCalls++; throw Error('must not upload after revocation') },
  }
  const port = module.exports.createXDriveWebClipboardPort(api, 'https://drive.example:owner')
  await assert.rejects(
    port.uploadLocalFile(new File([Uint8Array.of(1)], 'cancelled.txt'),controller.signal),
    error => error.name === 'AbortError',
  )
  assert.equal(rootCalls,1)
  assert.equal(uploadCalls,0)
})

test('rejected CAS receipts never become device-directed file references', async () => {
  const compiled=ts.transpileModule(portSource,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  const module={exports:{}}
  new Function('module','exports','require',compiled.outputText)(
    module,module.exports,name=>{
      if(name==='./browserClipboard') return {xDriveBrowserCopyText:async()=>{}}
      throw Error('unexpected dependency '+name)
    },
  )
  const api={
    root:async()=>({id:23,type:'dir'}),
    uploadWithConflictPolicy:async()=>({
      node:{id:77,parent_id:999,type:'file',revision:1},skipped:false,
    }),
  }
  const port=module.exports.createXDriveWebClipboardPort(api,'https://drive.example:owner')
  await assert.rejects(
    port.uploadLocalFile(new File([Uint8Array.of(1)], 'foreign.txt'), new AbortController().signal),
    /未收到可用于 Clipboard 的有效节点收据/,
  )
  api.uploadWithConflictPolicy=async()=>({
    node:{id:78,parent_id:23,type:'file',revision:1},skipped:true,
  })
  await assert.rejects(
    port.uploadLocalFile(new File([Uint8Array.of(2)], 'conflict.txt'),new AbortController().signal),
    /未收到可用于 Clipboard 的有效节点收据/,
  )
})

test('Clipboard import passes its retired Owner signal into the real CAS writer', () => {
  const source=read('web/src/api.ts')
  assert.ok(source.includes('externalSignal?: AbortSignal'))
  assert.ok(source.includes("externalSignal.addEventListener('abort', abortFromCaller"))
  assert.ok(source.includes('webTransferStore.cancel(activeTransferID)'))
  assert.ok(source.includes("externalSignal?.removeEventListener('abort', abortFromCaller"))
  assert.ok(portSource.includes("root.id, file, 'fail', undefined, '', '', '', signal"))
})
