const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const panel = fs.readFileSync(path.join(repo, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')
const api = fs.readFileSync(path.join(repo, 'web', 'src', 'api.ts'), 'utf8')
const docs = fs.readFileSync(path.join(repo, 'docs', 'storage-inventory.md'), 'utf8')

test('global storage history exposes 30 90 180 day windows', () => {
  assert.ok(panel.includes("type StorageHistoryDays = 30 | 90 | 180"))
  assert.ok(panel.includes('useState<StorageHistoryDays>(30)'))
  for (const value of [30, 90, 180]) {
    assert.ok(panel.includes(`<ToggleButton value={${value}}>${value} 天</ToggleButton>`))
  }
  assert.ok(panel.includes('aria-label="存储历史窗口"'))
  assert.ok(api.includes('adminStorageHistory(days = 30)'))
  assert.ok(docs.includes('30 / 90 / 180'))
})

test('changing storage history window reloads history only', () => {
  assert.ok(panel.includes('api.adminStorageHistory(historyDays)'))
  assert.ok(panel.includes('}, [api, historyDays, reloadKey, scope])'))
  const mainStart = panel.indexOf("const request = scope === 'global' ? api.adminStorageStats() : api.storageStats()")
  const mainEnd = panel.indexOf('}, [api, scope, reloadKey])', mainStart)
  assert.ok(mainStart >= 0 && mainEnd > mainStart)
  const mainEffect = panel.slice(mainStart, mainEnd)
  assert.equal(mainEffect.includes('adminStorageHistory'), false, 'main stats load must not own history')
  assert.equal(mainEffect.includes('historyDays'), false, 'history window must not reload stats or health')
  assert.ok(panel.includes('setHistoryLoading(true)'))
  assert.ok(panel.includes('<LinearProgress aria-label="正在加载存储历史" />'))
})
