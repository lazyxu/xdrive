'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {cancelMergedPRQueuedCI, isExactQueuedCI} = require('./cancel-merged-pr-queued-ci.cjs')

const sha = 'a'.repeat(40)
const originalPR = () => ({
  number: 123,
  merged: true,
  base: {ref: 'master'},
  head: {sha, ref: 'fix/exact', repo: {full_name: 'lazyxu/xdrive'}},
})
const queued = (id = 55) => ({
  id, name: 'CI', path: '.github/workflows/ci.yml',
  event: 'pull_request', head_sha: sha, head_branch: 'fix/exact',
  status: 'queued', conclusion: null,
})
function fixture() {
  const state = {
    listed: [queued()], liveRun: queued(),
    remotePR: {...originalPR(), state: 'closed', merged_at: '2026-10-28T00:00:00Z'},
    lookups: 0, inventories: 0, rechecks: [], cancellations: [], error: null,
  }
  const github = {
    rest: {
      pulls: {get: async () => {
        state.lookups++
        return {data: state.remotePR}
      }},
      actions: {
        listWorkflowRunsForRepo: () => {},
        getWorkflowRun: async ({run_id}) => {
          state.rechecks.push(run_id)
          return {data: state.liveRun}
        },
        cancelWorkflowRun: async ({run_id}) => {
          state.cancellations.push(run_id)
          if (state.error) throw state.error
        },
      },
    },
    paginate: async (_, args) => {
      assert.equal(args.head_sha, sha)
      assert.equal(args.status, 'queued')
      assert.equal(args.event, 'pull_request')
      state.inventories++
      return state.listed
    },
  }
  const context = {
    repo: {owner: 'lazyxu', repo: 'xdrive'},
    eventName: 'pull_request_target',
    payload: {action: 'closed', pull_request: originalPR()},
  }
  return {state, github, context}
}
test('only a confirmed merged PR exact queued CI is cancelled', async () => {
  const x = fixture()
  const result = await cancelMergedPRQueuedCI(x)
  assert.deepEqual(result.cancelled, [55])
  assert.equal(x.state.lookups, 1)
  assert.equal(x.state.inventories, 1)
  assert.deepEqual(x.state.rechecks, [55])
})
test('skip events other than same-repository closed merged PR', async () => {
  for (const mutate of [
    c => {c.eventName = 'workflow_dispatch'},
    c => {c.payload.action = 'labeled'},
    c => {c.payload.pull_request.merged = false},
    c => {c.payload.pull_request.head.repo.full_name = 'fork/xdrive'},
    c => {c.payload.pull_request.base.ref = 'experimental'},
  ]) {
    const x = fixture()
    mutate(x.context)
    const result = await cancelMergedPRQueuedCI(x)
    assert.deepEqual(result.cancelled, [])
    assert.equal(x.state.lookups, 0)
    assert.equal(x.state.inventories, 0)
  }
})
test('never cancel if current GitHub PR SHA, branch, or state differs', async () => {
  for (const mutate of [
    p => {p.head.sha = 'b'.repeat(40)},
    p => {p.head.ref = 'new-branch'},
    p => {p.state = 'open'},
    p => {p.merged_at = null},
    p => {p.base.ref = 'other'},
  ]) {
    const x = fixture()
    mutate(x.state.remotePR)
    const result = await cancelMergedPRQueuedCI(x)
    assert.deepEqual(result.cancelled, [])
    assert.equal(x.state.inventories, 0)
  }
})
test('filter unrelated workflows, old SHAs and already running jobs', async () => {
  const invalid = [
    {...queued(1), name: 'Publish master'},
    {...queued(2), path: '.github/workflows/other.yml'},
    {...queued(3), event: 'push'},
    {...queued(4), head_sha: 'b'.repeat(40)},
    {...queued(5), head_branch: 'other'},
    {...queued(6), status: 'in_progress'},
    {...queued(7), conclusion: 'success'},
    {...queued(8), id: '8'},
  ]
  const x = fixture()
  x.state.listed = [...invalid, queued(9)]
  x.state.liveRun = queued(9)
  const result = await cancelMergedPRQueuedCI(x)
  assert.deepEqual(result.cancelled, [9])
  assert.deepEqual(x.state.rechecks, [9])
  for (const run of invalid) assert.equal(isExactQueuedCI(run, sha, 'fix/exact'), false)
})
test('never cancel a run that moved from queued during recheck', async () => {
  const x = fixture()
  x.state.liveRun = {...queued(), status: 'in_progress'}
  assert.deepEqual((await cancelMergedPRQueuedCI(x)).cancelled, [])
  assert.deepEqual(x.state.cancellations, [])
})
test('race with already-finished job does not fail the cleanup', async () => {
  for (const status of [409, 422]) {
    const x = fixture()
    x.state.error = {status}
    assert.deepEqual((await cancelMergedPRQueuedCI(x)).cancelled, [])
  }
})
