const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const {act} = TestRenderer
const root = path.resolve(__dirname,'../..')
const read = name => fs.readFileSync(path.join(root,name),'utf8')

function loadOriginal(relative, deps, jsx=false) {
  const compiled=ts.transpileModule(read(relative),{
    fileName:path.join(root,relative),
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
      jsx:jsx?ts.JsxEmit.ReactJSX:undefined,esModuleInterop:true},
  }).outputText
  const mod={exports:{}}
  new Function('exports','module','require',compiled)(mod.exports,mod,name=>{
    if(!Object.hasOwn(deps,name))throw Error('Unexpected dependency: '+name)
    return deps[name]
  })
  return mod.exports
}
const mui=Object.fromEntries([
  'Accordion','AccordionDetails','AccordionSummary','Box','Button','Dialog',
  'IconButton','Stack','Tooltip','Typography',
].map(name=>[name,name.toLowerCase()]))
const componentDeps={
  'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/icons-material/ContentCopyRounded':'copy-icon',
  '@mui/material':mui,
  './ActionButton':{XDriveActionButton:'action-button'},
  './DescriptionGrid':{XDriveDescriptionGrid:'description-grid',XDriveDescriptionItem:'description-item'},
  './DialogActions':{XDriveDialogActions:'dialog-actions'},
  './DialogContent':{XDriveDialogContent:'dialog-content'},
  './DialogTitle':{XDriveDialogTitle:'dialog-title',useXDriveCompactTouchDialog:()=>({compactTouch:false,dialogPaper:{}})},
  './PaginationControls':{XDrivePaginationControls:'pagination'},
  './SectionHeader':{XDriveSectionHeader:'section-header'},
  './StatePanel':{XDriveStatePanel:'state-panel'},
  './StatusAlert':{XDriveStatusAlert:'status-alert'},
  './StatusBadge':{XDriveStatusBadge:'status-badge'},
  './SourceCollection':{XDriveSourceCollectionItem:'collection-item',XDriveSourceCollectionSummary:'collection-summary'},
  './SourceFailureItem':{XDriveSourceFailureItem:'failure-item'},
  './SourceRunSkipItem':{XDriveSourceRunSkipItem:'skip-item'},
  './SourceKindIcon':{XDriveSourceKindIcon:'kind-icon'},
  './SourceRunProgress':{XDriveSourceRunProgress:'run-progress'},
  './SourceRunSummary':{XDriveSourceRunSummary:'run-summary'},
  '../external-sources':{
    externalSourceCardView:()=>({trigger:{ready:true}}),
    externalSourceDetailView:()=>({
      kindLabel:'相册来源',modeLabel:'备份',state:{tone:'good',label:'正常'},
      targetNodeID:1,scheduleLabel:'手动',lastRunAt:null,lastSuccessAt:null,
      credential:null,error:null,
    }),
    externalSourceDisplayName:()=> '同步文件夹 A',
    externalSourceDisplayTargetPath:()=> '同步文件夹/A',
    externalSourceMirrorSafetyNotice:'safety',
    externalSourceMirrorScanNotice:'scan',
    externalSourceRunDetailView:run=>({
      statusTone:'good',statusLabel:'完成',error:'',
      startedAt:'2026-10-18T00:00:00Z',finishedAt:'2026-10-18T00:01:00Z',
      durationLabel:'1 分钟',metrics:[],failedItems:run.failed_items,progress:null,
    }),
    formatExternalSourceTime:x=>String(x??'—'),
  },
  '../format':{formatBytes:n=>String(n)+' B'},
}
const Dialog=loadOriginal('ui/shared/src/mui/SourceManagerDetailsDialog.tsx',componentDeps,true).XDriveSourceDetailsDialog
const sourceRow={source:{
  id:42,name:'同步文件夹 A',kind:'synology_photos',direction:'pull',sync_mode:'backup',
  run_mode:'sync',status:'active',
},latestRun:null}
function baseProps(actions={}) {
  return {
    row:sourceRow,collections:[],collectionsLoading:true,collectionsReadState:'unverified',
    collectionItemPages:{},collectionPageSize:50,
    historyRuns:[],historyPage:1,historyHasNext:false,historyLoading:true,
    historyReadState:'unverified',historyPageSize:20,
    runFailurePages:{},runSkipPages:{},runFailurePageSize:20,
    failedItems:[],failedItemsLoading:true,triggeringSourceID:null,cancellingRunID:null,
    onClose:()=>{},onReloadCollections:()=>{},
    onLoadCollectionItems:()=>{},onLoadRunHistory:()=>{},onLoadRunFailures:()=>{},
    onLoadRunSkips:()=>{},onCancelRun:()=>{},onCopyRunID:()=>{},
    onOpenFailedItems:()=>{},onTriggerNow:()=>{},...actions,
  }
}
const byProp=(v,prop)=>v.root.findAll(n=>n.props&&n.props[prop]===true)
const byType=(v,type)=>v.root.findAll(n=>n.type===type)
const states=v=>byType(v,'state-panel').map(n=>n.props.message)

