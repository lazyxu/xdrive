'use strict'

// Compacts ONLY unstarted, superseded push CI on master. A queued workflow
// status by itself is never enough: a completed test/build or started publisher
// makes the whole run ineligible, even if its workflow remains "queued".
const SHA = /^[0-9a-f]{40}$/
const CI_PATH = '.github/workflows/ci.yml'

function assert(value, message) {
  if (!value) throw new Error('master CI compaction refused: ' + message)
}

function eligibleRun(run, masterSHA, currentRunId) {
  return Number.isSafeInteger(run?.id) &&
    run.id !== currentRunId &&
    run.name === 'CI' &&
    run.path === CI_PATH &&
    run.event === 'push' &&
    run.head_branch === 'master' &&
    run.status === 'queued' &&
    run.run_attempt === 1 &&
    SHA.test(run.head_sha) &&
    run.head_sha !== masterSHA &&
    Number.isFinite(Date.parse(run.created_at))
}

// Exact job inventory must prove absolutely no substantive work started.
// A successful pr-scope is read-only classification, not a build/test artifact.
function unstartedJob(job, runId) {
  if (job?.run_id !== runId) return false
  if (job.status === 'queued') {
    // A job already assigned to a runner is not safe to cancel, even if
    // GitHub has not yet updated the enclosing workflow status.
    if (job.runner_name || job.started_at) return false
    if (Array.isArray(job.steps) &&
        job.steps.some(step => step.status === 'in_progress' ||
                               step.status === 'completed')) return false
    return true
  }
  return job.status === 'completed' &&
    (job.conclusion === 'skipped' ||
      (job.name === 'pr-scope' && job.conclusion === 'success'))
}

async function compactUnstartedMasterCI({
  github, context, core, dryRun = false, maxCancels = 60, preserveNewest = 3,
}) {
  const {owner, repo} = context.repo
  assert(owner === 'lazyxu' && repo === 'xdrive', 'wrong repository')
  assert(context.ref === 'refs/heads/master', 'not on trusted master')
  assert(['push', 'schedule', 'workflow_dispatch'].includes(context.eventName),
    'unsupported workflow event')
  assert(typeof dryRun === 'boolean', 'invalid dry run')
  assert(Number.isSafeInteger(maxCancels) && maxCancels >= 1 && maxCancels <= 60,
    'invalid cancellation budget')
  assert(Number.isSafeInteger(preserveNewest) && preserveNewest >= 2 && preserveNewest <= 10,
    'invalid preservation window')

  const head = (await github.rest.repos.getBranch({
    owner, repo, branch: 'master',
  })).data?.commit?.sha
  assert(SHA.test(head), 'master head unavailable')

  const snapshots = []
  for (let page = 1; page <= 2; page++) {
    const response = await github.rest.actions.listWorkflowRuns({
      owner, repo, workflow_id: 'ci.yml', branch: 'master',
      status: 'queued', page, per_page: 100,
    })
    const rows = response?.data?.workflow_runs
    assert(Array.isArray(rows), 'unavailable workflow inventory')
    snapshots.push(...rows)
    if (rows.length < 100) break
  }

  // Preserve the current master AND the latest queued predecessors, even
  // if they have not started. Older entries may be pruned only with proof.
  const candidates = snapshots
    .filter(run => eligibleRun(run, head, context.runId))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const keep = new Set(candidates.slice(0, preserveNewest).map(run => run.id))
  let eligible = 0
  let requested = 0
  const audit = []
  const ancestryCache = new Map()

  // Oldest first: free obsolete queued slots before considering new ones.
  for (const run of candidates.slice().reverse()) {
    if (eligible >= maxCancels) break
    if (keep.has(run.id)) continue
    let ancestor = ancestryCache.get(run.head_sha)
    if (ancestor === undefined) {
      try {
        const relation = (await github.rest.repos.compareCommits({
          owner, repo, base: run.head_sha, head,
        })).data
        ancestor = relation?.behind_by === 0 && relation.status === 'ahead'
      } catch (err) {
        core.warning('Preserved CI ' + run.id +
          ': unable to prove master ancestry (' + (err.status || 'unknown') + ')')
        ancestor = false
      }
      ancestryCache.set(run.head_sha, ancestor)
    }
    if (!ancestor) continue

    // Re-read the exact run, not just the previously paged snapshot.
    const current = (await github.rest.actions.getWorkflowRun({
      owner, repo, run_id: run.id,
    })).data
    if (!eligibleRun(current, head, context.runId) ||
        current.head_sha !== run.head_sha ||
        current.path !== run.path) {
      audit.push({id: run.id, decision: 'preserved-run-moved'})
      continue
    }

    const inventory = (await github.rest.actions.listJobsForWorkflowRun({
      owner, repo, run_id: run.id, per_page: 100,
    })).data
    const jobs = inventory?.jobs
    if (!Number.isSafeInteger(inventory?.total_count) ||
        inventory.total_count < 1 || inventory.total_count > 100 ||
        !Array.isArray(jobs) || jobs.length !== inventory.total_count ||
        !jobs.every(job => unstartedJob(job, run.id))) {
      audit.push({id: run.id, decision: 'preserved-started-or-unknown'})
      continue
    }

    // GitHub has no atomic "cancel iff still unstarted" operation. Check
    // the run once more immediately before cancellation; never force-cancel.
    const immediate = (await github.rest.actions.getWorkflowRun({
      owner, repo, run_id: run.id,
    })).data
    if (!eligibleRun(immediate, head, context.runId) ||
        immediate.head_sha !== run.head_sha) {
      audit.push({id: run.id, decision: 'preserved-race'})
      continue
    }

    eligible++
    if (dryRun) {
      audit.push({id: run.id, decision: 'would-cancel'})
      continue
    }
    try {
      await github.rest.actions.cancelWorkflowRun({owner, repo, run_id: run.id})
      requested++
      audit.push({id: run.id, decision: 'cancel-requested'})
    } catch (err) {
      if (err.status !== 404 && err.status !== 409) throw err
      audit.push({id: run.id, decision: 'preserved-cancel-race'})
    }
  }

  core.info('master=' + head + ', queued=' + snapshots.length +
    ', verified-unstarted=' + eligible + ', requested=' + requested +
    ', dry_run=' + dryRun)
  for (const item of audit) core.info(item.decision + ' CI #' + item.id)
  return {head, observed: snapshots.length, eligible, requested, audit, dryRun}
}

module.exports = {eligibleRun, unstartedJob, compactUnstartedMasterCI}
