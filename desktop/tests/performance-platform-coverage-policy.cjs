'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const matrix = read('docs/performance-platform-coverage.md')
const agents = read('AGENTS.md')
const registry = read('docs/performance-test-registry.md')

test('AGENTS and deduplicated performance registry both require cross-platform acceptance matrix', () => {
  for (const text of [agents, registry]) assert(text.includes('performance-platform-coverage.md'))
  assert(agents.includes('Mandatory cross-platform performance acceptance'))
  assert(agents.includes('iOS installed PWA'))
  assert(agents.includes('Android installed PWA'))
  assert(agents.includes('Mobile Web browser'))
  assert(agents.includes('native Desktop Electron'))
})
test('platform matrix explicitly separates native desktop, wide/mobile browser, installed PWA and physical devices', () => {
  for (const name of ['Native Desktop', 'Wide Web', 'Mobile Web',
    'Desktop installed PWA', 'Android installed PWA', 'iOS installed PWA',
    'P038', 'P039', 'P036', 'P032', 'P035', 'P010', 'P011', 'P015', 'P037',
    'Not measured', 'Invalid harness', 'AFTER', '115k', '4GiB',
    '真实', 'CAS', 'Context.Done', '数据量相同']) {
    assert(matrix.includes(name), 'platform contract missing '+name)
  }
  assert(matrix.includes('窄屏动态视口'))
  assert(matrix.includes('不是Safari/PWA'))
  assert(matrix.includes('独立设备'))
  assert(matrix.includes('原始'))
})
test('new coverage requirement preserves durable tasks and identifies no equivalent platform performance benchmark', () => {
  assert(matrix.includes('绝不因为应用后台/卸载视图取消Server持久任务'))
  assert(matrix.includes('不能把 PWA Safari/Chrome 显示模式模拟'))
  assert(matrix.includes('4GiB稀疏零源loopback已通过'))
  assert(registry.includes('P036'))
  assert(registry.includes('P037'))
})