test('P64: mounted original shared Source detail keeps cold Collections and History quiet and sized through sustained reads',async()=>{
  let v
  const props=baseProps()
  try{
    await act(async()=>{v=TestRenderer.create(React.createElement(Dialog,props))})
    const collections=()=>byProp(v,'data-xdrive-source-collections-first-read')[0]
    const history=()=>byProp(v,'data-xdrive-source-run-history-first-read')[0]
    assert.equal(collections().props.sx.minHeight,180)
    assert.equal(history().props.sx.minHeight,160)
    assert.equal(collections().props['aria-busy'],true)
    assert.equal(history().props['aria-busy'],true)
    assert.equal(byType(v,'circularprogress').length,0)
    assert.deepEqual(states(v),[],'unverified zero may not be rendered as authoritative empty')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350))})
    assert.equal(collections().props.sx.minHeight,180)
    assert.equal(history().props.sx.minHeight,160)
    assert.equal(byType(v,'circularprogress').length,0,
      'sustained collection/history requests remain visually quiet')
    await act(async()=>{v.update(React.createElement(Dialog,{
      ...props,collectionsLoading:false,collectionsReadState:'ready',
      historyLoading:false,historyReadState:'ready',failedItemsLoading:false,
    }))})
    assert.deepEqual(states(v),['该来源暂无相册/集合元数据','尚无运行记录'],
      'only accepted zero may claim empty')
    assert.equal(byProp(v,'data-xdrive-source-collections-empty')[0].props.sx.minHeight,180,
      'an accepted zero retains exactly the cold Collections minimum height')
    assert.equal(byProp(v,'data-xdrive-source-run-history-empty')[0].props.sx.minHeight,160,
      'an accepted zero retains exactly the cold History minimum height')
  }finally{if(v)await act(async()=>v.unmount())}
})

test('P64: first-read errors get visible retry without claiming empty',async()=>{
  let v
  let collectionRetries=0,historyRetries=0
  const props=baseProps({
    onReloadCollections:sourceID=>{assert.equal(sourceID,42);collectionRetries++},
    onLoadRunHistory:(sourceID,page)=>{assert.equal(sourceID,42);assert.equal(page,1);historyRetries++},
  })
  try{
    await act(async()=>{v=TestRenderer.create(React.createElement(Dialog,{
      ...props,collectionsLoading:false,collectionsReadState:'error',
      historyLoading:false,historyReadState:'error',failedItemsLoading:false,
    }))})
    assert.equal(byProp(v,'data-xdrive-source-collections-first-read').length,1)
    assert.equal(byProp(v,'data-xdrive-source-run-history-first-read').length,1)
    assert.deepEqual(states(v),[])
    const buttons=byType(v,'button').filter(x=>x.props.children==='重试')
    assert.equal(buttons.length,2)
    await act(async()=>{buttons[0].props.onClick();buttons[1].props.onClick()})
    assert.equal(collectionRetries,1)
    assert.equal(historyRetries,1)
  }finally{if(v)await act(async()=>v.unmount())}
})

