const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const React=require('react')
const Renderer=require('react-test-renderer')
const {act}=Renderer
const root=path.join(__dirname,'..','..')
const toJS=(filename,jsx=false)=>ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{
  fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    jsx:jsx?ts.JsxEmit.ReactJSX:undefined,esModuleInterop:true},
}).outputText
const load=(filename,resolve,jsx=false)=>{
  const m={exports:{}}
  new Function('exports','module','require',toJS(filename,jsx))(m.exports,m,resolve)
  return m.exports
}
const hook=load('ui/shared/src/mui/useDeferredLoading.ts',name=>{
  if(name==='react')return React
  throw Error('Unexpected hook dependency '+name)
})
const material={Box:'box',Button:'button',CircularProgress:'progress',Divider:'divider',
  LinearProgress:'linear-progress',Paper:'paper',Stack:'stack',Typography:'typography'}
const Component=load('ui/shared/src/mui/MediaSelectionJobCenter.tsx',name=>{
  if(name==='react')return React
  if(name==='react/jsx-runtime')return require('react/jsx-runtime')
  if(name==='@mui/material')return material
  if(name==='./MediaGalleryUtils')return {xDriveMediaGalleryErrorMessage:String}
  if(name==='./useDeferredLoading')return hook
  throw Error('Unexpected task dependency '+name)
},true).XDriveMediaSelectionJobCenter
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const fn={cancel:async()=>{},retry:async()=>{},failures:async()=>({items:[],total:0})}
const nodes=(view,key)=>view.root.findAll(n=>Object.hasOwn(n.props??{},key))
const spinner=view=>view.root.findAll(n=>n.type==='progress').length
const empty=view=>view.root.findAll(n=>n.type==='typography'&&n.props.children==='暂无媒体批量任务').length
const delay=ms=>new Promise(ok=>setTimeout(ok,ms))
test('fast real first list read has no spinner and only accepted empty state',async()=>{
  const held=deferred()
  let view
  await act(async()=>{view=Renderer.create(React.createElement(Component,{port:{...fn,list:()=>held.promise}}))})
  try{
    assert.equal(spinner(view),0)
    assert.equal(nodes(view,'data-xdrive-media-jobs-first-read').length,1)
    assert.equal(nodes(view,'data-xdrive-media-job-loading-slot').length,1)
    await act(async()=>{await delay(70)})
    assert.equal(spinner(view),0)
    await act(async()=>{held.resolve([])})
    assert.equal(spinner(view),0)
    assert.equal(empty(view),1)
    await act(async()=>{await delay(260)})
    assert.equal(spinner(view),0)
  }finally{await act(async()=>view.unmount())}
})
test('held server read reports progress after 300ms without moving the header slot',async()=>{
  const held=deferred()
  let view
  await act(async()=>{view=Renderer.create(React.createElement(Component,{port:{...fn,list:()=>held.promise}}))})
  try{
    assert.equal(spinner(view),0)
    await act(async()=>{await delay(350)})
    assert.equal(spinner(view),1)
    assert.equal(nodes(view,'data-xdrive-media-job-loading-slot').length,1)
    await act(async()=>{held.resolve([])})
    assert.equal(spinner(view),0)
    assert.equal(empty(view),1)
  }finally{await act(async()=>view.unmount())}
})
test('rejected first read never advertises empty and releases pending progress',async()=>{
  const held=deferred()
  let view
  await act(async()=>{view=Renderer.create(React.createElement(Component,{port:{...fn,list:()=>held.promise}}))})
  try{
    await act(async()=>{held.reject(new Error('503 job unavailable'))})
    assert.equal(nodes(view,'data-xdrive-media-jobs-first-read').length,1)
    assert.equal(empty(view),0)
    assert.equal(spinner(view),0)
    assert.ok(view.root.findAll(n=>n.props.role==='alert').some(n=>String(n.props.children).includes('503')))
  }finally{await act(async()=>view.unmount())}
})
test('account/Agent switch does not show previous private task or previous loading epoch',async()=>{
  const held=deferred()
  const item={id:'private-A',status:'queued',favorite:true,total_items:1,processed_items:0,
    succeeded_items:0,failed_items:0,cancelled_items:0}
  const A={...fn,list:async()=>[item]}
  const B={...fn,list:()=>held.promise}
  let view
  await act(async()=>{view=Renderer.create(React.createElement(Component,{port:A}))})
  try{
    assert.equal(view.root.findAll(n=>n.props['data-xdrive-media-job']==='private-A').length,1)
    await act(async()=>{view.update(React.createElement(Component,{port:B}))})
    assert.equal(view.root.findAll(n=>n.props['data-xdrive-media-job']==='private-A').length,0)
    assert.equal(nodes(view,'data-xdrive-media-jobs-first-read').length,1)
    assert.equal(spinner(view),0)
    await act(async()=>{held.resolve([])})
    assert.equal(empty(view),1)
  }finally{await act(async()=>view.unmount())}
})
