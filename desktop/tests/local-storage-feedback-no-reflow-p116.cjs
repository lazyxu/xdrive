'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer
const root = path.resolve(__dirname, '../..')
const sourceFile = path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx')
const source = fs.readFileSync(sourceFile, 'utf8')
const js = ts.transpileModule(source, { fileName:sourceFile, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022,
  jsx:ts.JsxEmit.ReactJSX, esModuleInterop:true,
} }).outputText
// A default JSX import needs a React-valid host component, not a Proxy object.
const icons = 'icon'
const mocks = {
  react: React, 'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/icons-material/DeleteSweepRounded':icons,
  '@mui/icons-material/ExpandMoreRounded':icons,
  '@mui/icons-material/ChevronRightRounded':icons,
  '@mui/icons-material/FolderRounded':icons,
  '@mui/icons-material/RefreshRounded':icons,
  '@mui/material': Object.fromEntries(
    ['Box','Chip','IconButton','Stack','Typography'].map(name=>[name,name.toLowerCase()])),
  '../format':{formatBytes:n=>String(n)+' B'},
  './ActionButton':{XDriveActionButton:'action-button'},
  './ConfirmDialog':{XDriveConfirmDialog:'confirm-dialog'},
  './MetricCards':{XDriveMetricCard:'metric-card',XDriveMetricGrid:'metric-grid'},
  './SectionHeader':{XDriveSectionHeader:'section-header'},
  './StatePanel':{XDriveStatePanel:'state-panel'},
  './StatusAlert':{XDriveStatusAlert:'status-alert'},
  './WorkspaceSurface':{XDriveWorkspaceSurface:'workspace-surface'},
}
const mod = new Module(sourceFile,module)
mod.filename = sourceFile
mod.paths = Module._nodeModulePaths(path.join(root,'desktop'))
const originalRequire = mod.require.bind(mod)
mod.require = name=>Object.hasOwn(mocks,name) ? mocks[name] : originalRequire(name)
mod._compile(js,sourceFile)
const Page = mod.exports.XDriveLocalStoragePage
const data={browserStorage:{
  supported:true,clear_supported:true,cache_bytes:32,cache_entries:1,
  total_used_bytes:100,quota_bytes:1000,scope_label:'验收缓存',
},desktopStorage:null}
const marked=(view,key)=>view.root.findAll(node=>node.props?.[key]!==undefined)
const elements=(view,type)=>view.root.findAll(node=>node.type===type)
const originalMetric=(view)=>elements(view,'metric-card').find(x=>x.props.title==='站点总占用')
const refresh=(view)=>{
  const surface=elements(view,'workspace-surface')[0]
  assert.ok(surface,'actual page must keep its shared workspace owner')
  return surface.props.pageActions
}
test('P116 actual Local Storage snapshot never remounts or moves its metric owner on late failed refresh and success', async()=>{
  let reads=0,view
  const adapter={
    load: async()=>{reads++;if(reads===2)throw Error('后台刷新失败');return data},
    clearBrowserCache:async()=>({released_bytes:16,cleared_entries:1}),
  }
  try{
    await act(async()=>{view=TestRenderer.create(React.createElement(Page,{source:adapter}));await Promise.resolve()})
    assert.equal(reads,1)
    assert.equal(marked(view,'data-xdrive-local-storage-loading-slot').length,0)
    const metric=originalMetric(view)
    assert.ok(metric,'accepted metric card is the permanent geometry owner')
    await act(async()=>{refresh(view).props.onClick();await Promise.resolve()})
    assert.equal(reads,2)
    assert.equal(originalMetric(view),metric,'failure must not replace the original metric')
    const float=marked(view,'data-xdrive-local-storage-floating-feedback')[0]
    const error=marked(view,'data-xdrive-local-storage-refresh-error')[0]
    assert.ok(float && error,'real refresh error remains visible')
    assert.equal(float.props.sx.position,'fixed')
    assert.equal(float.props.sx.pointerEvents,'none')
    assert.match(float.props.sx.bottom,/safe-area-inset-bottom/)
    assert.equal(error.props.role,'alert')
    assert.equal(marked(view,'data-xdrive-local-storage-first-read-error').length,0)
    const clear=elements(view,'action-button').find(x=>x.props.children==='清理浏览器缓存')
    assert.ok(clear)
    await act(async()=>{clear.props.onClick()})
    const confirm=elements(view,'confirm-dialog')[0]
    assert.equal(confirm.props.open,true)
    await act(async()=>{confirm.props.onConfirm();await Promise.resolve()})
    assert.equal(reads,3)
    assert.equal(originalMetric(view),metric,'operation receipt cannot remount the snapshot')
    assert.equal(marked(view,'data-xdrive-local-storage-refresh-error').length,0)
    const note=marked(view,'data-xdrive-local-storage-operation-notice')[0]
    assert.ok(note)
    assert.equal(note.props.role,'status')
    assert.equal(note.props['aria-live'],'polite')
    const success=elements(view,'status-alert').find(node=>node.props.tone==='good')
    assert.ok(success,'original successful cache operation still renders its status alert')
    assert.match(String(success.props.children),/已清理浏览器缓存/,
      'inspect actual rendered receipt text, never stringify React elements with circular Fiber ownership')
  } finally {if(view)await act(async()=>{view.unmount()})}
})
test('P116 real cold-read error retains the original 180px slot and cannot invent content',async()=>{
  let view
  try{
    await act(async()=>{view=TestRenderer.create(React.createElement(Page,{
      source:{load:async()=>{throw Error('首次读取失败')}},
    }));await Promise.resolve()})
    const error=marked(view,'data-xdrive-local-storage-first-read-error')[0]
    assert.ok(error)
    assert.equal(error.props.sx.minHeight,180)
    assert.equal(marked(view,'data-xdrive-local-storage-floating-feedback').length,0)
    assert.equal(elements(view,'metric-card').length,0)
    assert.equal(elements(view,'status-alert').length,1)
  } finally {if(view)await act(async()=>{view.unmount()})}
})
test('P116 original source and AGENTS prohibit async Storage feedback above accepted content',()=>{
  const rootAgents=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8')
  assert.equal(rootAgents.split('## P116 · Local Storage async feedback must never resize accepted page geometry').length,2)
  const owner=source.indexOf('data-xdrive-local-storage-floating-feedback')
  const first=source.indexOf('data-xdrive-local-storage-first-read-error')
  const cards=source.indexOf('<XDriveMetricGrid>')
  assert.ok(owner>first && cards>owner)
  assert.ok(source.includes("position: 'fixed'"))
  assert.ok(source.includes('data-xdrive-local-storage-refresh-error'))
  assert.ok(source.includes('data-xdrive-local-storage-operation-notice'))
  assert.ok(source.includes('aria-live="polite"'))
  assert.ok(source.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.equal(source.includes('<XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert>'),false)
  assert.equal(source.includes('<XDriveStatusAlert tone="good" sx={{ mb: 2 }}>{notice}</XDriveStatusAlert>'),false)
})
