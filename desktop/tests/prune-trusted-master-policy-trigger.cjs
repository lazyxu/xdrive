'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflowPath = path.resolve(__dirname, '../../.github/workflows/prune-verified-branches.yml')
const workflow = fs.readFileSync(workflowPath, 'utf8')
const eventBlock = workflow.slice(workflow.indexOf('\non:\n') + 1,
  workflow.indexOf('\npermissions:\n'))

test('verified prune runs on master only when reviewed retirement policy changes', () => {
  assert.match(eventBlock, /^on:\n  push:\n    branches: \[master\]\n    paths:\n/)
  assert.match(eventBlock, /^      - '\.github\/workflows\/prune-verified-branches\.yml'$/m)
  assert.match(eventBlock, /^      - '\.github\/retired-branches\.tsv'$/m)
  const allowedPaths = eventBlock.match(/^      - '.+'$/gm) || []
  assert.equal(allowedPaths.length, 2, 'no broad push paths')
  assert.ok(!eventBlock.includes('**'), 'no wildcard or repo-wide master trigger')
  assert.doesNotMatch(eventBlock, /^  pull_request(?:_target)?:/m)
  assert.match(eventBlock, /^  schedule:\n    - cron: '43 3 \* \* \*'$/m)
  assert.match(eventBlock, /^  workflow_dispatch:/m)
})

test('write-capable event remains trusted and cleanup remains fail closed', () => {
  assert.match(workflow, /^permissions:\n  contents: write\n  pull-requests: read\n  issues: read$/m)
  assert.match(workflow, /^  cancel-in-progress: false$/m)
  assert.match(workflow, /const inOpenPR = new Set\(\)/)
  assert.match(workflow, /inOpenPR\.has\(name\)/)
  assert.match(workflow, /latest\.commit\.sha !== branch\.commit\.sha/)
  assert.match(workflow, /github\.rest\.git\.deleteRef/)
  assert.match(workflow, /const dryRun = context\.eventName === 'workflow_dispatch'/)
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.sha/)
})
