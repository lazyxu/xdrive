'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { safeBranchName, retireMergedPRBranch: retire } =
  require('./retire-merged-pr-branch.cjs')
const sha = 'a'.repeat(40)
const repoName = 'lazyxu/xdrive'
const branch = 'fix/merged-feature'
function fixture(changes = {}) {
  const event = {
    number: 42, state: 'closed', merged: true,
    head: { ref: branch, sha, repo: { full_name: repoName } },
    base: { ref: 'master', repo: { full_name: repoName } },
    ...changes.event,
  }
  const live = { ...event, merged_at: '2026-10-29T00:00:00Z', ...changes.live }
  const open = changes.open ?? []
  const remote = { protected: false, commit: { sha }, ...changes.remote }
  const calls = { get: 0, paginate: 0, branch: 0, deleted: [] }
  const context = {
    eventName: 'pull_request_target',
    repo: { owner: 'lazyxu', repo: 'xdrive' },
    payload: { action: 'closed', pull_request: event, ...changes.payload },
    ...changes.context,
  }
  const github = {
    rest: {
      pulls: {
        get: async () => {
          calls.get++
          if (changes.throwGet) throw new Error('get unavailable')
          return { data: live }
        },
        list: async () => {},
      },
      repos: {
        getBranch: async () => {
          calls.branch++
          if (changes.throwBranch) throw changes.throwBranch
          return { data: remote }
        },
      },
    },
    paginate: async () => {
      calls.paginate++
      if (changes.throwOpen) throw new Error('open PR inventory unavailable')
      return open
    },
  }
  const deleteExact = async ({ branch: candidate, sha: expected }) => {
    calls.deleted.push({ branch: candidate, sha: expected })
    return changes.leaseSuccess !== false
  }
  return { context, github, deleteExact, calls }
}
async function run(options = {}) {
  const f = fixture(options)
  const value = await retire(f)
  return { value, calls: f.calls }
}
test('exact merged master PR tip retires once using SHA lease', async () => {
  const { value, calls } = await run()
  assert.equal(value.reason, 'deleted_exact_merged_head')
  assert.equal(value.deleted, true)
  assert.deepEqual(calls.deleted, [{ branch, sha }])
  assert.deepEqual([calls.get, calls.paginate, calls.branch], [1, 1, 1])
})
test('do not delete a branch used as the head or base of ANY open PR', async () => {
  for (const field of ['head', 'base']) {
    const reused = { head: { ref: 'other', repo: { full_name: repoName } },
      base: { ref: 'master', repo: { full_name: repoName } } }
    reused[field].ref = branch
    const { value, calls } = await run({ open: [reused] })
    assert.equal(value.reason, 'active_pr_head_or_base')
    assert.deepEqual(calls.deleted, [])
  }
})
test('unmerged, non-master and fork events are ineligible', async () => {
  for (const event of [
    { merged: false },
    { base: { ref: 'develop', repo: { full_name: repoName } } },
    { head: { ref: branch, sha, repo: { full_name: 'fork/xdrive' } } },
  ]) {
    const { value, calls } = await run({ event })
    assert.equal(value.reason, 'ineligible_event')
    assert.deepEqual(calls.deleted, [])
  }
})
test('no deletion from other event types or event actions', async () => {
  const other = await run({ context: { eventName: 'push' } })
  const labeled = await run({ payload: { action: 'labeled' } })
  assert.equal(other.value.reason, 'ineligible_event')
  assert.equal(labeled.value.reason, 'ineligible_event')
  assert.deepEqual(other.calls.deleted, [])
  assert.deepEqual(labeled.calls.deleted, [])
})
test('deny unsafe branch names, master and malformed event SHA', async () => {
  for (const value of ['master', '..', 'fix/../master', '/foo', 'fix/.hidden',
    'fix/topic.lock', 'fix//bad', 'bad; rm -rf /', '', 'fix/evil@{1}']) {
    assert.equal(safeBranchName(value), false)
  }
  const { value, calls } = await run({ event: {
    head: { ref: branch, sha: 'b'.repeat(39), repo: { full_name: repoName } },
  } })
  assert.equal(value.reason, 'unsafe_ref')
  assert.deepEqual(calls.deleted, [])
})
test('real merged PR read must still match exact event source tip', async () => {
  for (const live of [
    { head: { ref: branch, sha: 'b'.repeat(40), repo: { full_name: repoName } } },
    { merged_at: null }, { state: 'open' },
  ]) {
    const { value, calls } = await run({ live })
    assert.equal(value.reason, 'pr_changed')
    assert.deepEqual(calls.deleted, [])
  }
})
test('remote ref advanced or protected after merge is never deleted', async () => {
  for (const remote of [{ commit: { sha: 'b'.repeat(40) } }, { protected: true }]) {
    const { value, calls } = await run({ remote })
    assert.equal(value.reason, 'remote_head_changed_or_protected')
    assert.deepEqual(calls.deleted, [])
  }
})
test('a missing remote ref is already done; wrong API errors are not swallowed', async () => {
  const gone = await run({ throwBranch: { status: 404 } })
  assert.equal(gone.value.reason, 'already_removed')
  assert.deepEqual(gone.calls.deleted, [])
  const bad = fixture({ throwBranch: { status: 403 } })
  await assert.rejects(retire(bad), error => error.status === 403)
  assert.deepEqual(bad.calls.deleted, [])
})
test('stale open-PR inventory fails closed, never assumes no consumers', async () => {
  for (const changes of [{ throwOpen: true }, { open: [null] }]) {
    const f = fixture(changes)
    await assert.rejects(retire(f))
    assert.deepEqual(f.calls.deleted, [])
  }
})
test('atomic push lease failure leaves advanced branch untouched', async () => {
  const { value, calls } = await run({ leaseSuccess: false })
  assert.equal(value.reason, 'lease_rejected')
  assert.equal(value.deleted, false)
  assert.equal(calls.deleted.length, 1)
})
