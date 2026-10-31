'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const yaml = fs.readFileSync(
  path.resolve(__dirname, '../../.github/workflows/prune-verified-branches.yml'), 'utf8')
const marker = '          script: |\n'
const offset = yaml.indexOf(marker)
assert.ok(offset > 0, 'trusted default-branch prune workflow exists')
const script = yaml.slice(offset + marker.length).split('\n')
  .map(line => line.startsWith('            ') ? line.slice(12) : line)
  .join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const prune = new AsyncFunction('github', 'context', 'core', script)

const repo = 'lazyxu/xdrive'
const merged = [
  {number: 3230, head: '14e3292057c3bc21f8a31e5b1d0173bdf1a0014a',
    merge: '97a488c30617a1b9940089bf0181b7851db11f92'},
  {number: 3240, head: '257b1b47aed27a87040fbac2e18b9ae0954e9de2',
    merge: '9969b948348ff1ae4ecf18fcee33ba66398f79ce'},
  {number: 3246, head: '7496e170f72411f79b05c2a9043142dbbd89d118',
    merge: '3bfd190275af05606d877576558cb90c0e5846c8'},
  // Synthetic post-merge receipts; real PR #3391/#3392 still require CI.
  {number: 3391, head: 'af37b139d2a6efc133c854081ec930d3ea7bb46f',
    merge: '1'.repeat(40)},
  {number: 3392, head: '869abc93b248eb45b8c3e13e80049a05d20fcea6',
    merge: '2'.repeat(40)},
]
const sources = [
  ['fix/files-cursor-cycle-guard-20261030',
    '0acf1e8df5a815a5b7001e17766c1d3f22fe120d', 3230],
  ['fix/files-readonly-abort-boundary-20261030',
    '4a2fc96ed6a698cd7e47355e1f86ecd5cff0f02d', 3230],
  ['fix/shared-virtual-range-window-integrity-20261030',
    '9071552f4cf88817e2d517a8f9c83248a164546c', 3240],
  ['fix/shared-virtual-snapshot-admission-20261030',
    'a3f4fed6cf972f731eecfe29a82581d72112bd4f', 3240],
  ['fix/files-preview-canonical-read-id-20261030',
    '6ba93902c6ad9b90965567626f4050cd13f52eec', 3246],
  ['fix/android-local-viewer-touch-focus-20261031',
    'af37b139d2a6efc133c854081ec930d3ea7bb46f', 3391],
  ['fix/android-cloud-viewer-touch-focus-20261031',
    '869abc93b248eb45b8c3e13e80049a05d20fcea6', 3392],
]
const authSource = ['fix/auth-login-drafts-mobile-20261031',
  '24c645cde141958e6490c4a21c149a96c76fc13c']
const shaF = 'f'.repeat(40)
const shaA = 'a'.repeat(40)

