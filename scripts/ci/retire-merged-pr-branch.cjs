'use strict'

// Trusted default-branch code only. A merged PR's head SHA is evidence for
// one branch tip, not authority to delete whichever branch happens to exist.
const shaPattern = /^[0-9a-f]{40}$/
function safeBranchName(value) {
  return typeof value === 'string' && value !== 'master' &&
    value.length > 0 && value.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes('..') && !value.endsWith('.') && !value.endsWith('/') &&
    value.split('/').every(part => part && !part.startsWith('.') &&
      !part.endsWith('.lock'))
}

async function retireMergedPRBranch({ github, context, deleteExact }) {
  const { owner, repo } = context.repo
  const repository = owner + "/" + repo
  const event = context.payload?.pull_request
  if (context.eventName !== 'pull_request_target' ||
      context.payload?.action !== 'closed' || !event?.merged ||
      event.base?.ref !== 'master' ||
      event.head?.repo?.full_name !== repository) {
    return { reason: 'ineligible_event', deleted: false }
  }
  const branch = event.head?.ref
  const sha = event.head?.sha
  if (!safeBranchName(branch) || !shaPattern.test(sha ?? '')) {
    return { reason: 'unsafe_ref', deleted: false }
  }
  if (!Number.isSafeInteger(event.number) || event.number < 1) {
    return { reason: 'invalid_pr', deleted: false }
  }

  // Recheck live PR state, not just caller-controlled event payload fields.
  const { data: live } = await github.rest.pulls.get({
    owner, repo, pull_number: event.number,
  })
  if (!live?.merged_at || live.state !== 'closed' ||
      live.base?.ref !== 'master' ||
      live.head?.repo?.full_name !== repository ||
      live.head?.ref !== branch || live.head?.sha !== sha) {
    return { reason: 'pr_changed', branch, deleted: false }
  }

  // Open stacked PRs protect BOTH head and base branch names. Failure to
  // collect the complete list is fatal, never interpreted as no open PRs.
  const open = await github.paginate(github.rest.pulls.list, {
    owner, repo, state: 'open', per_page: 100,
  })
  if (!Array.isArray(open) || open.some(pr => !pr || !pr.head || !pr.base)) {
    throw new Error('Unverifiable open PR snapshot: refusing branch deletion')
  }
  if (open.some(pr =>
    (pr.head?.repo?.full_name === repository && pr.head.ref === branch) ||
    (pr.base?.repo?.full_name === repository && pr.base.ref === branch)
  )) {
    return { reason: 'active_pr_head_or_base', branch, deleted: false }
  }

  let remote
  try {
    const response = await github.rest.repos.getBranch({ owner, repo, branch })
    remote = response.data
  } catch (error) {
    if (error?.status === 404) {
      return { reason: 'already_removed', branch, deleted: false }
    }
    throw error
  }
  if (!remote || remote.protected || remote.commit?.sha !== sha) {
    return { reason: 'remote_head_changed_or_protected', branch, deleted: false }
  }

  // The caller uses a Git --force-with-lease delete, never REST deleteRef:
  // an advanced remote HEAD must atomically fail, even after getBranch.
  const success = await deleteExact({ branch, sha })
  return {
    reason: success ? 'deleted_exact_merged_head' : 'lease_rejected',
    branch, deleted: success === true,
  }
}

module.exports = { safeBranchName, retireMergedPRBranch }
