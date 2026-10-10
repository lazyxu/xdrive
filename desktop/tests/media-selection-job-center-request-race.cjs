const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'ui/shared/src/mui/MediaSelectionJobCenter.tsx'
const code = ts.transpileModule(read(file), {
  fileName: path.join(root, file),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress', Divider: 'divider',
  LinearProgress: 'linear-progress', Paper: 'paper', Stack: 'stack',
  Typography: 'typography',
}
const mods = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const current = { exports: {} }
new Function('exports', 'module', 'require', code)(current.exports, current, name => {
  if (!Object.hasOwn(mods, name)) throw Error('Unexpected dependency: ' + name)
  return mods[name]
})
const JobCenter = current.exports.XDriveMediaSelectionJobCenter
const job = overrides => ({
  id: 'job-1', action: 'favorite', favorite: true,
  status: 'queued', total_items: 230, processed_items: 0,
  succeeded_items: 0, failed_items: 0, cancelled_items: 0,
  created_at: '2026-10-09T20:00:00Z', updated_at: '2026-10-09T20:00:00Z',
  ...overrides,
})
const button = (view, text) => view.root.findAll(x =>
  x.type === 'button' && x.props.children === text)[0]


function pending() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return {promise,resolve,reject}
}
const flush = async () => { for(let i=0;i<10;i++) await Promise.resolve() }
const activeJob = (id='job-A', options={}) => job({
  id, status:'running', processed_items:10, succeeded_items:10, total_items:230,...options,
})
const hasJob = (view, id) => view.root.findAll(node =>
  node.props['data-xdrive-media-job'] === id).length > 0
async function mount(port) {
  let view
  await act(async () => { view = renderer.create(React.createElement(JobCenter,{port})); await flush() })
  return view
}

test('Media Task Center: same-tick Cancel cannot submit two commands for one pending job', async () => {
  const held=pending(); const calls=[]
  const port={
    list:async()=>[activeJob()],
    cancel:id=>{calls.push(id);return held.promise},
    retry:async()=>{throw Error('not used')},
    failures:async()=>{throw Error('not used')},
  }
  const view=await mount(port)
  try {
    const click=button(view,'取消任务').props.onClick
    await act(async()=>{click();click();await flush()})
    assert.deepEqual(calls,['job-A'],
      'a durable job cancel action must be owned synchronously within the render')
  } finally {
    await act(async()=>{held.resolve();await flush();view.unmount()})
  }
})

test('Media Task Center: same-tick Retry cannot create duplicate resumed jobs', async () => {
  const held=pending();const calls=[]
  const port={
    list:async()=>[activeJob('job-A',{status:'partial',processed_items:230,failed_items:2})],
    cancel:async()=>{throw Error('not used')},
    retry:id=>{calls.push(id);return held.promise},
    failures:async()=>{throw Error('not used')},
  }
  const view=await mount(port)
  try {
    const click=button(view,'重试未成功项').props.onClick
    await act(async()=>{click();click();await flush()})
    assert.deepEqual(calls,['job-A'],
      'the same immutable failed revisions may create only one retry job at a time')
  } finally {
    await act(async()=>{held.resolve(activeJob('resumed-B'));await flush();view.unmount()})
  }
})

test('Media Task Center: old in-flight poll cannot restore running after accepted Cancel', async () => {
  const originalSetInterval=globalThis.setInterval, originalClearInterval=globalThis.clearInterval
  let poll
  let tickID=Symbol('Task Center poll')
  globalThis.setInterval=(callback,ms,...args)=>ms===2500?(poll=callback,tickID):originalSetInterval(callback,ms,...args)
  globalThis.clearInterval=id=>id===tickID?undefined:originalClearInterval(id)
  const older=pending()
  let calls=0
  const port={
    list:()=>{calls++;return calls===1
      ?Promise.resolve([activeJob()])
      :calls===2?older.promise
      :Promise.resolve([activeJob('job-A',{status:'cancel_requested',processed_items:20,succeeded_items:20})])},
    cancel:async()=>{},
    retry:async()=>{},
    failures:async()=>{},
  }
  let view
  try {
    view=await mount(port)
    assert.ok(poll,'real task-center polling effect must register timer')
    await act(async()=>{poll();await flush()})
    assert.equal(calls,2)
    await act(async()=>{button(view,'取消任务').props.onClick();await flush()})
    assert.equal(hasJob(view,'job-A'),true)
    assert.equal(view.root.findAll(n=>n.type==='button' && n.props.children==='取消任务').length,0,
      'after cancelling, Task Center must present cancel_requested status')
    await act(async()=>{older.resolve([activeJob()]);await flush()})
    assert.equal(view.root.findAll(n=>n.type==='button' && n.props.children==='取消任务').length,0,
      'older poll must not roll back accepted cancellation to running')
  } finally {
    if(view)await act(async()=>view.unmount())
    globalThis.setInterval=originalSetInterval;globalThis.clearInterval=originalClearInterval
  }
})

