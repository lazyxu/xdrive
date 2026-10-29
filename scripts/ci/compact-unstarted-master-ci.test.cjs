'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  eligibleRun, unstartedJob, compactUnstartedMasterCI,
} = require('./compact-unstarted-master-ci.cjs')

const a = 'a'.repeat(40)
const b = 'b'.repeat(40)
const masterSHA = 'f'.repeat(40)
const run = (id, sha = a, overrides = {}) => ({
  id, name: 'CI', path: '.github/workflows/ci.yml',
  event: 'push', head_branch: 'master', status: 'queued',
  run_attempt: 1, head_sha: sha,
  created_at: new Date(Date.UTC(2026, 9, 29, 8, id)).toISOString(),
  ...overrides,
})
const queued = (id, name = 'web') => ({run_id: id, name, status: 'queued'})

function mock({runs = [], jobs = {}, moved = {}, relation = 'ahead', jobCounts = {}} = {}) {
  const calls = {cancels: [], compares: [], lists: 0, fetches: []}
  const github = {
    rest: {
      repos: {
        getBranch: async () => ({data: {commit: {sha: masterSHA}}}),
        compareCommits: async args => {
          calls.compares.push(args)
          return {data: {status: relation, behind_by: 0}}
        },
      },
      actions: {
        listWorkflowRuns: async ({page}) => {
          calls.lists++
          return {data: {workflow_runs: page === 1 ? runs : []}}
        },
        getWorkflowRun: async ({run_id}) => {
          calls.fetches.push(run_id)
          return {data: moved[run_id] || runs.find(x => x.id === run_id)}
        },
        listJobsForWorkflowRun: async ({run_id}) => {
          const entries = jobs[run_id] || [queued(run_id)]
          return {data: {jobs: entries, total_count: jobCounts[run_id] ?? entries.length}}
        },
        cancelWorkflowRun: async ({run_id}) => {
          calls.cancels.push(run_id)
          return {status: 202}
        },
      },
    },
  }
  const context = {
    repo: {owner: 'lazyxu', repo: 'xdrive'},
    ref: 'refs/heads/master', eventName: 'push', runId: 9999,
  }
  const notes = []
  const core = {info: s => notes.push(s), warning: s => notes.push(s)}
  return {github, context, core, calls, notes}
}

test('only exact first-attempt queued master CI is eligible', () => {
  const ordinary = run(2)
  assert.equal(eligibleRun(ordinary, masterSHA, 9999), true)
  for (const bad of [
    {event: 'pull_request'}, {head_branch: 'feature'},
    {name: 'Android Master APK'}, {path: 'other.yml'},
    {status: 'pending'}, {run_attempt: 2}, {head_sha: masterSHA},
    {head_sha: 'invalid'}, {id: 9999},
  ]) assert.equal(eligibleRun({...ordinary, ...bad}, masterSHA, 9999), false)
})

test('completed substantive jobs, runner assignment, and any executing step protect the run', () => {
  assert.equal(unstartedJob(queued(1), 1), true)
  assert.equal(unstartedJob({...queued(1), status: 'completed', conclusion: 'skipped'}, 1), true)
  assert.equal(unstartedJob({...queued(1, 'pr-scope'), status: 'completed', conclusion: 'success'}, 1), true)
  for (const unsafe of [
    {...queued(1), status: 'completed', conclusion: 'success'},
    {...queued(1), status: 'completed', conclusion: 'failure'},
    {...queued(1), status: 'in_progress'},
    {...queued(1), runner_name: 'hosted-runner'},
    {...queued(1), started_at: '2026-10-29T08:00:00Z'},
    {...queued(1), steps: [{status: 'completed'}]},
    {...queued(1), run_id: 2},
  ]) assert.equal(unstartedJob(unsafe, 1), false)
})

test('preserve latest three queued master checks; compact only older zero-work runs', async () => {
  const rows = [run(1), run(2), run(3), run(4, b), run(5, b), run(6, b)]
  const h = mock({runs: rows})
  const result = await compactUnstartedMasterCI({
    ...h, preserveNewest: 3, maxCancels: 60,
  })
  assert.deepEqual(h.calls.cancels, [1, 2, 3])
  assert.equal(result.requested, 3)
  assert.equal(result.observed, 6)
})

test('preserve completed builds, publish jobs, running jobs, and partial job inventories', async () => {
  const rows = [run(1), run(2), run(3), run(4), run(5), run(6)]
  const h = mock({
    runs: rows,
    jobs: {
      1: [queued(1), {run_id: 1, name: 'server-image', status: 'completed', conclusion: 'success'}],
      2: [{run_id: 2, name: 'publish-master / bundle', status: 'in_progress'}],
      3: [queued(3)],
    },
    jobCounts: {3: 77},
  })
  await compactUnstartedMasterCI({...h, preserveNewest: 3})
  assert.deepEqual(h.calls.cancels, [])
})

test('exact run recheck and Git ancestry protect moved or unrelated commits', async () => {
  const rows = [run(1), run(2), run(3), run(4)]
  const changed = mock({
    runs: rows, moved: {1: run(1, a, {status: 'in_progress'})},
  })
  await compactUnstartedMasterCI({...changed, preserveNewest: 3})
  assert.deepEqual(changed.calls.cancels, [])
  const diverged = mock({runs: rows, relation: 'diverged'})
  await compactUnstartedMasterCI({...diverged, preserveNewest: 3})
  assert.deepEqual(diverged.calls.cancels, [])
})

test('dry run must not send cancellation even when fully eligible', async () => {
  const h = mock({runs: [run(1), run(2), run(3), run(4)]})
  const result = await compactUnstartedMasterCI({...h, dryRun: true})
  assert.equal(result.eligible, 1)
  assert.equal(result.requested, 0)
  assert.deepEqual(h.calls.cancels, [])
  assert.ok(result.audit.some(x => x.decision === 'would-cancel'))
})

test('wrong repository/ref, and excessive removal budget fail closed', async () => {
  const h = mock({runs: [run(1)]})
  await assert.rejects(compactUnstartedMasterCI({
    ...h, context: {...h.context, ref: 'refs/heads/not-master'},
  }), /not on trusted master/)
  await assert.rejects(compactUnstartedMasterCI({
    ...h, context: {...h.context, repo: {owner: 'other', repo: 'xdrive'}},
  }), /wrong repository/)
  await assert.rejects(compactUnstartedMasterCI({...h, maxCancels: 1000}), /budget/)
  assert.equal(h.calls.cancels.length, 0)
})
