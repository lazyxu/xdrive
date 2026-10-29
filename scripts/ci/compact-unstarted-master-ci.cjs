'use strict'

// Prune only obsolete master CI after inspecting every job. Either ALL jobs
// are unstarted, or a failed stale pending workflow has already completed
// every test, build, and publisher. Never stop an active publisher.
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

// Some failed master workflows remain pending after all jobs finish. Retire
// only proven terminal failures, NEVER pending runs with unfinished publishers.
function terminalFailedPendingRun(run, masterSHA, currentRunId) {
  return run?.status === 'pending' &&
    eligibleRun({...run, status: 'queued'}, masterSHA, currentRunId) &&
    Date.now() - Date.parse(run.created_at) > 20 * 60 * 1000
}

function terminalFailedJobInventory(jobs, runId) {
  if (!Array.isArray(jobs) || jobs.length < 5) return false
  const terminal = new Set(['success', 'failure', 'cancelled', 'skipped'])
  if (!jobs.every(job => job?.run_id === runId &&
      job.status === 'completed' && terminal.has(job.conclusion) &&
      !job.steps?.some(step => step.status === 'queued' || step.status === 'in_progress'))) return false
  if (!jobs.some(job => job.conclusion === 'failure')) return false
  const publishers = new Set(jobs.filter(job =>
    job.name.startsWith('publish-master /')).map(job => job.name))
  return ['publish-master / server-images', 'publish-master / server-deploy',
    'publish-master / verify-client-artifacts'].every(name => publishers.has(name))
}

// An old, already FAILED CI may also be waiting only for a release bundle
// that GitHub has not assigned to any runner. The user explicitly permits
// retiring superseded CI: preserve completed artifacts, but do not require
// running the stale bundle or obsolete queued tests. All actual in-flight
// work is a hard veto; the latest master stays protected.
function terminalFailedPendingBundleInventory(jobs, runId) {
  if (!Array.isArray(jobs) || jobs.length < 5) return false
  const terminal = new Set(['success', 'failure', 'cancelled', 'skipped'])
  const unassigned = job =>
    !job.runner_name && (job.runner_id == null || job.runner_id === 0) &&
    (!job.started_at || job.started_at === job.created_at) &&
    Array.isArray(job.steps) && job.steps.length === 0
  if (!jobs.every(job => job?.run_id === runId && (
      (job.status === 'completed' && terminal.has(job.conclusion) &&
        !job.steps?.some(step => step.status === 'in_progress')) ||
      (job.status === 'queued' && job.conclusion == null && unassigned(job)) ||
      (job.name === 'publish-master / bundle' && job.status === 'pending' &&
        job.conclusion == null && unassigned(job))
    ))) return false
  if (!jobs.some(job => job.status === 'completed' && job.conclusion === 'failure')) return false
  const bundle = jobs.filter(job => job.name === 'publish-master / bundle')
  if (bundle.length !== 1 || bundle[0].status !== 'pending' ||
      !unassigned(bundle[0])) return false
  return ['publish-master / server-images', 'publish-master / server-deploy',
    'publish-master / verify-client-artifacts'].every(name =>
      jobs.some(job => job.name === name && job.status === 'completed' &&
        job.conclusion === 'success'))
}

// Exact job inventory must prove absolutely no substantive work started.
// A successful pr-scope is read-only classification, not a build/test artifact.
function unstartedJob(job, runId) {
  if (job?.run_id !== runId) return false
  if (job.status === 'queued') {
    // A job already assigned to a runner is not safe to cancel, even if
    // GitHub has not yet updated the enclosing workflow status.
    if (job.runner_name || (job.runner_id != null && job.runner_id !== 0)) return false
    // GitHub populates started_at with created_at even for a job that has
    // never been allocated a runner (runner_id: 0, runner_name: '').
    // Different timestamps cannot prove it was never started; preserve it.
    if (job.started_at && job.started_at !== job.created_at) return false
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
  for (const status of ['queued', 'pending']) {
    for (let page = 1; page <= 2; page++) {
      const response = await github.rest.actions.listWorkflowRuns({
        owner, repo, workflow_id: 'ci.yml', branch: 'master',
        status, page, per_page: 100,
      })
      const rows = response?.data?.workflow_runs
      assert(Array.isArray(rows), 'unavailable workflow inventory for ' + status)
      snapshots.push(...rows)
      if (rows.length < 100) break
    }
  }

  // Preserve current master and the newest predecessors regardless of status.
  const selector = run => eligibleRun(run, head, context.runId) ||
    terminalFailedPendingRun(run, head, context.runId)
  const candidates = snapshots.filter(selector)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const keep = new Set(candidates.slice(0, preserveNewest).map(run => run.id))
  let eligible = 0
  let requested = 0
  const audit = []
  const ancestryCache = new Map()

  // First free unstarted CI slots; only then retire fully finished failures.
  const cancelOrder = [
    ...candidates.filter(run => run.status === 'queued').reverse(),
    ...candidates.filter(run => run.status === 'pending').reverse(),
  ]
  for (const run of cancelOrder) {
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
    if (!selector(current) || current.status !== run.status ||
        current.head_sha !== run.head_sha ||
        current.path !== run.path) {
      audit.push({id: run.id, decision: 'preserved-run-moved'})
      continue
    }

    const inventory = (await github.rest.actions.listJobsForWorkflowRun({
      owner, repo, run_id: run.id, per_page: 100,
    })).data
    const jobs = inventory?.jobs
    const proven = run.status === 'queued'
      ? jobs?.every(job => unstartedJob(job, run.id))
      : (terminalFailedJobInventory(jobs, run.id) ||
         terminalFailedPendingBundleInventory(jobs, run.id))
    if (!Number.isSafeInteger(inventory?.total_count) ||
        inventory.total_count < 1 || inventory.total_count > 100 ||
        !Array.isArray(jobs) || jobs.length !== inventory.total_count ||
        !proven) {
      audit.push({id: run.id, decision: 'preserved-started-or-unknown'})
      continue
    }

    // GitHub has no atomic "cancel iff still unstarted" operation. Check
    // the run once more immediately before cancellation; never force-cancel.
    const immediate = (await github.rest.actions.getWorkflowRun({
      owner, repo, run_id: run.id,
    })).data
    if (!selector(immediate) || immediate.status !== run.status ||
        immediate.head_sha !== run.head_sha) {
      audit.push({id: run.id, decision: 'preserved-race'})
      continue
    }

    // One final job snapshot prevents cancelling a publisher that was
    // assigned a runner between the first proof and the workflow recheck.
    if (run.status === 'pending') {
      const final = (await github.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: run.id, per_page: 100,
      })).data
      if (!Array.isArray(final?.jobs) || final.total_count !== inventory.total_count ||
          final.jobs.length !== inventory.total_count ||
          !(terminalFailedJobInventory(final.jobs, run.id) ||
            terminalFailedPendingBundleInventory(final.jobs, run.id))) {
        audit.push({id: run.id, decision: 'preserved-publisher-started'})
        continue
      }
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

  core.info('master=' + head + ', scanned=' + snapshots.length +
    ', verified-unstarted=' + eligible + ', requested=' + requested +
    ', dry_run=' + dryRun)
  for (const item of audit) core.info(item.decision + ' CI #' + item.id)
  return {head, observed: snapshots.length, eligible, requested, audit, dryRun}
}

module.exports = {eligibleRun, terminalFailedPendingRun, terminalFailedJobInventory,
  terminalFailedPendingBundleInventory, unstartedJob, compactUnstartedMasterCI}
