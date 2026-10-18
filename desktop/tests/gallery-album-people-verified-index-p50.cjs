const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const source = read('ui/shared/src/mui/MediaGallery.tsx')
const organizer = read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
const deferred = read('ui/shared/src/mui/useDeferredLoading.ts')
const web = read('web/src/App.tsx')
const desktop = read('desktop/src/renderer/App.tsx')

test('Only this Owner current authorized facets success can confirm Album/People empty',()=>{
  for(const token of [
    'const [acceptedFacetOwner, setAcceptedFacetOwner]',
    'setAcceptedFacetOwner(preferenceScope)',
    'indexFacetsVerified={acceptedFacetOwner === preferenceScope}',
    'indexFacetsVerified?: boolean',
    'indexFacetsVerified = true',
    'const coldPeopleIndex = showPeopleIndex && !indexFacetsVerified',
    "pets={acceptedFacetOwner === preferenceScope ? pets : []}",
    "suggestedPeople={acceptedFacetOwner === preferenceScope ? suggestedPeople : []}",
    "people={acceptedFacetOwner === preferenceScope ? people : []}",
    "albums={acceptedFacetOwner === preferenceScope ? albums : []}",
  ]) assert.ok(source.includes(token), token)
  const accept=source.indexOf('setAcceptedFacetOwner(preferenceScope)')
  assert.ok(accept>source.indexOf('setPersonIdentities(nextPeople)'))
  assert.ok(source.lastIndexOf('request !== requestID.current',accept)>0)
  assert.ok(source.includes('setAlbums(nextAlbums)'))
  assert.ok(web.includes('XDriveMediaGalleryPage')&&desktop.includes('XDriveMediaGalleryPage'),
    'both platforms keep the same controller and Server/Agent transport')
})

