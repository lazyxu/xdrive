'use strict'

// Automatic post-Snapshot events may audit queued master CI but cannot cancel it.
// Explicit manual requests may prune only older CI proved safe to retire.
// Never cancel an in-progress run, an unpublished source, or a PR/tag/manual run.
// The single pr-scope classifier is safe to have completed: it performs only
// read-only CI scope detection, not build, test, packaging or publication.
const SHA = /^[a-f0-9]{40}$/
const OLD_RELEASE = /^Rolling development snapshot from master at `([a-f0-9]{40})`\./

function invariant(condition, explanation) {
  if (!condition) throw new Error('Snapshot CI queue prune refused: ' + explanation)
}

function isUnstartedOrClassifierOnlyJob(job, runId) {
  if (job?.run_id !== runId) return false
  if (job.status === 'queued') {
    // GitHub can report a child as queued after assigning a runner. Treat
    // any assignment, completed step or differing start timestamp as started.
    if (job.conclusion != null || job.runner_name ||
        (job.runner_id != null && job.runner_id !== 0) ||
        (job.started_at && job.started_at !== job.created_at) ||
        job.steps?.some(step => step.status === 'completed' || step.status === 'in_progress')) {
      return false
    }
    return true
  }
  if (job.status !== 'completed') return false
  return job.conclusion === 'skipped' ||
    (job.name === 'pr-scope' && job.conclusion === 'success')
}

function completeUnstartedInventory(inventory, runId) {
  const jobs = inventory?.jobs
  return Number.isSafeInteger(inventory?.total_count) &&
    inventory.total_count > 0 && inventory.total_count <= 100 &&
    Array.isArray(jobs) && jobs.length === inventory.total_count &&
    jobs.every(job => Number.isSafeInteger(job.id) &&
      isUnstartedOrClassifierOnlyJob(job, runId))
}

