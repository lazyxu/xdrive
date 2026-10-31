'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.resolve(__dirname, '../../.github/workflows/prune-verified-branches.yml'), 'utf8')
const marker = '          script: |\n'
const start = source.indexOf(marker)
assert.ok(start > 0, 'trusted prune workflow must contain its script')
const script = source.slice(start + marker.length).split('\n')
  .map(line => line.startsWith('            ') ? line.slice(12) : line)
  .join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const prune = new AsyncFunction('github', 'context', 'core', script)

const repo = 'lazyxu/xdrive'
const master = 'f'.repeat(40)
const ancestors = [
  ['fix/files-owner-root-quota-admission-20261030',
    '284b086560a9b489aff6d34cf013d08a5dea0876',
    'fix/files-owner-read-admission-consolidated-20261030',
    '0ed94690a3e9eaea0aa415ef92c0c1deef3dee5a'],
  ['fix/files-owner-search-sources-admission-20261030',
    '940128fd536d6b2869bde56c88a8f373bb306e76',
    'fix/files-owner-read-admission-consolidated-20261030',
    '0ed94690a3e9eaea0aa415ef92c0c1deef3dee5a'],
  ['fix/files-exact-reanchor-row-identity-20261030',
    'e8d073cc184f84398cd4599d3e0b7e584d1702f8',
    'refactor/files-shared-location-ancestors-20261030',
    '81448e43567d9949e14fdb7d514b8f411a3d9571'],
  ['refactor/files-shared-reveal-lifecycle-20261030',
    'e33567770ff7c517f8f1cb707a4b72f016b0948a',
    'refactor/files-shared-location-ancestors-20261030',
    '81448e43567d9949e14fdb7d514b8f411a3d9571'],
]

async function exercise({changedTarget = null, changedSource = null,
  noAncestry = false, openSource = null, dryRun = false,
  lateTargetMove = null} = {}) {
  const refs = new Map([['master', master]])
  for (const [name, sha, target, targetSha] of ancestors) {
    refs.set(name, name === changedSource ? 'a'.repeat(40) : sha)
    refs.set(target, target === changedTarget ? 'b'.repeat(40) : targetSha)
  }
  const branches = [...refs.entries()].map(([branch, sha]) => ({
    name: branch, commit: {sha}, protected: branch === 'master',
  }))
  const openPulls = openSource ? [{
    number: 99999,
    head: {ref: openSource, repo: {full_name: repo}},
    base: {ref: 'master', repo: {full_name: repo}},
  }] : []
  const deleted = []
  const targetReads = new Map()
  const get = (branch) => {
    if (branch === lateTargetMove) {
      const calls = (targetReads.get(branch) || 0) + 1
      targetReads.set(branch, calls)
      if (calls >= 2) refs.set(branch, 'b'.repeat(40))
    }
    if (!refs.has(branch)) {
      const error = new Error('missing branch')
      error.status = 404
      throw error
    }
    return {data: {commit: {sha: refs.get(branch)}, protected: branch === 'master'}}
  }
  const rest = {
    repos: {
      listBranches() {},
      getBranch: async ({branch}) => get(branch),
      compareCommits: async ({base, head}) => {
        if (base === 'master') return {data: {ahead_by: 3, behind_by: 500, status: 'diverged'}}
        const covered = ancestors.some(([,sha,,targetSha]) => base === sha && head === targetSha)
        return {data: covered && !noAncestry ?
          {ahead_by: 2, behind_by: 0, status: 'ahead'} :
          {ahead_by: 3, behind_by: 1, status: 'diverged'}}
      },
    },
    pulls: {
      list: async () => ({data: []}),
      get: async () => ({data: {state: 'open', merged_at: null,
        head: {repo: {full_name: repo}}}}),
    },
    issues: {
      get: async () => ({data: {state: 'open'}}),
      getComment: async () => ({data: {body: ''}}),
    },
    git: {deleteRef: async ({ref}) => {
      deleted.push(ref.replace(/^heads\//, ''))
    }},
  }
  const github = {
    rest,
    paginate: async endpoint => endpoint === rest.repos.listBranches ? branches : openPulls,
  }
  const summary = {
    addHeading() {return this},
    addRaw() {return this},
    addTable() {return this},
    async write() {},
  }
  const core = {info() {}, summary}
  await prune(github, {repo: {owner: 'lazyxu', repo: 'xdrive'},
    eventName: dryRun ? 'workflow_dispatch' : 'schedule',
    payload: {inputs: {dry_run: dryRun ? 'true' : 'false'}}}, core)
  return deleted
}

test('exact development-ancestor tips prune only four source branches', async () => {
  const deleted = await exercise()
  assert.deepEqual(new Set(deleted), new Set(ancestors.map(a => a[0])))
  assert.ok(!deleted.includes('master'))
  for (const a of ancestors) assert.ok(!deleted.includes(a[2]))
})
test('a moved retained development head protects both of its ancestors', async () => {
  const deleted = await exercise({changedTarget: ancestors[0][2]})
  assert.deepEqual(new Set(deleted), new Set(ancestors.slice(2).map(a => a[0])))
})
test('target changing between evidence and final delete refuses stale source', async () => {
  const deleted = await exercise({lateTargetMove: ancestors[0][2]})
  assert.deepEqual(new Set(deleted), new Set(ancestors.slice(2).map(a => a[0])))
})
test('ancestry failure rejects all development-only deletions', async () => {
  assert.deepEqual(await exercise({noAncestry: true}), [])
})
test('changed source SHA is never retired by its historical evidence', async () => {
  const deleted = await exercise({changedSource: ancestors[0][0]})
  assert.equal(deleted.length, 3)
  assert.ok(!deleted.includes(ancestors[0][0]))
})
test('an open PR source head is protected even with exact ancestry', async () => {
  const deleted = await exercise({openSource: ancestors[1][0]})
  assert.equal(deleted.length, 3)
  assert.ok(!deleted.includes(ancestors[1][0]))
})
test('dry-run never deletes any branch', async () => {
  assert.deepEqual(await exercise({dryRun: true}), [])
})
