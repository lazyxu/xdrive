'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const cancelWorkflow = read('.github/workflows/cancel-merged-pr-queued-ci.yml')
const branchPrune = read('.github/workflows/cleanup-merged-branches.yml')
const selector = read('scripts/ci/cancel-merged-pr-queued-ci.cjs')

test('rapid merged PRs do not evict each other from the CI cancellation queue', () => {
  assert.match(cancelWorkflow, /pull_request_target:\s*\n\s*types: \[closed\]/)
  assert.match(cancelWorkflow, /group: cancel-queued-merged-pr-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.pull_request\.number \}\}/,
    'the concurrency identity must include the merged PR number, not a shared global group')
  assert.match(cancelWorkflow, /cancel-in-progress: false/)
  assert.match(cancelWorkflow, /github\.event\.pull_request\.merged == true/)
  assert.match(cancelWorkflow, /github\.event\.pull_request\.base\.ref == 'master'/)
  assert.match(cancelWorkflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.doesNotMatch(cancelWorkflow, /workflow_dispatch:|push:|schedule:|workflow_run:/)
})

test('write-capable queued CI selector executes only default-branch source', () => {
  assert.match(cancelWorkflow, /actions: write/)
  assert.match(cancelWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(cancelWorkflow, /persist-credentials: false/)
  assert.match(cancelWorkflow, /require\('\.\/scripts\/ci\/cancel-merged-pr-queued-ci\.cjs'\)/)
  assert.match(cancelWorkflow, /node --test scripts\/ci\/cancel-merged-pr-queued-ci\.test\.cjs/)
  assert.match(selector, /current\.head\.sha !== sha \|\| current\.head\.ref !== branch/)
  assert.match(selector, /run\.status === 'queued' && run\.conclusion == null/)
  assert.match(selector, /run\.event === 'pull_request' && run\.head_sha === sha/)
  assert.doesNotMatch(selector, /pull_request\.head\.ref\.startsWith|process\.env\.GITHUB_HEAD_REF/)
})

test('heavy branch prune remains serialized without Actions write permission', () => {
  assert.match(branchPrune, /group: cleanup-redundant-branches/)
  assert.match(branchPrune, /cancel-in-progress: false/)
  assert.match(branchPrune, /contents: write/)
  assert.doesNotMatch(branchPrune, /actions: write/)
  assert.doesNotMatch(branchPrune, /cancelMergedPRQueuedCI|cancel-merged-pr-queued-ci\.cjs/)
  assert.match(branchPrune, /bash scripts\/test-cleanup-merged-branches\.sh/)
  assert.match(branchPrune, /bash scripts\/cleanup-merged-branches\.sh/)
})
