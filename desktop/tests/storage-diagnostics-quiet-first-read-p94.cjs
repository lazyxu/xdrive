'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('ui/shared/src/mui/GlobalStorageStatsPage.tsx')
test('P94 three original Global Storage diagnostic first reads stay silent and fixed before/after 300ms',()=>{
 for(const [slot,err,loading] of [['cleanup-failures','cleanupFailureErrors','cleanupFailureLoading'],['unreferenced','unreferencedReadError','unreferencedLoading'],['legacy','legacyReadError','legacyLoading']]){
  const key='data-xdrive-storage-'+slot+'-first-read',pos=source.indexOf(key)
  assert.ok(pos>0,key)
  const block=source.slice(pos,pos+800)
  for(const expect of ['aria-busy=',err,loading,'minHeight: 160','role="alert"','minHeight: 44, minWidth: 44','>重试</Button>'])assert.ok(block.includes(expect),slot+': '+expect)
 }
 for(const forbid of ['正在加载失败文件…','正在加载待 GC Blob…','正在加载 legacy 对象…'])assert.ok(!source.includes(forbid),'no decorative first-read loader '+forbid)
})
test('P94 cold/error/short accepted diagnostic pages share one 192px outer minimum with fixed 16px vertical padding',()=>{
 assert.equal(source.split('<AccordionDetails sx={{ minHeight: 192, py: 2 }}>').length-1,3)
})
test('P94 real failure/retry and verified page receipts remain, with no false first-empty',()=>{
 for(const label of ['cleanupFailures[run.id] === undefined ? (','setCleanupFailureErrors(current => ({ ...current, [run.id]: message }))','setLegacyReadError(message)','setUnreferencedReadError(message)',"setCleanupFailureErrors({})","setLegacyReadError('')","setUnreferencedReadError('')",'onClick={() => void loadCleanupFailures(run)}','onClick={() => void loadLegacyPage(1)}','onClick={() => void loadUnreferencedPage(1)}','api.adminStagingCleanupFailures(run.id, 100, 0)','api.adminStorageUnreferencedBlobs(STORAGE_DIAGNOSTIC_PAGE_SIZE, cursor)','api.adminStorageLegacyObjects(STORAGE_DIAGNOSTIC_PAGE_SIZE, cursor)'])assert.ok(source.includes(label),label)
 for(const slot of ['legacy','unreferenced']){
  const start=source.indexOf('data-xdrive-storage-'+slot+'-first-read'),end=source.indexOf('</AccordionDetails>',start),jsx=source.slice(start,end)
  assert.ok(jsx.includes('aria-busy={'+slot+'Loading || undefined}'))
  assert.ok(jsx.includes('loading={'+slot+'Loading}'))
  assert.ok(!jsx.includes('<LinearProgress />'),'pagination must not insert an in-flow row')
 }
 const agents=read('AGENTS.md')
 assert.equal(agents.split('Permanent no-jitter contract / P78').length,2)
 assert.equal(agents.split('P94 silent Global Storage diagnostic first-read (mandatory)').length,2)
 assert.ok(read('web/src/StorageStatsPanel.tsx').includes('XDriveGlobalStorageStatsPage'))
 assert.ok(read('desktop/src/renderer/App.tsx').includes('XDriveGlobalStorageStatsPage'))
})
