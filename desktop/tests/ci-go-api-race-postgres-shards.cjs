'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/ci/test-go-api-race.sh'), 'utf8',
)
const goParity = fs.readFileSync(
  path.resolve(__dirname, '../../internal/cicontract/ci_parity_test.go'), 'utf8',
)
const match = source.match(/shards=\(\n([\s\S]*?)\n\)/)
assert.ok(match, 'Go API Race CI must declare its sequential tested shards')
const shards = [...match[1].matchAll(/^\s*'([^']+)'$/gm)].map(x => x[1])

test('Go API Race shards partition actual A..Z, Example and Fuzz names exactly once', () => {
  assert.equal(shards.length, 5, 'split the overloaded first shard; do not silently grow test concurrency')
  const names = ['ExampleSmoke', 'FuzzInput', ...Array.from(
    { length: 26 }, (_, i) => 'Test' + String.fromCharCode(65 + i) + 'Feature',
  )]
  for (const name of names) {
    const matches = shards.filter(pattern => new RegExp(pattern).test(name))
    assert.equal(matches.length, 1, name + ' must run once under Race: ' + matches)
  }
  assert.notEqual(
    shards.findIndex(pattern => new RegExp(pattern).test('TestBaiduQuota')),
    shards.findIndex(pattern => new RegExp(pattern).test('TestChunkedUploadResumeHashHistoryAndConflict')),
    'release old Baidu/other A-B PostgreSQL pools before the real Chunked Upload test',
  )
})

test('Race and real PostgreSQL execution are preserved; failures cannot be hidden', () => {
  for (const needle of [
    'go test -race -mod=readonly -list',
    'go test -race -timeout=30m -count=1 -json -run',
    'if (( matched != 1 ))',
    'if (( status != 0 )); then',
    'exit "$status"',
  ]) assert.ok(source.includes(needle), needle)
  assert.doesNotMatch(source, /-skip\b|-parallel=[01]\b/,
    'do not exclude tests or lower intra-test concurrency to bypass failures')
  assert.doesNotMatch(source, /go test -race[^\n]*\|\|\s*true/,
    'the actual Race test invocation must propagate failures (diagnostic commands may use || true)')
  for (const selector of shards) {
    assert.ok(goParity.includes(JSON.stringify("'" + selector + "'")),
      'Go GitHub/GitLab CI parity contract must assert the live shard: ' + selector)
  }
})
