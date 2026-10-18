const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const {act} = Renderer
const root=path.resolve(__dirname,'../..')
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8')

const file='ui/shared/src/mui/SourceManagerListPage.tsx'
const code=ts.transpileModule(read(file),{
  fileName:path.join(root,file),
  compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
  },
}).outputText
const dependencies={
  'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/icons-material/AddRounded':'add-icon',
  '@mui/icons-material/RefreshRounded':'refresh-icon',
  '@mui/material':{Box:'box',Button:'button',Stack:'stack',Tooltip:'tooltip'},
  './ActionButton':{XDriveActionButton:'action-button'},
  './SourceKindIcon':{XDriveSourceKindIcon:'source-icon'},
  './SourceSummaryCard':{XDriveSourceSummaryCard:'source-card'},
  './StatePanel':{XDriveStatePanel:'state-panel'},
  './StatusAlert':{XDriveStatusAlert:'status-alert'},
  './WorkspaceSurface':{XDriveWorkspaceSurface:'workspace-surface'},
  '../external-sources':{
    externalSourceCardView:()=>({
      connector:{label:'Synology Photos'},modeLabel:'备份',
      state:{tone:'good',label:'可用'},
      lastActivityLabel:'最近运行',lastActivityAt:null,
      trigger:{ready:true,label:'可手动运行'},
    }),
    externalSourceConnectorProfile:()=>({manualTriggerExecutor:'server'}),
    externalSourceDisplayName:source=>source.name,
    externalSourceTriggerActionLabel:()=> '立即运行',
    formatExternalSourceTime:()=> '—',
  },
  '../format':{formatBytes:n=>String(n)+' B'},
}
const mod={exports:{}}
new Function('exports','module','require',code)(mod.exports,mod,name=>{
  if(!Object.hasOwn(dependencies,name))throw Error('Unexpected UI dependency: '+name)
  return dependencies[name]
})
const Page=mod.exports.XDriveSourceManagerListPage
const item={source:{
  id:42,name:'已授权同步文件夹',kind:'synology_photos',
  direction:'pull',sync_mode:'backup',run_mode:'sync',status:'active',
},latestRun:null}
function base(overrides={}){
  return {
    rows:[],loading:true,hasLoaded:false,loadError:false,
    showDelayedLoading:false,failedItemsLoading:false,
    triggeringSourceID:null,cancellingRunID:null,
    onRefresh:()=>{},onAdd:()=>{},onOpenError:()=>{},
    onOpenDetails:()=>{},onOpenSynologyGuide:()=>{},
    onTriggerNow:()=>{},onCancelRun:()=>{},onOpenSettings:()=>{},
    ...overrides,
  }
}
function marks(v,marker){
  return v.root.findAll(n=>n.props?.[marker]!==undefined)
}
function types(v,type){return v.root.findAll(n=>n.type===type)}
// PageActions is a ReactNode prop of the shared WorkspaceSurface. Its two
// actions belong to the page header, not WorkspaceSurface's DOM children.
function refreshAction(v){
  const surface=types(v,'workspace-surface')[0]
  assert.ok(surface,'the original page must keep shared workspace shell')
  const elements=React.Children.toArray(surface.props.pageActions.props.children)
  const action=elements.find(node=>node.type==='action-button' && node.props.children==='刷新')
  assert.ok(action,'the real original Refresh action must exist inside pageActions')
  return action
}

test('P66: mounted original Source overview is quiet with identical cold/verified/error geometry',async()=>{
  let v,refreshes=0
  const initial=base({onRefresh:()=>{refreshes++}})
  try{
    await act(async()=>{v=Renderer.create(React.createElement(Page,initial))})
    const pending=marks(v,'data-xdrive-source-overview-loading-slot')
    assert.equal(pending.length,1)
    assert.equal(pending[0].props.sx.minHeight,180)
    assert.equal(pending[0].props['aria-busy'],'true')
    assert.equal(types(v,'state-panel').length,0)
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,355))})
    assert.equal(marks(v,'data-xdrive-source-overview-loading-slot')[0].props.sx.minHeight,180)
    assert.equal(types(v,'state-panel').length,0,'sustained cold read is visually silent')
    await act(async()=>{v.update(React.createElement(Page,{
      ...initial,hasLoaded:true,loading:false,
    }))})
    assert.equal(marks(v,'data-xdrive-source-overview-loading-slot').length,0)
    const verified=marks(v,'data-xdrive-source-overview-verified-empty')[0]
    assert.equal(verified.props.sx.minHeight,180)
    assert.equal(types(v,'state-panel')[0].props.message,'尚未添加来源')
    await act(async()=>{v.update(React.createElement(Page,{
      ...initial,loading:false,hasLoaded:false,loadError:true,
    }))})
    const failure=marks(v,'data-xdrive-source-overview-first-read-error')[0]
    assert.equal(failure.props.sx.minHeight,180)
    assert.equal(types(v,'state-panel').length,0,'first error is never empty')
    assert.equal(types(v,'status-alert').length,1)
    assert.equal(refreshAction(v).props.disabled,false)
    await act(async()=>{refreshAction(v).props.onClick()})
    assert.equal(refreshes,1,'original manual refresh must remain available')
  }finally{if(v)await act(async()=>v.unmount())}
})

test('P66: accepted Source cards survive an ongoing refresh and a genuine refresh failure',async()=>{
  let v
  const props=base({rows:[item],hasLoaded:true,loading:false})
  try{
    await act(async()=>{v=Renderer.create(React.createElement(Page,props))})
    assert.equal(types(v,'source-card').length,1)
    await act(async()=>{v.update(React.createElement(Page,{
      ...props,loading:true,showDelayedLoading:true,
    }))})
    assert.equal(types(v,'source-card').length,1)
    assert.equal(marks(v,'data-xdrive-source-overview-loading-slot').length,0)
    assert.equal(refreshAction(v).props.loading,true,
      'real refresh action in the WorkspaceSurface header is independent from content')
    await act(async()=>{v.update(React.createElement(Page,{
      ...props,loadError:true,
    }))})
    assert.equal(types(v,'source-card').length,1)
    assert.equal(types(v,'status-alert').length,1)
    assert.equal(marks(v,'data-xdrive-source-overview-verified-empty').length,0)
  }finally{if(v)await act(async()=>v.unmount())}
})

test('P66: shared Browser/Desktop Source manager preserves same Source adapter and failure controls',()=>{
  const view=read(file)
  const manager=read('ui/shared/src/mui/SourceManager.tsx')
  const web=read('web/src/App.tsx')
  const desktop=read('desktop/src/renderer/App.tsx')
  for(const v of [
    'data-xdrive-source-overview-loading-slot',
    'data-xdrive-source-overview-verified-empty',
    'data-xdrive-source-overview-first-read-error',
    'aria-busy="true"',
    'minHeight: 180',
    'message={\x60尚未添加${sourceNoun}\x60}',
    '无法读取{sourceNoun}，请点击刷新重试。',
    'loading={showDelayedLoading}',
    'loadingLabel="刷新"',
    'rows.map((row)',
  ])assert.ok(view.includes(v),v)
  assert.equal(view.includes('正在加载${sourceNoun}…'),false)
  assert.ok(manager.includes('<XDriveSourceManagerListPage'))
  assert.ok(manager.includes('adapter.sourceOverview()'))
  assert.ok(web.includes('<XDriveSourceManager'))
  assert.ok(desktop.includes('<XDriveSourceManager'))
})
