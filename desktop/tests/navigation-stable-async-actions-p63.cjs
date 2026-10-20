const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function transpile(file, jsx = false) {
  return ts.transpileModule(read(file), {
    fileName: path.join(root,file),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined, esModuleInterop: true,
    },
  }).outputText
}
function load(file, dependencies, jsx = false) {
  const module = { exports: {} }
  new Function('exports', 'module', 'require', transpile(file, jsx))(
    module.exports, module, name => {
      if (!Object.hasOwn(dependencies, name)) throw Error('Unexpected import: ' + name)
      return dependencies[name]
    },
  )
  return module.exports
}
const hook = load('ui/shared/src/mui/useDeferredLoading.ts', { react: React })
const mui = Object.fromEntries([
  'Box','Button','CircularProgress','Paper','Stack','Typography',
].map(name => [name,name.toLowerCase()]))
const Component = load('ui/shared/src/mui/MediaGalleryCleanupIndexStatus.tsx',{
  react:React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material':mui,
  './useDeferredLoading':hook,
},true).XDriveMediaGalleryCleanupIndexStatus

test('P63 actual shared Cleanup index button never relabels during a short or sustained network read',async()=>{
  let view, requested=0
  const initial={status:null,loading:true,error:'',onRequest:()=>{requested++}}
  const button=()=>view.root.findAll(n=>n.type==='button'&&
    Object.hasOwn(n.props,'data-xdrive-media-cleanup-check-index'))[0]
  const label=()=>view.root.findAll(n=>n.type==='typography'&&n.props.component==='span')[0].props.children
  const slot=()=>view.root.findAll(n=>n.props?.['data-xdrive-media-cleanup-index-progress-slot']!==undefined)[0]
  const progress=()=>view.root.findAll(n=>n.type==='circularprogress')
  try{
    await act(async()=>{view=Renderer.create(React.createElement(Component,initial))})
    assert.equal(label(),'查看索引状态')
    assert.equal(button().props.disabled,true)
    assert.equal(button().props['aria-busy'],true)
    assert.equal(slot().props.sx.width,16)
    assert.equal(progress().length,0)
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,35))})
    assert.equal(label(),'查看索引状态')
    assert.equal(progress().length,0)
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,340))})
    assert.equal(label(),'查看索引状态')
    assert.equal(slot().props.sx.width,16)
    assert.equal(progress().length,1)
    await act(async()=>{view.update(React.createElement(Component,{
      ...initial,loading:false,status:{
        known_assets:17,ready_assets:13,failed_assets:1,unsupported_assets:0,
        missing_metadata_assets:2,other_unready_assets:1,
      },
    }))})
    assert.equal(label(),'刷新索引状态')
    assert.equal(button().props.disabled,false)
    assert.equal(button().props['aria-busy'],undefined)
    assert.equal(progress().length,0)
    assert.ok(view.root.findAll(n=>n.props?.['data-xdrive-media-cleanup-index-counts']!==undefined).length)
    await act(async()=>{button().props.onClick()})
    assert.equal(requested,1)
  }finally{if(view)await act(async()=>view.unmount())}
})

test('P63 shared device folder continuation keeps the same label while pending',()=>{
  const source=read('ui/shared/src/mui/DeviceBackupPage.tsx')
  const begin=source.indexOf('<Button size="small" variant="outlined"',source.indexOf('overview.has_more_folders'))
  const end=source.indexOf('</Button>',begin)
  const jsx=source.slice(begin,end)
  assert.ok(begin>0&&end>begin)
  for(const token of [
    'disabled={Boolean(folderPages[device.id]?.loading)}',
    'aria-busy={Boolean(folderPages[device.id]?.loading) || undefined}',
    'data-xdrive-device-backup-folder-page-action={device.id}',
    'onClick={() => void loadDeviceFolders(device.id)}',
    "? '加载更多此设备文件夹' : '核对并加载此设备文件夹'",
  ])assert.ok(jsx.includes(token),token)
  assert.equal(jsx.includes('正在读取文件夹…'),false,
    'an instant label change must not push the adjacent mobile card layout')
  assert.ok(source.includes('folderRequestIDs.current[deviceID] !== requestID'))
  assert.ok(source.includes('folderPages[device.id]?.failed'))
  assert.ok(source.includes('文件夹读取失败，已保留当前内容；可重试'))
})

test('P63 history pagination preserves accepted rows and current page while Server read is pending',()=>{
  const source=read('ui/shared/src/mui/DeviceBackupPage.tsx')
  assert.ok(source.includes('verified: boolean'))
  assert.ok(source.includes('page: pages[id]?.page ?? page'))
  assert.ok(source.includes('verified: pages[id]?.verified ?? false'))
  assert.ok(source.includes('[id]: { items: data.items, page, hasMore: data.has_more, loading: false, verified: true }'))
  assert.ok(source.includes('page: prev.pages[id]?.page ?? page'))
  assert.ok(source.includes('verified: prev.pages[id]?.verified ?? false'))
  assert.ok(source.includes('data-xdrive-device-backup-history-list={folder.source_id}'))
  assert.ok(source.includes('aria-busy={Boolean(history?.loading) || undefined}'))
  assert.ok(source.includes("sx={{ minHeight: 72, position: 'relative' }}"),
    'existing history retains its 72px floor and a stable scoped error anchor')
  assert.ok(source.includes('data-xdrive-device-backup-history-error={folder.source_id}'))
  assert.ok(source.includes('无法加载历史，请重试。'),
    'real retryable terminal error remains visible without adding a new row')
  assert.ok(source.includes('history && history.items.length > 0 ? history.items.map((run) => ('))
  assert.ok(source.includes(': history?.verified'))
  assert.ok(!source.includes('读取历史中…'),
    'accepted history rows must not collapse into a transient network label')
  assert.ok(source.includes('historyError?.source === source && historyError.id === folder.source_id'))
  assert.ok(source.includes('requests.current[id] !== request'),
    'obsolete Owner/Agent Promise completions must still be discarded')
  assert.ok(source.includes('source.runs(id, pageSize, (page - 1) * pageSize)'))
})

test('P63 device pagination button never changes its label during a short request',()=>{
  const source=read('ui/shared/src/mui/DeviceBackupPage.tsx')
  const marker=source.indexOf('data-xdrive-device-backup-more-devices')
  const begin=source.lastIndexOf('<Button',marker)
  const end=source.indexOf('</Button>',marker)
  assert.ok(begin>0&&end>begin)
  const jsx=source.slice(begin,end)
  assert.ok(jsx.includes('aria-busy={pageLoading || undefined}'))
  assert.ok(jsx.includes('加载更多设备'))
  assert.equal(jsx.includes('正在加载更多设备…'),false)
  assert.ok(source.includes('onClick={() => void loadMoreDevices()}'))
  assert.ok(source.includes('prev.overview !== requestedOverview'),
    'read results are still fenced to the existing accepted account overview')
})
