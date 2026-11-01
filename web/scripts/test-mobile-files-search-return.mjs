import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../src/mobileFilesSearchReturn.ts'), 'utf8')
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(js.diagnostics?.length ?? 0, 0)
const nav = await import('data:text/javascript;base64,' +
  Buffer.from(js.outputText).toString('base64'))
const ownerA = 'https://example.test:1'
const ownerB = 'https://example.test:2'
const api = {}
const otherApi = {}
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), null)
nav.xDriveRememberMobileFilesSearchReturn(api, ownerA, '  sunset  ', {
  kind: 'image', sourceID: 3, tagID: 8,
}, 41)
assert.deepEqual(nav.xDriveReadMobileFilesSearchReturn(api, ownerA, 41), {
  query: 'sunset', filters: { kind: 'image', sourceID: 3, tagID: 8 },
  directoryID: 41,
}, 'same live Owner and directory restore query only')
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA, 42), null,
  'an explicit different directory route must override previous search')
assert.equal(nav.xDriveReadMobileFilesSearchReturn(otherApi, ownerA), null,
  'a new authenticated API session never inherits old search')
const returned = nav.xDriveReadMobileFilesSearchReturn(api, ownerA)
returned.filters.sourceID = 900
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA)?.filters.sourceID, 3,
  'caller cannot mutate a remembered filter snapshot')
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ''), null,
  'no unverified Owner read')
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerB), null,
  'different Owner rejects previous search')
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), null,
  'Owner A→B→A cannot revive a revoked session')
nav.xDriveRememberMobileFilesSearchReturn(api, ownerA, '', { tagID: 8 })
assert.deepEqual(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), {
  query: '', filters: { tagID: 8 }, directoryID: undefined,
}, 'filter-only confirmed searches are restorable')
nav.xDriveRememberMobileFilesSearchReturn(api, ownerA, '', {})
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), null,
  'clearing a confirmed search cannot revive it on tab return')
nav.xDriveRememberMobileFilesSearchReturn(api, ownerA, 't', { kind: 'image' })
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), null,
  'invalid one-character search is never remembered')
nav.xDriveRememberMobileFilesSearchReturn(api, ownerA, 'recent files', {}, 41)
nav.xDriveClearMobileFilesSearchReturn(api, ownerB)
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA)?.query,
  'recent files', 'wrong Owner cannot clear a new session')
nav.xDriveClearMobileFilesSearchReturn(api, ownerA)
assert.equal(nav.xDriveReadMobileFilesSearchReturn(api, ownerA), null,
  'current Owner explicit navigation clears obsolete search')

// Assert the real Web adapter owns the returning Search lifecycle. It must
// invoke the existing canonical applySearch rather than add a new REST reader.
const files = readFileSync(resolve(here, '../src/WebFileExplorer.tsx'), 'utf8')
const app = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
assert.match(app, /mobileOwnerScope=\{mobileOwnerScope\}/,
  'App must pass verified current Owner to the Files adapter')
assert.match(files, /if \(!compactMobile \|\| !mobileOwnerScope \|\| trashActive\) return/)
assert.match(files, /if \(initialRevealNodeID\) \{[\s\S]*?xDriveClearMobileFilesSearchReturn/,
  'trusted Show in Folder route wins over a saved search')
assert.match(files, /void applySearch\(saved.query, saved.filters\)/,
  'restored query reuses authenticated canonical Search Range')
assert.match(files, /last.ready\)[\s\S]*?xDriveRememberMobileFilesSearchReturn\(/,
  'only confirmed search results are saved on tab unmount')
assert.match(files, /last.api !== api \|\| last.owner !== mobileOwnerScope/,
  'previous Owner cannot write its data during account switch')
console.log('Mobile Files search reentry: real Owner/API, directory, filters and canonical read wiring passed')