test('P64: switching to refreshed accepted Source lists retains cards and historical rows',async()=>{
  let v,requested=0
  const collection={id:17,name:'旅行'}
  const run={id:'run-17',run_number:1,status:'completed',failed_items:1,skipped_items:1}
  const props=baseProps({
    collections:[collection],collectionsReadState:'ready',collectionsLoading:true,
    historyRuns:[run],historyReadState:'ready',historyLoading:true,
    onLoadCollectionItems:(sourceID,id,page)=>{
      assert.deepEqual([sourceID,id,page],[42,17,1]);requested++
    },
  })
  try{
    await act(async()=>{v=TestRenderer.create(React.createElement(Dialog,props))})
    assert.equal(byType(v,'collection-summary').length,1)
    assert.equal(byType(v,'run-summary').length,1)
    assert.equal(byProp(v,'data-xdrive-source-collections-first-read').length,0)
    assert.equal(byProp(v,'data-xdrive-source-run-history-first-read').length,0)
    const collectionAccordion=byType(v,'accordion')[0]
    await act(async()=>{collectionAccordion.props.onChange({},true)})
    assert.equal(requested,1)
    const member=()=>byProp(v,'data-xdrive-source-collection-members-first-read')[0]
    assert.equal(member().props.sx.minHeight,120,'first expansion already reserves member geometry')
    await act(async()=>{v.update(React.createElement(Dialog,{
      ...props,collectionItemPages:{17:{items:[],page:1,hasNext:false,loaded:false,loading:true}},
      runFailurePages:{'run-17':{items:[],page:1,hasNext:false,loaded:false,loading:true}},
      runSkipPages:{'run-17':{items:[],page:1,hasNext:false,loaded:false,loading:true}},
    }))})
    assert.equal(member().props.sx.minHeight,120,'no new in-flow spinner while collection Range pending')
    assert.equal(member().props['aria-busy'],true)
    assert.equal(byProp(v,'data-xdrive-source-run-failures-first-read')[0].props.sx.minHeight,96)
    assert.equal(byProp(v,'data-xdrive-source-run-skips-first-read')[0].props.sx.minHeight,96)
    assert.equal(byType(v,'circularprogress').length,0)
    assert.equal(byType(v,'run-summary').length,1,'accepted history survives refresh')
    await act(async()=>{v.update(React.createElement(Dialog,{
      ...props,collectionsLoading:false,historyLoading:false,
      collectionItemPages:{17:{items:[{external_id:'asset-1',name:'One'}],page:1,hasNext:false,loaded:true,loading:false}},
    }))})
    assert.equal(byProp(v,'data-xdrive-source-collection-members-first-read').length,0)
    assert.equal(byType(v,'collection-item').length,1)
    await act(async()=>{v.update(React.createElement(Dialog,{
      ...props,collectionsLoading:false,historyLoading:false,
      collectionItemPages:{17:{items:[],page:1,hasNext:false,loaded:true,loading:false}},
      runFailurePages:{'run-17':{items:[],page:1,hasNext:false,loaded:true,loading:false}},
      runSkipPages:{'run-17':{items:[],page:1,hasNext:false,loaded:true,loading:false}},
    }))})
    assert.equal(byProp(v,'data-xdrive-source-collection-members-empty')[0].props.sx.minHeight,120)
    assert.equal(byProp(v,'data-xdrive-source-run-failures-empty')[0].props.sx.minHeight,96)
    assert.equal(byProp(v,'data-xdrive-source-run-skips-empty')[0].props.sx.minHeight,96)
  }finally{if(v)await act(async()=>v.unmount())}
})

test('P64: controller fences stale source, collection and history results and preserves Server/Agent transport',()=>{
  const code=read('ui/shared/src/mui/SourceManager.tsx')
  const view=read('ui/shared/src/mui/SourceManagerDetailsDialog.tsx')
  for(const key of [
    'const detailScopeRef = useRef(0)',
    'const historyRequestRef = useRef(0)',
    'const collectionItemRequestRef = useRef<Record<number, number>>({})',
    'const scope = ++detailScopeRef.current',
    'if (detailScopeRef.current !== scope || historyRequestRef.current !== request) return',
    'if (detailScopeRef.current !== scope) return',
    'collectionItemRequestRef.current[collectionID] !== request',
    "setHistoryReadState('ready')","setCollectionsReadState('ready')",
    "setHistoryReadState('unverified')","setCollectionsReadState('unverified')",
    'adapter.sourceRuns(sourceID, SOURCE_HISTORY_PAGE_SIZE + 1, offset)',
    'adapter.sourceCollections(sourceID)',
    'adapter.sourceCollectionItems(',
  ]) assert.ok(code.includes(key),key)
  assert.ok(view.includes('data-xdrive-source-failed-items aria-busy={failedItemsLoading || undefined}'))
  for(const caption of [
    '正在加载相册/集合','正在加载集合成员',
    '正在加载运行历史','正在检查逐文件失败记录…',
  ])assert.equal(view.includes(caption),false,'transient caption must never insert a new row: '+caption)
  assert.equal(view.includes('<CircularProgress'),false)
  assert.ok(view.includes('XDriveSourceCollectionSummary'))
  assert.ok(view.includes('XDriveSourceRunSummary'))
  assert.ok(view.includes('onLoadRunHistory(row.source.id, historyPage + 1)'))
})