async function pruneQueuedMasterCI({github, context, core, dryRun = false, maxCancels = 25}) {
  const {owner, repo} = context.repo
  invariant(owner === 'lazyxu' && repo === 'xdrive', 'not lazyxu/xdrive')
  invariant(Number.isSafeInteger(maxCancels) && maxCancels >= 1 && maxCancels <= 25, 'invalid cancellation budget')
  invariant(typeof dryRun === 'boolean', 'invalid dry-run argument')
  invariant(context.eventName === 'workflow_dispatch' || context.eventName === 'repository_dispatch', 'unsupported event')
  if (context.eventName === 'repository_dispatch') {
    invariant(context.payload?.action === 'xdrive_snapshot_published',
      'only the explicit Snapshot-published event may trigger automatic pruning')
    invariant(dryRun === true,
      'automatic Snapshot dispatch is audit-only; manual dispatch required to cancel')
  }

  // The source of truth is the current ref plus completed Release metadata,
  // never an untrusted event payload or an unconfirmed build artifact.
  const [releaseResponse, refResponse, masterResponse] = await Promise.all([
    github.rest.repos.getReleaseByTag({owner, repo, tag: 'snapshot'}),
    github.rest.git.getRef({owner, repo, ref: 'tags/snapshot'}),
    github.rest.repos.getBranch({owner, repo, branch: 'master'}),
  ])
  const release = releaseResponse.data
  const tag = refResponse.data
  const master = masterResponse.data
  invariant(release?.tag_name === 'snapshot' && release?.draft === false && release?.prerelease === true,
    'no published Snapshot prerelease')
  invariant(tag?.object?.type === 'commit' && SHA.test(tag.object.sha), 'Snapshot tag is not a commit')
  invariant(SHA.test(master?.commit?.sha), 'master head unavailable')
  const published = tag.object.sha
  const masterHead = master.commit.sha
  const match = String(release.body || '').match(OLD_RELEASE)
  invariant(match?.[1] === published && release.name === `xDrive snapshot ${published.slice(0, 12)}`,
    'Snapshot tag and verified Release notes disagree')
  const latestRelation = (await github.rest.repos.compareCommits({
    owner, repo, base: published, head: masterHead,
  })).data
  invariant(latestRelation.behind_by === 0 && ['ahead', 'identical'].includes(latestRelation.status),
    'Snapshot is not an ancestor of master')

  const all = []
  // Bounded discovery: do not issue unbounded scans when many old builds wait.
  for (let page = 1; page <= 2; page++) {
    const response = await github.rest.actions.listWorkflowRuns({
      owner, repo, workflow_id: 'ci.yml', branch: 'master', status: 'queued', page, per_page: 100,
    })
    const rows = response?.data?.workflow_runs
    invariant(Array.isArray(rows), 'invalid Actions run list')
    all.push(...rows)
    if (rows.length < 100) break
  }
  const candidates = all.filter(run =>
    Number.isSafeInteger(run.id) &&
    run.name === 'CI' &&
    run.event === 'push' &&
    run.head_branch === 'master' &&
    run.path === '.github/workflows/ci.yml' &&
    run.status === 'queued' &&
    // Re-runs retain the original 'push' event and SHA, but are manual evidence.
    run.run_attempt === 1 &&
    SHA.test(run.head_sha) &&
    run.head_sha !== published &&
    run.head_sha !== masterHead &&
    run.id !== context.runId,
  ).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  const ancestorCache = new Map()
  let eligible = 0
  let cancelled = 0
  const audit = []
  for (const run of candidates) {
    if (eligible >= maxCancels) break
    let isAncestor = ancestorCache.get(run.head_sha)
    if (isAncestor === undefined) {
      try {
        const relation = (await github.rest.repos.compareCommits({
          owner, repo, base: run.head_sha, head: published,
        })).data
        isAncestor = relation.behind_by === 0 && relation.status === 'ahead'
      } catch (error) {
        core.warning(`Preserving CI #${run.id}: ancestry check failed (${error.status || 'unknown'})`)
        isAncestor = false
      }
      ancestorCache.set(run.head_sha, isAncestor)
    }
    if (!isAncestor) continue
    const entry = {run_id: run.id, head_sha: run.head_sha, action: 'preserved'}

    // Before even reporting a dry-run candidate, re-read its exact run.
    // GitHub may retain 'queued' workflow status after child jobs have STARTED.
    let current
    try {
      current = (await github.rest.actions.getWorkflowRun({owner, repo, run_id: run.id})).data
    } catch (error) {
      if (error.status !== 404) throw error
      entry.action = 'preserved-gone'
      audit.push(entry)
      continue
    }
    if (current?.status !== 'queued' || current?.run_attempt !== 1 ||
      current?.head_sha !== run.head_sha ||
      current?.event !== 'push' || current?.head_branch !== 'master' ||
      current?.name !== 'CI' || current?.path !== '.github/workflows/ci.yml') {
      entry.action = 'preserved-changed'
      audit.push(entry)
      continue
    }

    // The WORKFLOW status alone does not prove that any job is unstarted.
    // Inspect every child job: a partial/unknown inventory fails closed.
    // Only queued jobs, conditionally skipped jobs and the completed read-only
    // pr-scope classifier qualify. Substantive test/build/publish successes,
    // failures, cancellations or in-progress jobs always preserve the run.
    let jobSnapshot
    try {
      jobSnapshot = (await github.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: run.id, per_page: 100,
      })).data
    } catch (error) {
      core.warning(`Preserving CI #${run.id}: child jobs unavailable (${error.status || 'unknown'})`)
      entry.action = 'preserved-jobs-unavailable'
      audit.push(entry)
      continue
    }
    if (!completeUnstartedInventory(jobSnapshot, run.id)) {
      entry.action = 'preserved-started-or-unknown-jobs'
      audit.push(entry)
      continue
    }
    eligible++
    if (dryRun) {
      entry.action = 'would-cancel'
      audit.push(entry)
      continue
    }

    // GitHub provides no atomic cancel-if-unstarted API. Revalidate the exact
    // run and every child job immediately before the manual cancellation.
    let immediate, finalInventory
    try {
      immediate = (await github.rest.actions.getWorkflowRun({
        owner, repo, run_id: run.id,
      })).data
      finalInventory = (await github.rest.actions.listJobsForWorkflowRun({
        owner, repo, run_id: run.id, per_page: 100,
      })).data
    } catch (error) {
      entry.action = 'preserved-final-recheck-unavailable'
      core.warning('Preserved CI #' + run.id + ': final run/job recheck unavailable')
      audit.push(entry)
      continue
    }
    const expectedIDs = new Set(jobSnapshot.jobs.map(job => job.id))
    if (immediate?.status !== 'queued' || immediate.run_attempt !== 1 ||
        immediate.head_sha !== run.head_sha || immediate.event !== 'push' ||
        immediate.head_branch !== 'master' || immediate.name !== 'CI' ||
        immediate.path !== '.github/workflows/ci.yml' ||
        !completeUnstartedInventory(finalInventory, run.id) ||
        finalInventory.total_count !== jobSnapshot.total_count ||
        finalInventory.jobs.some(job => !expectedIDs.has(job.id))) {
      entry.action = 'preserved-final-race'
      audit.push(entry)
      continue
    }
    try {
      await github.rest.actions.cancelWorkflowRun({owner, repo, run_id: run.id})
      entry.action = 'cancel-requested'
      cancelled++
    } catch (error) {
      if (error.status !== 409 && error.status !== 404) throw error
      entry.action = 'preserved-race'
    }
    audit.push(entry)
  }
  core.info(`Snapshot=${published} master=${masterHead} queued=${all.length} eligible=${eligible} cancellation_requests=${cancelled} dry_run=${dryRun}`)
  for (const entry of audit) core.info(`${entry.action} CI run=${entry.run_id} sha=${entry.head_sha}`)
  return {published, masterHead, observed: all.length, eligible, cancelled, dryRun, audit}
}

module.exports = {isUnstartedOrClassifierOnlyJob, completeUnstartedInventory, pruneQueuedMasterCI}