test('Album Organizer owns exactly one stable 160px first-read, error/retry and confirmed empty slot',()=>{
  for(const token of [
    'indexVerified?: boolean',
    'indexPending?: boolean',
    'indexError?: boolean',
    'onRetryIndex?: () => void',
    'indexVerified = true',
    'showDelayedIndexRead = useXDriveDeferredPendingLoading(!indexVerified && indexPending)',
    "visibility: indexVerified ? 'visible' : 'hidden'",
    'data-xdrive-gallery-album-index-read-state',
    "minHeight: 160, display: 'grid', placeItems: 'center'",
    'indexError ? (',
    "相册索引读取失败，请重试。",
    'onClick={onRetryIndex}',
    'minWidth: 44, minHeight: 44',
    "正在读取相册…",
    "(!currentFolderLoading && (!folderActions || foldersVerified))",
    "albums.length > 0 ? '当前文件夹没有匹配的相册' : '还没有相册'",
    'aria-busy={currentFolderLoading || undefined}',
  ]) assert.ok(organizer.includes(token),token)
  assert.equal(organizer.includes('showDelayedFolderLoading'),false)
  assert.equal(organizer.includes('加载相册文件夹…'),false)
  for(const token of [
    'indexVerified={indexFacetsVerified}',
    "indexPending={!indexFacetsVerified && (loading || placesStatus === 'loading' || syncFoldersLoading)}",
    "indexError={!indexFacetsVerified && placesStatus === 'error' && !loading}",
    'onRetryIndex={onRefresh}',
  ]) assert.ok(source.includes(token),token)
  assert.equal(source.includes('<Typography color="text.secondary">还没有相册</Typography>'),false,
    'Gallery root cannot mount a redundant album-empty panel beneath the organizer')
  assert.ok(deferred.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
})

test('People keep one quiet first-read/error pane, accepted empty and real thumbnails intact',()=>{
  for(const token of [
    'const coldPeopleIndex = showPeopleIndex && !indexFacetsVerified',
    "coldPeopleIndex && (loading || placesStatus === 'loading')",
    'data-xdrive-gallery-unverified-facet-index',
    'minHeight: 160',
    "人物索引读取失败，请重试。",
    "正在读取人物…",
    'onClick={onRefresh}',
    'indexFacetsVerified ? (',
    '还没有可浏览的人物',
    "showAlbumIndex && syncFolders.length > 0 ? (",
    'data-xdrive-gallery-places-first-read',
    'XDriveMediaGalleryCoverThumbnail',
  ]) assert.ok(source.includes(token),token)
  assert.equal(source.includes('showDelayedSyncFolders'),false,
    'unverified sync-folder read must not insert a spinner section above Albums')
  assert.equal(source.includes('正在加载同步文件夹…'),false)
  assert.equal(source.includes("coldAlbumIndex || coldPeopleIndex"),false)
})

test('Mounted shared Album Organizer keeps one fixed status slot through fast, sustained and failed facet reads', async()=>{
  const ts = require('typescript')
  const React = require('react')
  const Renderer = require('react-test-renderer')
  const { act } = Renderer
  function compile(relative, jsx=false) {
    const filename=path.join(root,relative)
    return ts.transpileModule(read(relative),{fileName:filename,compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
      jsx:jsx?ts.JsxEmit.ReactJSX:undefined,esModuleInterop:true,
    }}).outputText
  }
  function load(relative,deps,jsx=false) {
    const out={exports:{}}
    new Function('exports','module','require',compile(relative,jsx))(
      out.exports,out,name=>{
        if(!Object.hasOwn(deps,name))throw Error('unexpected album test dependency: '+name)
        return deps[name]
      })
    return out.exports
  }
  const hook=load('ui/shared/src/mui/useDeferredLoading.ts',{react:React})
  const prefs=load('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts',{})
  const folders=load('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts',{})
  const mui=Object.fromEntries([
    'Alert','Box','Breadcrumbs','Button','CircularProgress','Dialog',
    'DialogActions','DialogContent','DialogTitle','IconButton','MenuItem',
    'Paper','Stack','TextField','Tooltip','Typography',
  ].map(k=>[k,k.toLowerCase()]))
  const icons=new Proxy({},{get:(_,k)=>String(k)})
  const Organizer=load('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx',{
    react:React,
    'react/jsx-runtime':require('react/jsx-runtime'),
    '@mui/material':mui,
    '@mui/icons-material':icons,
    './MediaGalleryCoverThumbnail':{XDriveMediaGalleryCoverThumbnail:'thumbnail'},
    './MediaGalleryAlbumOrganization':prefs,
    './MediaGalleryAlbumFolderModel':folders,
    './useDeferredLoading':hook,
  },true).XDriveMediaGalleryAlbumOrganizer

  let view, retries=0
  const props={albums:[],accountScope:'test:P50-quiet-index',indexVerified:false,
    indexPending:false,indexError:false,onRetryIndex:()=>{retries++},
    loadThumbnail:async()=>null}
  const slot=()=>view.root.findAll(n=>n.props?.['data-xdrive-gallery-album-index-read-state']!==undefined)[0]
  const has=(value)=>view.root.findAll(n=>n.type==='typography' &&
    String(n.props.children??'').includes(value)).length>0
  const ring=()=>view.root.findAll(n=>n.type==='circularprogress').length
  try {
    await act(async()=>{view=Renderer.create(React.createElement(Organizer,props))})
    const pane=slot()
    assert.ok(pane,'one permanent quiet surface is present')
    assert.equal(pane.props.sx.minHeight,160)
    assert.equal(has('还没有相册'),false,'no false empty before first Server receipt')
    assert.equal(ring(),0)
    await act(async()=>{view.update(React.createElement(Organizer,{...props,indexPending:true}))})
    assert.ok(slot(),'same status owner stays present while pending')
    assert.equal(ring(),0,'no spinner on first pending frame')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,35))})
    assert.equal(ring(),0,'fast pending window remains quiet')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,360))})
    assert.ok(ring()>0,'real sustained wait shows existing shared 300ms spinner')
    assert.equal(has('还没有相册'),false)
    await act(async()=>{view.update(React.createElement(Organizer,{
      ...props,indexPending:false,indexError:true,
    }))})
    assert.equal(ring(),0)
    assert.equal(has('相册索引读取失败，请重试。'),true)
    const retry=view.root.findAll(n=>n.type==='button'&&n.props.children==='重试')[0]
    assert.ok(retry)
    assert.equal(retry.props.sx.minWidth,44)
    await act(async()=>{retry.props.onClick()})
    assert.equal(retries,1)
    await act(async()=>{view.update(React.createElement(Organizer,{
      ...props,indexVerified:true,indexPending:false,indexError:false,
    }))})
    assert.equal(has('还没有相册'),true,'only a confirmed canonical zero can advertise empty')
    assert.equal(view.root.findAll(n=>n.props?.['data-xdrive-gallery-album-index-read-state']!==undefined).length,1)
  }finally{
    if(view)await act(async()=>{view.unmount()})
  }
})