async function exercise({changedSource = null, missingMerge = null,
  wrongPRHead = null, missingMasterAncestor = null, wrongSourceAncestor = null,
  latePRHeadMove = null, openSource = null, dryRun = false,
  authTargetMerged = false} = {}) {
  const refs = new Map([['master', shaF]])
  for (const [name, sha] of sources) {
    refs.set(name, name === changedSource ? shaA : sha)
  }
  refs.set(authSource[0], changedSource === authSource[0] ? shaA : authSource[1])
  const deleted = []
  const pullReads = new Map()
  const get = branch => {
    if (!refs.has(branch)) {
      const error = new Error('missing branch')
      error.status = 404
      throw error
    }
    return {data: {commit: {sha: refs.get(branch)},
      protected: branch === 'master'}}
  }
  const rest = {
    repos: {
      listBranches: async () => ({data: []}),
      getBranch: async ({branch}) => get(branch),
      compareCommits: async ({base, head}) => {
        const target = merged.find(x => x.merge === base && head === 'master')
        if (target) return {data: missingMasterAncestor === target.number ?
          {status: 'diverged', ahead_by: 100, behind_by: 1} :
          {status: 'ahead', ahead_by: 100, behind_by: 0}}
        const source = sources.find(([, sha, number]) =>
          sha === base && merged.find(x => x.number === number).head === head)
        if (source) return {data: wrongSourceAncestor === source[0] ?
          {status: 'diverged', ahead_by: 1, behind_by: 1} :
          source[1] === head ?
            {status: 'identical', ahead_by: 0, behind_by: 0} :
            {status: 'ahead', ahead_by: 3, behind_by: 0}}
        return {data: {status: 'diverged', ahead_by: 2, behind_by: 200}}
      },
    },
    pulls: {
      list: async () => ({data: []}),
      get: async ({pull_number}) => {
        if (pull_number === 3382) return {data: {
          state: 'closed', merged_at: null,
          head: {ref: authSource[0], sha: authSource[1],
            repo: {full_name: repo}},
        }}
        if (pull_number === 3384) return {data: {
          merged_at: authTargetMerged ? '2026-10-31T20:00:00Z' : null,
          base: {ref: 'master'},
        }}
        const item = merged.find(x => x.number === pull_number)
        if (!item) return {data: {state: 'open', merged_at: null,
          head: {repo: {full_name: repo}}}}
        const reads = (pullReads.get(item.number) || 0) + 1
        pullReads.set(item.number, reads)
        const currentHead = wrongPRHead === item.number ||
          (latePRHeadMove === item.number &&
           reads > sources.filter(s => s[2] === item.number).length)
          ? shaA : item.head
        return {data: {
          merged_at: missingMerge === item.number ? null : '2026-10-30T05:00:00Z',
          merge_commit_sha: item.merge,
          base: {ref: 'master'},
          head: {sha: currentHead, repo: {full_name: repo}},
        }}
      },
    },
    issues: {
      get: async () => ({data: {state: 'open'}}),
      getComment: async () => ({data: {body: ''}}),
    },
    git: {deleteRef: async ({ref}) => {
      deleted.push(ref.replace(/^heads\//, ''))
    }},
  }
  const branches = [...refs.entries()].map(([name, sha]) => ({
    name, commit: {sha}, protected: name === 'master',
  }))
  const openPulls = openSource ? [{
    number: 99999,
    head: {ref: openSource, repo: {full_name: repo}},
    base: {ref: 'master', repo: {full_name: repo}},
  }] : []
  const github = {rest, paginate: async endpoint =>
    endpoint === rest.repos.listBranches ? branches : openPulls}
  const summary = {addHeading() {return this}, addRaw() {return this},
    addTable() {return this}, async write() {}}
  const core = {info() {}, summary}
  await prune(github, {repo: {owner: 'lazyxu', repo: 'xdrive'},
    eventName: dryRun ? 'workflow_dispatch' : 'schedule',
    payload: {inputs: {dry_run: dryRun ? 'true' : 'false'}}}, core)
  return deleted
}

test('seven exact source and alias tips require accepted merged PR heads', async () => {
  const deleted = await exercise()
  assert.deepEqual(new Set(deleted), new Set(sources.map(x => x[0])))
  assert.ok(!deleted.includes('master'))
})
test('unmerged consolidation PR is never enough to delete its sources', async () => {
  const deleted = await exercise({missingMerge: 3230})
  assert.deepEqual(new Set(deleted),
    new Set(sources.filter(x => x[2] !== 3230).map(x => x[0])))
})
test('moved historical PR head blocks matching source retirement', async () => {
  const deleted = await exercise({wrongPRHead: 3240})
  assert.deepEqual(new Set(deleted),
    new Set(sources.filter(x => x[2] !== 3240).map(x => x[0])))
})
test('unreachable master merge commit prevents source deletion', async () => {
  const deleted = await exercise({missingMasterAncestor: 3246})
  assert.ok(!deleted.includes(sources[4][0]))
  assert.equal(deleted.length, 6)
})
test('source commit missing from reviewed PR head is retained', async () => {
  const deleted = await exercise({wrongSourceAncestor: sources[0][0]})
  assert.ok(!deleted.includes(sources[0][0]))
  assert.equal(deleted.length, 6)
})
test('PR head movement just before deletion fails closed', async () => {
  const deleted = await exercise({latePRHeadMove: 3230})
  assert.deepEqual(new Set(deleted),
    new Set(sources.filter(x => x[2] !== 3230).map(x => x[0])))
})
test('advanced source branch and open PR head are not deleted', async () => {
  const changed = await exercise({changedSource: sources[0][0]})
  assert.ok(!changed.includes(sources[0][0]))
  const open = await exercise({openSource: sources[1][0]})
  assert.ok(!open.includes(sources[1][0]))
})
test('workflow dispatch dry run never deletes refs', async () => {
  assert.deepEqual(await exercise({dryRun: true}), [])
})

test('pending Android PRs preserve both identical source aliases', async () => {
  const first = await exercise({missingMerge: 3391})
  const second = await exercise({missingMerge: 3392})
  assert.ok(!first.includes(sources[5][0]))
  assert.ok(!second.includes(sources[6][0]))
})
test('PR head mismatch or late movement preserves identical alias', async () => {
  const wrong = await exercise({wrongPRHead: 3391})
  const changed = await exercise({latePRHeadMove: 3392})
  assert.ok(!wrong.includes(sources[5][0]))
  assert.ok(!changed.includes(sources[6][0]))
})

test('closed mobile login draft alias waits until cross-host PR is merged', async () => {
  const pending = await exercise()
  assert.ok(!pending.includes(authSource[0]))
  const integrated = await exercise({authTargetMerged: true})
  assert.ok(integrated.includes(authSource[0]))
  const advanced = await exercise({authTargetMerged: true,
    changedSource: authSource[0]})
  assert.ok(!advanced.includes(authSource[0]))
})
