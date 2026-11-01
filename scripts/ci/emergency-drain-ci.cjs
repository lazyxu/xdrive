'use strict'

// Manual-only emergency cleanup from trusted master. Cancel obsolete PR checks
// and old master-push workflows, but keep CURRENT master, tag releases,
// manually requested workflows, and this cleanup execution.
// Only an entirely unstarted, first-attempt run can be retired, even manually.
const ACTIVE = new Set(['queued'])
const SHA = /^[a-f0-9]{40}$/
const REPO = 'lazyxu/xdrive'

function eligible(run, masterHead, selfId) {
  if (!run || !Number.isSafeInteger(run.id) || run.id === selfId ||
      run.status !== 'queued' || run.run_attempt !== 1 || !SHA.test(run.head_sha) ||
      typeof run.path !== 'string' || !run.path.startsWith('.github/workflows/')) return false
  // Published tag releases and source-only manual dispatches are not CI backlog.
  if (run.path === '.github/workflows/release.yml' ||
      run.path === '.github/workflows/android-signed-public-release.yml') return false
  if (run.event === 'pull_request') return true
  return run.event === 'push' && run.head_branch === 'master' && run.head_sha !== masterHead
}


function jobHasNeverStarted(job, runId) {
  if (job?.run_id !== runId) return false
  // A skipped conditional job is not an execution. Successful classifiers
  // are conservatively preserved, along with every real test or publisher.
  if (job.status === 'completed') return job.conclusion === 'skipped'
  if (job.status !== 'queued' || job.conclusion != null) return false
  if (job.runner_name || (job.runner_id != null && job.runner_id !== 0)) return false
  // GitHub sometimes sets started_at to created_at on unassigned jobs.
  if (job.started_at && job.started_at !== job.created_at) return false
  if (Array.isArray(job.steps) &&
      job.steps.some(step => step.status === 'in_progress' || step.status === 'completed')) return false
  return true
}

function completeUnstartedInventory(inventory, runId) {
  const jobs = inventory?.jobs
  return Number.isSafeInteger(inventory?.total_count) &&
    inventory.total_count > 0 && inventory.total_count <= 100 &&
    Array.isArray(jobs) && jobs.length === inventory.total_count &&
    jobs.every(job => jobHasNeverStarted(job, runId))
}

async function drain({github, context, core, dryRun = false, maxCancels = 400}) {
  const {owner, repo} = context.repo
  if (owner + '/' + repo !== REPO || context.ref !== 'refs/heads/master' ||
      context.eventName !== 'workflow_dispatch') {
    throw new Error('Emergency CI drain requires trusted master and manual dispatch')
  }
  if (typeof dryRun !== 'boolean' || !Number.isInteger(maxCancels) ||
      maxCancels < 1 || maxCancels > 400) throw new Error('Invalid drain controls')
  const getHead = async () => {
    const sha = (await github.rest.repos.getBranch({owner, repo, branch: 'master'})).data?.commit?.sha
    if (!SHA.test(sha)) throw new Error('Cannot verify current master')
    return sha
  }
  let head = await getHead()
  const found = new Map()
  for (const status of ACTIVE) {
    for (let page = 1; page <= 8; ++page) {
      const response = await github.rest.actions.listWorkflowRunsForRepo({owner, repo, status, page, per_page: 100})
      const runs = response?.data?.workflow_runs
      if (!Array.isArray(runs)) throw new Error('Cannot inventory active workflows: ' + status)
      for (const run of runs) found.set(run.id, run)
      if (runs.length < 100) break
    }
  }
  const candidates = [...found.values()]
    .filter(run => eligible(run, head, context.runId))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  let requested = 0, skipped = 0
  const cancelledIds = []
  for (const row of candidates) {
    if (requested >= maxCancels) break
    // An actively changing master must not lose its newest CI even if the
    // head moved after the initial inventory.
    if ((requested + skipped) % 20 === 0) head = await getHead()
    let current
    try {
      current = (await github.rest.actions.getWorkflowRun({owner, repo, run_id: row.id})).data
    } catch (e) {
      if ([404, 410].includes(e.status)) { ++skipped; continue }
      throw e
    }
    if (!eligible(current, head, context.runId) || current.head_sha !== row.head_sha ||
        current.path !== row.path || current.event !== row.event) { ++skipped; continue }
    // A queued workflow can contain a running, completed or assigned child.
    // Never use its aggregate status alone to authorize cancellation.
    let inventory
    try {
      inventory = (await github.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: row.id, per_page: 100,
      })).data
    } catch (error) {
      core.warning('Preserved CI #' + row.id + ': job inventory unavailable')
      ++skipped
      continue
    }
    if (!completeUnstartedInventory(inventory, row.id)) { ++skipped; continue }
    if (dryRun) { ++requested; continue }

    // Recheck both workflow and full job inventory immediately before cancel:
    // there is no atomic GitHub "cancel only if unstarted" operation.
    let immediate, final
    try {
      immediate = (await github.rest.actions.getWorkflowRun({
        owner, repo, run_id: row.id,
      })).data
      final = (await github.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: row.id, per_page: 100,
      })).data
    } catch (error) {
      core.warning('Preserved CI #' + row.id + ': final recheck unavailable')
      ++skipped
      continue
    }
    if (!eligible(immediate, head, context.runId) ||
        immediate.head_sha !== row.head_sha || immediate.path !== row.path ||
        immediate.event !== row.event ||
        !completeUnstartedInventory(final, row.id) ||
        final.total_count !== inventory.total_count) { ++skipped; continue }
    try {
      await github.rest.actions.cancelWorkflowRun({owner, repo, run_id: row.id})
      ++requested
      cancelledIds.push(row.id)
    } catch (e) {
      if ([404, 409, 422].includes(e.status)) { ++skipped; continue }
      throw e
    }
  }
  core.info('master=' + head + ', active observed=' + found.size +
    ', candidates=' + candidates.length + ', requested=' + requested +
    ', skipped=' + skipped + ', dryRun=' + dryRun)
  return {head, observed: found.size, candidates: candidates.length, requested, skipped, cancelledIds, dryRun}
}

module.exports = {eligible, jobHasNeverStarted, completeUnstartedInventory, drain}
