const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const code = ts.transpileModule(read('ui/shared/src/server-backup-snapshot-query.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
new Function('exports', code)(exportsObject)
const query = exportsObject.filterServerBackupSnapshots
const make = (id, format, state, file_data_included, created_at) => ({
  id, name: 'xdrive-backup-' + id, format, state, file_data_included, created_at,
})
const snapshots = Object.freeze([
  make('a','v1','complete',true,'2026-10-25T09:00:00Z'),
  make('b','v1','complete',false,'2026-10-26T09:00:00Z'),
  make('c','v2','complete',true,'2026-10-27T09:00:00Z'),
  make('d','v2','inconsistent',true,'2026-10-28T09:00:00Z'),
  make('e','v2','incomplete',true,'2026-10-29T09:00:00Z'),
])
const options = { query: '', format: 'all', repository: 'all', status: 'all', order: 'newest' }
const ids = x => x.map(y => y.id)

test('scoped search and order never mutate the authenticated Host inventory', () => {
  assert.deepEqual(ids(query(snapshots, options)), ['e','d','c','b','a'])
  assert.deepEqual(ids(query(snapshots, {...options, order:'oldest'})), ['a','b','c','d','e'])
  assert.deepEqual(ids(query(snapshots, {...options, query:' BACKUP-C '})), ['c'])
  assert.deepEqual(ids(snapshots), ['a','b','c','d','e'])
  assert.deepEqual(ids(query([], options)), [])
})

test('only complete file+database candidates receive recoverable structural classification', () => {
  assert.deepEqual(ids(query(snapshots,{...options,status:'recoverable'})), ['c','a'])
  assert.deepEqual(ids(query(snapshots,{...options,status:'database_only'})), ['b'])
  assert.deepEqual(ids(query(snapshots,{...options,status:'incomplete'})), ['e'])
  assert.deepEqual(ids(query(snapshots,{...options,status:'inconsistent'})), ['d'])
  assert.deepEqual(ids(query(snapshots,{...options,status:'recoverable',format:'v2'})), ['c'])
})

test('shared backup UI does not permit Restore/Delete of hidden previous selection', () => {
  const ui = read('ui/shared/src/mui/ServerBackupManagementPanel.tsx')
  assert.match(ui, /data-xdrive-admin-backup-snapshot-filters/)
  assert.match(ui, /data-xdrive-admin-backup-filter-count/)
  assert.match(ui, /const selected = visibleSnapshots.find\(item => item.id === snapshotID\)/)
  assert.match(ui, /visibleSnapshots.map\(item =>/)
  assert.match(ui, /setSnapshotFilter\(previous => \(\{ \.\.\.previous, \.\.\.patch \}\)\)/)
  assert.match(ui, /筛选只作用于宿主机提供的最新最多 100 代清单/)
  assert.match(ui, /disabled=\{disabled \|\| !selectedRestorable\}/)
  assert.match(ui, /selectedPreviewReady = Boolean\(selected && selectedPreview/)
  assert.match(ui, /setSelectedPreviewRequestID\(''\)/)
  assert.match(ui, /snapshotID=\{selected\?\.id \|\| ''\}/)
})

test('fixed Host repository namespace filters v1, default-v2 and configured-v2 without path inputs', () => {
  const rows = Object.freeze([
    make('v1:xdrive-backup-20261001T010101Z', 'v1', 'complete', true, '2026-10-01T01:01:01Z'),
    make('v2-default:xdrive-backup-20261002T010101Z', 'v2', 'incomplete', true, '2026-10-02T01:01:01Z'),
    make('v2-configured:xdrive-backup-20261003T010101Z', 'v2', 'complete', true, '2026-10-03T01:01:01Z'),
    make('v2-default:xdrive-backup-20261004T010101Z', 'v2', 'complete', true, '2026-10-04T01:01:01Z'),
  ])
  const pick = repository => ids(query(rows, { ...options, repository }))
  assert.deepEqual(pick('v1'), [rows[0].id])
  assert.deepEqual(pick('v2-default'), [rows[3].id, rows[1].id])
  assert.deepEqual(pick('v2-configured'), [rows[2].id])
  assert.deepEqual(pick('all'), [rows[3].id, rows[2].id, rows[1].id, rows[0].id])
  assert.deepEqual(ids(query(rows, {...options, repository:'v2-configured', format:'v1'})), [])
  assert.deepEqual(ids(query(rows, {...options, repository:'v2-configured', status:'recoverable'})), [rows[2].id])
  assert.deepEqual(ids(rows), rows.map(x => x.id)) // read-only, no in-place sort
})

test('repository selection shares filter fence and never grants hidden snapshot actions', () => {
  const page = read('ui/shared/src/mui/ServerBackupManagementPanel.tsx')
  const inventory = read('ui/shared/src/mui/BackupRepositoryInventory.tsx')
  const selector = read('ui/shared/src/server-backup-snapshot-query.ts')
  assert.match(page, /label="仓库" value=\{snapshotFilter\.repository\}/)
  assert.match(page, /repository: event\.target\.value as XDriveServerBackupSnapshotFilter\['repository'\]/)
  assert.match(page, /onSelectRepository=\{repository => changeSnapshotFilter\(\{ repository \}\)\}/)
  assert.match(page, /const selected = visibleSnapshots\.find\(item => item\.id === snapshotID\)/)
  assert.match(page, /const changeSnapshotFilter = \(patch:[\s\S]{0,260}setConfirmation\(null\)/)
  assert.match(page, /setSelectedPreviewRequestID\(''\)/)
  assert.match(inventory, /data-xdrive-admin-backup-repository-filter/)
  assert.match(inventory, /onClick=\{\(\) => onSelectRepository\(item\.id\)\}/)
  assert.match(inventory, /仅作用于最近最多 100 代/)
  assert.match(selector, /item\.id\.startsWith\(filter\.repository \+ ':'\)/)
  assert.doesNotMatch(inventory, /onDeleteRepository|onEditRepository|onRestoreRepository/)
})
