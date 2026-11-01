'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {eligible, jobHasNeverStarted, completeUnstartedInventory, drain} = require('./emergency-drain-ci.cjs')
const old = 'a'.repeat(40), head = 'f'.repeat(40)
const run = (id, props = {}) => ({
  id, name: 'CI', path: '.github/workflows/ci.yml', event: 'push',
  head_branch: 'master', head_sha: old, status: 'queued', run_attempt: 1,
  created_at: new Date(1761730000000 + id * 1000).toISOString(), ...props,
})
function harness(rows, movingHead = head, jobsById = {}) {
  const calls = []
  const gh = {rest: {
    repos: {getBranch: async () => ({data: {commit: {sha: movingHead}}})},
    actions: {
      listWorkflowRunsForRepo: async ({status, page}) => ({data: {
        workflow_runs: page === 1 ? rows.filter(x => x.status === status) : [],
      }}),
      getWorkflowRun: async ({run_id}) => ({data: rows.find(x => x.id === run_id)}),
      listJobsForWorkflowRun: async ({run_id}) => {
        const jobs = jobsById[run_id] ?? [{
          run_id, status: 'queued', conclusion: null, runner_name: '',
          runner_id: 0, created_at: '2026-10-29T08:00:00Z',
          started_at: '2026-10-29T08:00:00Z', steps: [],
        }]
        return {data: {total_count: jobs.length, jobs}}
      },
      cancelWorkflowRun: async ({run_id}) => {calls.push(run_id)},
    },
  }}
  return {calls, github: gh, core: {info: () => {}, warning: () => {}},
    context: {repo: {owner: 'lazyxu', repo: 'xdrive'}, ref: 'refs/heads/master',
      eventName: 'workflow_dispatch', runId: 999}}
}
test('only obsolete PR and master push runs are eligible', () => {
  assert.equal(eligible(run(1), head, 999), true)
  assert.equal(eligible(run(2, {event: 'pull_request', head_branch: 'feature'}), head, 999), true)
  for (const variant of [
    {head_sha: head}, {event: 'workflow_dispatch'}, {event: 'schedule'},
    {status: 'pending'}, {status: 'in_progress'}, {run_attempt: 2},
    {event: 'push', head_branch: 'feature'}, {status: 'completed'},
    {id: 999}, {path: '.github/workflows/release.yml'},
    {path: '.github/workflows/android-signed-public-release.yml'},
    {path: '../other'}, {head_sha: 'missing'},
  ]) assert.equal(eligible({...run(1), ...variant}, head, 999), false)
})
test('eligible stale master and PR are cancelled, latest master is protected', async () => {
  const rows = [run(1), run(2),
    run(3, {event: 'pull_request', head_branch: 'feature'}),
    run(4, {head_sha: head}), run(999)]
  const h = harness(rows)
  const result = await drain(h)
  assert.equal(result.requested, 3)
  assert.deepEqual(h.calls, [1, 2, 3])
})
test('dry run never cancels', async () => {
  const h = harness([run(1), run(2)])
  const out = await drain({...h, dryRun: true})
  assert.equal(out.requested, 2)
  assert.deepEqual(h.calls, [])
})
test('changes in status or SHA before cancellation fail closed', async () => {
  const rows = [run(1)]
  const h = harness(rows)
  h.github.rest.actions.getWorkflowRun = async () => ({data: run(1, {status: 'completed'})})
  const result = await drain(h)
  assert.equal(result.requested, 0)
  assert.deepEqual(h.calls, [])
})
test('untrusted and automatic event/repository and excessive budget fail closed', async () => {
  const h = harness([run(1)])
  for (const eventName of ['push', 'schedule', 'repository_dispatch']) {
    await assert.rejects(drain({
      ...h, context: {...h.context, eventName},
    }), /manual dispatch/)
  }
  await assert.rejects(drain({...h, context: {...h.context, ref: 'refs/heads/feature'}}), /trusted master/)
  await assert.rejects(drain({...h, maxCancels: 999}), /Invalid drain controls/)
})

test('emergency drain workflow has no automatic destructive trigger', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const file = fs.readFileSync(
    path.resolve(__dirname, '../../.github/workflows/emergency-drain-ci.yml'), 'utf8')
  assert.match(file, /^on:\n  workflow_dispatch:/m)
  assert.doesNotMatch(file, /^  (?:push|schedule|repository_dispatch):/m)
  assert.ok(file.includes('        default: true'))
  assert.ok(file.includes("EMERGENCY_DRY_RUN: ${{ inputs.dry_run }}"))
})

test('manual emergency drain preserves every active, terminal or manually retried workflow', async () => {
  const cases = [
    {status: 'in_progress'}, {status: 'pending'}, {status: 'waiting'},
    {status: 'requested'}, {run_attempt: 2}, {status: 'completed'},
  ]
  for (const change of cases) {
    const h = harness([run(1, change)])
    const outcome = await drain(h)
    assert.equal(outcome.requested, 0)
    assert.deepEqual(h.calls, [])
  }
})

test('queued master/PR run is preserved when any child started, completed or took a runner', async () => {
  const child = {run_id: 1, status: 'queued', conclusion: null, runner_id: 0,
    runner_name: '', created_at: '2026-10-29T08:00:00Z',
    started_at: '2026-10-29T08:00:00Z', steps: []}
  for (const change of [
    {status: 'in_progress'}, {status: 'completed', conclusion: 'success'},
    {status: 'completed', conclusion: 'failure'},
    {runner_id: 25}, {runner_name: 'runner-25'},
    {started_at: '2026-10-29T08:00:05Z'},
    {steps: [{status: 'completed'}]}, {run_id: 999},
  ]) {
    const h = harness([run(1)], head, {1: [{...child, ...change}]})
    const outcome = await drain(h)
    assert.equal(outcome.requested, 0)
    assert.deepEqual(h.calls, [])
  }
  assert.equal(jobHasNeverStarted({...child, status: 'completed', conclusion: 'skipped'}, 1), true)
  assert.equal(jobHasNeverStarted({...child, name: 'pr-scope', status: 'completed', conclusion: 'success'}, 1), false)
  assert.equal(completeUnstartedInventory({jobs: [], total_count: 0}, 1), false)
  assert.equal(completeUnstartedInventory({jobs: [child], total_count: 2}, 1), false)
})

test('race between initial and final inventory preserves newly started child', async () => {
  const h = harness([run(1)])
  let calls = 0
  h.github.rest.actions.listJobsForWorkflowRun = async ({run_id}) => {
    calls++
    return {data: {total_count: 1, jobs: [{
      run_id, status: calls === 1 ? 'queued' : 'in_progress',
      conclusion: null, runner_id: calls === 1 ? 0 : 100,
      runner_name: calls === 1 ? '' : 'runner', steps: [],
    }]}}
  }
  const outcome = await drain(h)
  assert.equal(outcome.requested, 0)
  assert.equal(calls, 2)
  assert.deepEqual(h.calls, [])
})
