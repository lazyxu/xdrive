'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const registry = fs.readFileSync(path.join(root, 'docs/performance-test-registry.md'), 'utf8')
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const evidenceRoot = path.join(root, 'docs/performance-evidence')

test('AGENTS mandates a single performance registry and same-work-commit update', () => {
  assert.match(agents, /Mandatory tested-workload registry and deduplication/)
  assert.ok(agents.includes('docs/performance-test-registry.md'))
  assert.match(agents, /Mandatory registry update in the same one-work-commit PR/)
  assert.match(registry, /不再做一遍探索性测试/)
  assert.match(registry, /Context\.Done/)
})

test('performance registry contains unique stable workload IDs and explicit RED, Rejected, Blocked', () => {
  const ids = [...registry.matchAll(/^\| (P\d{3}) \|/gm)].map(row => row[1])
  assert.ok(ids.length >= 30, 'registry must cover existing major performed work')
  assert.equal(new Set(ids).size, ids.length, 'duplicate performance workload ID')
  for (const phrase of ['已验收 CURRENT', '已测红项', 'Rejected', 'Blocked', 'Mock', '不等于100k物理视频']) {
    assert.ok(registry.includes(phrase), 'missing status/scope distinction: ' + phrase)
  }
})

test('every existing immutable performance evidence directory has an index link', () => {
  const dirs = fs.readdirSync(evidenceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name)
  assert.ok(dirs.length >= 67, 'evidence archive unexpectedly missing')
  for (const dir of dirs) {
    assert.ok(registry.includes('performance-evidence/' + dir + '/'),
      'unregistered performance evidence directory: ' + dir)
  }
  assert.ok(registry.includes('路径') || registry.includes('证据目录'))
})
