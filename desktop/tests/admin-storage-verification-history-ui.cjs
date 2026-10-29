const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const compiled = ts.transpileModule(read('ui/shared/src/storage-verification-history.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exported = {}
new Function('exports', compiled)(exported)
const norm = exported.xDriveNormalizeStorageVerificationHistory
const append = exported.xDriveAppendStorageVerificationHistory
const t = '2026-10-28T10:00:00Z'
const f = '2026-10-28T10:30:00Z'
const row = id => ({ run_id: id, mode: 'deep', state: 'success', started_at: t, finished_at: f })
const page = (items, next_cursor) => ({
  protocol: 'xdrive-storage-verification-history-v1', items,
  ...(next_cursor ? { next_cursor } : {}),
})

test('real uint64 IDs survive pagination without IEEE754 precision loss', () => {
  const big = page([row('18446744073709551615'),row('9007199254740993')],'9007199254740993')
  assert.deepEqual(norm(big), big)
  const next=page([row('9007199254740992')])
  assert.deepEqual(append(big,next).items.map(x=>x.run_id),
    ['18446744073709551615','9007199254740993','9007199254740992'])
})

test('unknown status, duplicate/out-of-order IDs, wrong cursor and private fields fail closed', () => {
  for (const v of [
    page([row('1'),row('2')]),
    page([row('2'),row('2')]),
    page([{...row('2'),state:'running'}]),
    page([{...row('2'),mode:'opaque'}]),
    page([row('02')]),
    page([row('18446744073709551616')]),
    page([row('2')],'1'),
    page([{...row('2'),finished_at:'invalid'}]),
  ]) assert.equal(norm(v), null)
  const leaked = norm(page([{ ...row('2'), private_host_path: '/root/private' }]))
  assert.deepEqual(leaked.items[0], row('2'))
  assert.equal(JSON.stringify(leaked).includes('/root/private'), false)
  const first=page([row('10'),row('9')],'9')
  assert.equal(append(first,page([row('9')])),null)
})

test('shared UI fences old Host responses and uses one authenticated read-only port', () => {
  const ui=read('ui/shared/src/mui/StorageVerificationHistoryPanel.tsx')
  const globals=read('ui/shared/src/mui/GlobalStorageStatsPage.tsx')
  assert.match(ui,/snapshot\?\.api === api/)
  assert.match(ui,/ticket !== generation\.current/)
  assert.match(ui,/xDriveNormalizeStorageVerificationHistory\(raw\)/)
  assert.match(ui,/xDriveAppendStorageVerificationHistory\(page, next\)/)
  assert.match(ui,/data-xdrive-admin-storage-verification-history/)
  assert.match(ui,/adminStorageVerificationRuns\(pageLimit, expected\)/)
  assert.match(globals, /scope === 'global' && \(\s*<XDriveStorageVerificationHistoryPanel api=\{api\}/)
  assert.doesNotMatch(ui,/action: 'restore'|rm -rf/)
})
