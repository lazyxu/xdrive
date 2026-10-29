'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const workflow = fs.readFileSync(path.resolve(__dirname,
  '../../.github/workflows/cleanup-merged-branches.yml'), 'utf8')

test('merged PR cleanup runs from trusted default branch and never PR HEAD', () => {
  assert.match(workflow, /pull_request_target:\s*\n\s*types: \[closed, labeled\]/)
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head/)
  assert.match(workflow, /github\.event\.pull_request\.merged == true/)
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'master'/)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /contents: write/)
  assert.doesNotMatch(workflow, /actions: write/)
})
test('separate per-PR concurrency prevents pending-slot replacement', () => {
  assert.match(workflow, /group: cleanup-redundant-branches-.*github\.event\.pull_request\.number/)
  assert.match(workflow, /cancel-in-progress: false/)
})
test('atomic lease deletion only, never optimistic REST deletion', () => {
  assert.match(workflow, /retireMergedPRBranch\(/)
  assert.match(workflow, /execFileSync\('git', \['check-ref-format'/)
  assert.match(workflow, /--force-with-lease=refs\/heads\//)
  assert.doesNotMatch(workflow, /git\.deleteRef\(|github\.rest\.git\.deleteRef\(/)
})
test('full manual/labeled scan keeps existing safely reviewed script', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /github\.event\.action == 'labeled'/)
  assert.match(workflow, /bash -n scripts\/cleanup-merged-branches\.sh/)
  assert.match(workflow, /bash scripts\/test-cleanup-merged-branches\.sh/)
  assert.match(workflow, /bash scripts\/cleanup-merged-branches\.sh/)
})