test('Media Task Center: old account Cancel completion cannot replace new port task list', async () => {
  const oldCancel=pending()
  const portA={
    list:async()=>[activeJob('private-A')],
    cancel:()=>oldCancel.promise,
    retry:async()=>{},
    failures:async()=>{},
  }
  const portB={
    list:async()=>[activeJob('private-B',{status:'completed',processed_items:230,succeeded_items:230})],
    cancel:async()=>{},
    retry:async()=>{},
    failures:async()=>{},
  }
  let view=await mount(portA)
  try{
    await act(async()=>{button(view,'取消任务').props.onClick();await flush()})
    await act(async()=>{view.update(React.createElement(JobCenter,{port:portB}));await flush()})
    assert.equal(hasJob(view,'private-B'),true,'new account must load its task list')
    await act(async()=>{oldCancel.resolve();await flush()})
    assert.equal(hasJob(view,'private-A'),false,
      'a previous port/account mutation must not reintroduce private jobs')
    assert.equal(hasJob(view,'private-B'),true)
  }finally{await act(async()=>view.unmount())}
})

test('Media Task Center: normal one-shot Cancel still displays authoritative result', async () => {
  let current=activeJob()
  const port={
    list:async()=>[current],
    cancel:async()=>{current=activeJob('job-A',{status:'cancel_requested'})},
    retry:async()=>{},
    failures:async()=>{},
  }
  const view=await mount(port)
  try {
    await act(async()=>{button(view,'取消任务').props.onClick();await flush()})
    assert.equal(hasJob(view,'job-A'),true)
    assert.equal(view.root.findAll(n=>n.type==='button' && n.props.children==='取消任务').length,0)
  }finally{await act(async()=>view.unmount())}
})


test('Media Task Center: old account records are hidden on first frame of new port', async () => {
  const waiting=pending()
  const oldPort={
    list:async()=>[activeJob('secret-A')],
    cancel:async()=>{},retry:async()=>{},failures:async()=>{},
  }
  const newPort={
    list:()=>waiting.promise,
    cancel:async()=>{},retry:async()=>{},failures:async()=>{},
  }
  const view=await mount(oldPort)
  try {
    assert.equal(hasJob(view,'secret-A'),true)
    await act(async()=>{view.update(React.createElement(JobCenter,{port:newPort}));await flush()})
    assert.equal(hasJob(view,'secret-A'),false,
      'prior account private jobs must not appear even before new list response')
    await act(async()=>{waiting.resolve([activeJob('public-B')]);await flush()})
    assert.equal(hasJob(view,'public-B'),true)
  }finally{await act(async()=>view.unmount())}
})

test('Media Task Center: same-tick failure page click starts one request', async () => {
  const waiting=pending(),calls=[]
  const port={
    list:async()=>[activeJob('job-A',{status:'partial',processed_items:230,failed_items:2})],
    cancel:async()=>{},retry:async()=>{},
    failures:(id,offset,limit)=>{
      calls.push([id,offset,limit])
      return waiting.promise
    },
  }
  const view=await mount(port)
  try{
    const click=button(view,'查看失败详情').props.onClick
    await act(async()=>{click();click();await flush()})
    assert.deepEqual(calls,[['job-A',0,100]])
    await act(async()=>{waiting.resolve({
      offset:0,limit:100,total:2,has_more:false,
      items:[{node_id:7,revision:1,failure_code:'stale_revision'}],
    });await flush()})
    assert.equal(view.root.findAll(n=>n.props['data-xdrive-media-job-failures']==='job-A').length,1)
  }finally{await act(async()=>view.unmount())}
})

test('Media Task Center: old account failure response cannot show in current port', async () => {
  const waiting=pending()
  const oldPort={
    list:async()=>[activeJob('private-A',{status:'partial',processed_items:230,failed_items:1})],
    cancel:async()=>{},retry:async()=>{},
    failures:()=>waiting.promise,
  }
  const newPort={
    list:async()=>[activeJob('public-B',{status:'completed',processed_items:230,succeeded_items:230})],
    cancel:async()=>{},retry:async()=>{},failures:async()=>({}),
  }
  const view=await mount(oldPort)
  try{
    await act(async()=>{button(view,'查看失败详情').props.onClick();await flush()})
    await act(async()=>{view.update(React.createElement(JobCenter,{port:newPort}));await flush()})
    await act(async()=>{waiting.reject(new Error('private A request failure'));await flush()})
    assert.equal(hasJob(view,'public-B'),true)
    assert.equal(hasJob(view,'private-A'),false)
    assert.equal(view.root.findAll(n=>n.props.role==='alert' &&
      String(n.props.children).includes('private A request failure')).length,0)
  }finally{await act(async()=>view.unmount())}
})
