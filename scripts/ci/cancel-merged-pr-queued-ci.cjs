'use strict'

// Invoked only by the trusted default-branch pull_request_target cleanup job.
// Never use PR checkout code or PR body text to decide an Actions mutation.
async function cancelMergedPRQueuedCI({github, context}) {
  const {owner, repo} = context.repo
  const fullRepo = owner + '/' + repo
  const eventPR = context.payload?.pull_request
  if (context.eventName !== 'pull_request_target' ||
      context.payload?.action !== 'closed' || eventPR?.merged !== true ||
      eventPR?.base?.ref !== 'master' ||
      eventPR?.head?.repo?.full_name !== fullRepo ||
      !Number.isSafeInteger(eventPR.number) ||
      !/^[0-9a-f]{40}$/.test(eventPR.head?.sha || '')) {
    return {reason: 'not-an-authorized-merged-PR', cancelled: [], examined: 0}
  }

  // Re-read the PR from GitHub rather than trusting a potentially stale event.
  const {data: current} = await github.rest.pulls.get({
    owner, repo, pull_number: eventPR.number,
  })
  const sha = eventPR.head.sha
  const branch = eventPR.head.ref
  if (current?.state !== 'closed' || !current.merged_at ||
      current?.base?.ref !== 'master' ||
      current?.head?.repo?.full_name !== fullRepo ||
      current.head.sha !== sha || current.head.ref !== branch) {
    return {reason: 'live-merged-PR-head-differs', cancelled: [], examined: 0}
  }

  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    owner, repo, head_sha: sha, event: 'pull_request', status: 'queued',
    per_page: 100,
  })
  if (!Array.isArray(runs)) {
    throw new Error('Invalid queued workflow run inventory')
  }

  const cancelled = []
  for (const candidate of runs) {
    if (!isExactQueuedCI(candidate, sha, branch)) continue
    const {data: live} = await github.rest.actions.getWorkflowRun({
      owner, repo, run_id: candidate.id,
    })
    if (!isExactQueuedCI(live, sha, branch)) continue
    try {
      await github.rest.actions.cancelWorkflowRun({
        owner, repo, run_id: candidate.id,
      })
      cancelled.push(candidate.id)
    } catch (error) {
      // A run can finish naturally between re-reading its state and cancel.
      if (error?.status !== 409 && error?.status !== 422) throw error
    }
  }
  return {reason: 'merged-PR-exact-head', cancelled, examined: runs.length}
}

function isExactQueuedCI(run, sha, branch) {
  return run && Number.isSafeInteger(run.id) && run.id > 0 &&
    run.name === 'CI' && run.path === '.github/workflows/ci.yml' &&
    run.event === 'pull_request' && run.head_sha === sha &&
    run.head_branch === branch &&
    run.status === 'queued' && run.conclusion == null
}

module.exports = {cancelMergedPRQueuedCI, isExactQueuedCI}
