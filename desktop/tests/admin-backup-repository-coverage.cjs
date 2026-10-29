const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/server-backup-repository-coverage.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
new Function('exports', compiled)(exported)
const summarize = exported.summarizeServerBackupRepositoryCoverage
const id = (repo, n) => `${repo}:xdrive-backup-202610${String(n).padStart(2,'0')}T010203Z`
const snap = (repo,n,state='complete',full=true) => ({
  id:id(repo,n),name:`xdrive-backup-202610${String(n).padStart(2,'0')}T010203Z`,
  format:repo==='v1'?'v1':'v2',state,file_data_included:full,
})
const inventory = Object.freeze({
  total_snapshots:8,
  repositories:[{id:'v1',snapshot_count:3},{id:'v2-default',snapshot_count:4},{id:'v2-configured',snapshot_count:1}],
  snapshots:[snap('v1',1),snap('v1',2,'complete',false),snap('v2-default',3),
    snap('v2-default',4,'incomplete'),snap('v2-configured',5,'inconsistent')],
})
test('three namespaces: all-generation counts and newest-100 structural evidence stay separate', () => {
  const coverage = summarize(inventory)
  assert.deepEqual(coverage.map(x=>x.id),['v1','v2-default','v2-configured'])
  assert.deepEqual(coverage.map(x=>x.unlisted),[1,2,0])
  assert.deepEqual(coverage.map(x=>x.listed),[2,2,1])
  assert.deepEqual(coverage.map(x=>x.completeFiles),[1,1,0])
  assert.deepEqual(coverage.map(x=>x.databaseOnly),[1,0,0])
  assert.deepEqual(coverage.map(x=>x.incomplete),[0,1,0])
  assert.deepEqual(coverage.map(x=>x.inconsistent),[0,0,1])
  assert.equal(inventory.snapshots.length,5)
})
test('empty and older-only namespaces cannot be falsely marked verified',()=>{
  const rows = summarize({...inventory,snapshots:[],total_snapshots:5,
    repositories:[{id:'v1',snapshot_count:3},{id:'v2-default',snapshot_count:2},{id:'v2-configured',snapshot_count:0}]})
  assert.deepEqual(rows.map(x=>x.unlisted),[3,2,0])
  assert.deepEqual(rows.map(x=>x.completeFiles),[0,0,0])
  assert.deepEqual(rows.map(x=>x.listed),[0,0,0])
})
test('fail closed on forged counts, inconsistent identity, duplicate and unbounded input',()=>{
  const invalid = [
    {...inventory,total_snapshots:7},
    {...inventory,total_snapshots:undefined},
    {...inventory,total_snapshots:Infinity},
    {...inventory,repositories:undefined},
    {...inventory,repositories:[...inventory.repositories.slice(0,2),{id:'v2-configured',snapshot_count:0}]},
    {...inventory,snapshots:[...inventory.snapshots,inventory.snapshots[0]]},
    {...inventory,snapshots:[...inventory.snapshots,{...snap('v1',6),id:'v1:../../etc'}]},
    {...inventory,snapshots:[...inventory.snapshots,{...snap('v1',6),format:'v2'}]},
    {...inventory,snapshots:[...inventory.snapshots,snap('v2-configured',6,'complete',false)]},
    {...inventory,snapshots:[...inventory.snapshots,{...snap('v2-default',6),state:'unknown'}]},
    {...inventory,snapshots:Array.from({length:101},(_,n)=>snap('v1',(n%28)+1))},
  ]
  for (const candidate of invalid) assert.equal(summarize(candidate),null)
})
test('canonical shared repository table never promotes structural state to current backup health', () => {
  const ui = fs.readFileSync(path.join(root, 'ui/shared/src/mui/BackupRepositoryInventory.tsx'), 'utf8')
  assert.match(ui, /summarizeServerBackupRepositoryCoverage\(inventory\)/)
  assert.match(ui, /data-xdrive-backup-repository-listed/)
  assert.match(ui, /data-xdrive-backup-repository-unlisted/)
  assert.match(ui, /data-xdrive-backup-repository-structure/)
  assert.match(ui, /结构状态仅覆盖最新最多 100 代/)
  assert.match(ui, /不等于通过当前 SHA-256 校验或恢复演练/)
  assert.match(ui, /onClick=\{\(\) => onSelectRepository\(item.id\)\}/)
  assert.doesNotMatch(ui, /onRestoreRepository|onDeleteRepository|onEditRepository/)
})
