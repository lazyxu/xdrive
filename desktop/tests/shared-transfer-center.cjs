const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'TransferCenter.tsx')
const sharedModel = read('ui', 'shared', 'src', 'transfers.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')
const webApi = read('web', 'src', 'api.ts')
const webStore = read('web', 'src', 'transfers.ts')

test('shared transfer center exposes detailed progress and history fields', () => {
  for (const token of [
    'XDriveTransferCenter',
    'LinearProgress',
    '当前大小',
    '总大小',
    '百分比',
    '状态',
    '开始时间',
    '已耗时',
    '预计剩余',
    '完成时间',
    '当前速度',
    '平均速度',
    '进行中',
    '已完成',
    '失败',
  ]) {
    assert.ok(shared.includes(token), `shared transfer center missing: ${token}`)
  }
  assert.ok(sharedModel.includes('xDriveTransferEtaMs'), 'shared transfer model must calculate ETA')
  assert.ok(sharedModel.includes("direction: 'upload' | 'download' | 'local' | string"), 'shared transfer direction contract is missing')
})

test('Web and Desktop both render the shared transfer center', () => {
  assert.equal((desktop.match(/<XDriveTransferCenter\b/g) || []).length, 1, 'Desktop must render the shared transfer center')
  assert.equal((web.match(/<XDriveTransferCenter\b/g) || []).length, 1, 'Web must render the shared transfer center')
  assert.ok(web.includes('primary="传输"'), 'Web sidebar must expose Transfers')
  assert.ok(desktop.includes('primary="传输"'), 'Desktop sidebar must keep Transfers')
})

test('Web upload and download operations feed persistent transfer history', () => {
  assert.ok(webApi.includes('webTransferStore.create'), 'Web API must create transfer records')
  assert.ok(webApi.includes("kind: 'upload'"), 'Web upload must be tracked')
  assert.ok(webApi.includes("kind: 'download'"), 'Web download must be tracked')
  assert.ok(webApi.includes('response.body.getReader()'), 'Web download must stream bytes for progress reporting')
  assert.ok(webApi.includes('webTransferStore.progress'), 'Web API must publish byte progress')
  assert.ok(webApi.includes('webTransferStore.complete'), 'Web API must persist completed transfers')
  assert.ok(webApi.includes('webTransferStore.fail'), 'Web API must persist failed transfers')
  assert.ok(webStore.includes("xdrive.web.transfer_history"), 'Web transfer history must survive navigation/reload')
  assert.ok(webStore.includes('MAX_HISTORY = 200'), 'Web transfer history must be bounded')
  assert.ok(webStore.includes('页面刷新后无法继续跟踪该传输'), 'stale active Web transfers must fail closed after reload')
})
