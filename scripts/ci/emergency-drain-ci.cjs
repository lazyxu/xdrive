'use strict'

// Emergency, one-shot cleanup from trusted master. Cancel obsolete PR checks
// and old master-push workflows, but keep CURRENT master, tag releases,
// manually requested workflows, and this cleanup execution.
const ACTIVE = new Set(['queued', 'pending', 'in_progress', 'waiting', 'requested'])
const SHA = /^[a-f0-9]{40}$/
const REPO = 'lazyxu/xdrive'

function eligible(run, masterHead, selfId) {
  if (!run || !Number.isSafeInteger(run.id) || run.id === selfId ||
      !ACTIVE.has(run.status) || !SHA.test(run.head_sha) ||
      typeof run.path !== 'string' || !run.path.startsWith('.github/workflows/')) return false
  // Published tag releases and source-only manual dispatches are not CI backlog.
  if (run.path === '.github/workflows/release.yml' ||
      run.path === '.github/workflows/android-signed-public-release.yml') return false
  if (run.event === 'pull_request') return true
  return run.event === 'push' && run.head_branch === 'master' && run.head_sha !== masterHead
}

async function drain({github, context, core, dryRun = false, maxCancels = 400}) {
  const {owner, repo} = context.repo
  if (owner + '/' + repo !== REPO || context.ref !== 'refs/heads/master' ||
      !['push', 'workflow_dispatch'].includes(context.eventName)) {
    throw new Error('Emergency CI drain requires trusted master')
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
    if (dryRun) { ++requested; continue }
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

module.exports = {eligible, drain}
