import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root=resolve(fileURLToPath(new URL('../',import.meta.url)),'..')
const read=p=>readFileSync(resolve(root,p),'utf8')
const page=read('ui/shared/src/mui/ClipboardPage.tsx')
const api=read('web/src/api.ts')
const port=read('web/src/clipboardDataPort.ts')
const dsmAdapter=read('ui/shared/src/synology-backup-adapter.ts')
const code=ts.transpileModule(page,{fileName:'ClipboardPage.tsx',reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}})
assert.deepEqual((code.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
assert.match(page,/xDriveClipboardValidateText\(textAtStart\)/)
assert.match(page,/new TextEncoder\(\)\.encode\(text\)\.length/)
assert.match(page,/size > 65536/)
assert.match(page,/client_event_id, kind: expectedKind, content: textAtStart/)
assert.match(page,/await port\.create\(pending\.current\.item, controller\.signal\)/)
assert.match(page,/pending\.current\.item/)
assert.match(page,/ownerScopeKey/)
assert.match(page,/setItems\(previous => before/)
assert.match(page,/setMonitorEnabled\(false\)/)
assert.match(page,/剪贴板内容不会端到端加密/)
assert.doesNotMatch(page,/解锁加密剪贴板|剪贴板口令|PBKDF2|EncryptForDevice|deriveKey|xDriveClipboardEncrypt/)
assert.match(port,/create: \(item, signal\) => api\.clipboardCreate\(item, signal\)/)

const activeDSMClipboardOperations = ['capability', 'list', 'next-event', 'devices', 'file',
  'create', 'enable-device', 'revoke-device', 'delete', 'clear']
for (const operation of activeDSMClipboardOperations) {
  assert.match(dsmAdapter, new RegExp(`['"]cloud-clipboard-${operation}['"]`))
}
// The Server and DSM CGI have removed these old encryption routes; the
// browser's same-origin operation whitelist must reject them as well.
assert.doesNotMatch(dsmAdapter, /['"]cloud-clipboard-(?:vault|check|decrypt)['"]/)

assert.match(api,/clipboardCreate\(item: \{/)
assert.match(api,/content: string/)
const fence='ui/shared/src/clipboard-action-fence.ts'
const built=ts.transpileModule(read(fence),{fileName:fence,reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
assert.deepEqual((built.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
const {XDriveClipboardActionFence}=await import('data:text/javascript;base64,'+
  Buffer.from(built.outputText).toString('base64'))
const guard=new XDriveClipboardActionFence()
const token=guard.capture()
guard.invalidate()
assert.equal(guard.isCurrent(token),false)
assert.equal(guard.isCurrent(guard.capture()),true)
console.log('Plaintext Web Clipboard owner, retry, 64 KiB and stale-action contracts passed')
