const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const React=require('react')
const renderer=require('react-test-renderer')
const {act}=renderer
const root=path.resolve(__dirname,'../..')
const file=(p)=>fs.readFileSync(path.join(root,p),'utf8')
const sourcePath='ui/shared/src/mui/MobileGalleryCollections.tsx'
const compiled=ts.transpileModule(file(sourcePath),{
  fileName:sourcePath, compilerOptions:{
    module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX,
    target:ts.ScriptTarget.ES2022, esModuleInterop:true,
  },
}).outputText
const albumOrganizeSource=file('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts')
const albumOrganizeCompiled=ts.transpileModule(albumOrganizeSource,{
  fileName:'MediaGalleryAlbumOrganization.ts',compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  },
}).outputText
const albumOrganizeModule={exports:{}}
new Function('exports','module','require',albumOrganizeCompiled)(
  albumOrganizeModule.exports,albumOrganizeModule,()=>{throw Error('Unexpected album organization import')},
)
const sharedAlbumOrganization=albumOrganizeModule.exports
const mocks={
  react:React, 'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/material': Object.fromEntries(['Box','Button','IconButton','Menu','MenuItem','Stack','TextField','Typography'].map(s=>[s,s.toLowerCase()])),
  '@mui/icons-material/PhotoLibraryOutlined':'icon',
  '@mui/icons-material/GridViewRounded':'icon',
  '@mui/icons-material/KeyboardArrowRightRounded':'icon',
  '@mui/icons-material/DragIndicatorRounded':'icon',
  '@mui/icons-material/ArrowUpwardRounded':'icon',
  '@mui/icons-material/ArrowDownwardRounded':'icon',
  '@mui/icons-material/AddCircleOutlineRounded':'icon',
  '@mui/icons-material/RemoveCircleOutlineRounded':'icon',
  './MediaGalleryPreviewMedia': {XDriveMediaAsyncThumbnail:'thumbnail'},
  './MediaGalleryAlbumOrganization': sharedAlbumOrganization,
}
const output={exports:{}}
new Function('exports','module','require',compiled)(output.exports,output,
  name=>{if(!(name in mocks))throw Error('Unexpected import '+name);return mocks[name]})
const Collections=output.exports.XDriveMobileGalleryCollections
const data={
  albums:[{id:'a1',kind:'manual',name:'家庭',item_count:9,cover_node_id:81}],
  memories:[], people:[{id:'p1',name:'陈',hidden:false,item_count:2,cover_node_id:89}],
  pets:[], places:[],syncFolders:[],loadThumbnail:async()=>null,
}
const cards=view=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-collection-card'])
test('iOS 27 Collections renders bounded real-cover group and canonical actions',async()=>{
  const sections=[], albums=[], persons=[]
  let view
  await act(async()=>{view=renderer.create(React.createElement(Collections,{
    ...data,onOpenSection:s=>sections.push(s),
    onOpenAlbum:a=>albums.push(a.id),onOpenPerson:p=>persons.push(p.id),
  }))})
  assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-collections']).length)
  const card=key=>cards(view).find(x=>x.props['data-xdrive-mobile-gallery-collection-card']===key)
  assert.ok(card('favorites'))
  assert.ok(card('media-types'))
  assert.ok(card('memory-'+1)===undefined)
  assert.ok(card('memories'))
  assert.ok(card('album-a1'))
  assert.ok(card('person-p1'))
  assert.ok(view.root.findAll(x=>x.type==='thumbnail'&&x.props.nodeID===81).length)
  await act(async()=>{card('favorites').props.onClick()})
  await act(async()=>{card('album-a1').props.onClick()})
  await act(async()=>{card('person-p1').props.onClick()})
  assert.deepEqual(sections,['favorites'])
  assert.deepEqual(albums,['a1'])
  assert.deepEqual(persons,['p1'])
  assert.ok(cards(view).length<=22)
  await act(async()=>{view.unmount()})
})
test('Collections full-section actions remain reachable when preview cards are truncated', async () => {
  const sections = []
  const memories = Array.from({ length: 12 }, (_, i) => ({
    id: 'm' + i, title: '回忆' + i, item_count: 2,
  }))
  const albums = Array.from({ length: 12 }, (_, i) => ({
    id: 'a' + i, name: '相册' + i, kind: 'manual', item_count: 2,
  }))
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Collections, {
      ...data, memories, albums,
      onOpenMemory: () => {}, onOpenAlbum: () => {},
      onOpenPerson: () => {},
      onOpenSection: (section) => sections.push(section),
    }))
  })
  const keys = cards(view).map((c) => c.props['data-xdrive-mobile-gallery-collection-card'])
  assert.equal(keys.filter((k) => k?.startsWith('memory-')).length, 8)
  assert.equal(keys.filter((k) => k?.startsWith('album-')).length, 8)
  for (const [title, expected] of [
    ['回忆', 'memories'], ['相册', 'albums'], ['人物与宠物', 'people'],
  ]) {
    const all = view.root.findAll((x) => x.props?.['data-xdrive-mobile-gallery-view-all'] === title)[0]
    assert.ok(all, 'missing full collection route: ' + title)
    await act(async () => { all.props.onClick() })
    assert.equal(sections.at(-1), expected)
  }
  assert.ok(!keys.includes('memory-m8'), 'bounded preview must not pretend to show all')
  await act(async () => { view.unmount() })
})

test('iOS 27 Collections does not render invented people or hidden identities',async()=>{
  let view
  await act(async()=>{view=renderer.create(React.createElement(Collections,{
    ...data,albums:[],memories:[],people:[{id:'hidden',name:'隐私',hidden:true,item_count:1}],
    onOpenSection:()=>{},onOpenPerson:()=>{},
  }))})
  const allKeys=cards(view).map(x=>x.props['data-xdrive-mobile-gallery-collection-card'])
  assert.ok(!allKeys.includes('person-hidden'))
  assert.ok(!allKeys.includes('album-a1'))
  assert.ok(allKeys.includes('favorites'))
  await act(async()=>{view.unmount()})
})
test('iOS 27 Mobile Gallery new source retains original Viewer/server/navigation contracts',()=>{
  const gallery=file('ui/shared/src/mui/MediaGallery.tsx')
  const chrome=file('ui/shared/src/mui/MobileGalleryChrome.tsx')
  const app=file('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(gallery,/mobileCollectionsOverview/)
  assert.match(gallery,/onMobilePrimaryTabChange/)
  assert.match(gallery,/onVisibleAnchorNode=\{rememberMobileGalleryAnchor\}/)
  assert.match(gallery,/virtualCollection\.primePage\(/)
  assert.match(gallery,/onOpenViewer=\{onOpenViewer/)
  assert.match(chrome,/data-xdrive-mobile-gallery-primary-tabs/)
  assert.doesNotMatch(chrome,/data-xdrive-mobile-gallery-category/)
  assert.match(app,/calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.doesNotMatch(file(sourcePath),/listItemRange\(|fetch\(|new XMLHttpRequest\(/)
  assert.match(file(sourcePath), /IntersectionObserver/)
  assert.match(file(sourcePath), /rootMargin: '180px'/)
  assert.match(file(sourcePath), /nearViewport && nodeID/)
})


test('P0-3a Mobile pinned albums use the same account-scoped Web album order', async () => {
  const previousWindow=global.window
  const storage=new Map()
  global.window={localStorage:{
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
  }}
  const albums=Array.from({length:12},(_,i)=>({
    id:'a'+i,kind:'manual',name:'相册'+i,
    item_count:10+i,cover_node_id:100+i,
  }))
  sharedAlbumOrganization.writeMediaAlbumPreferences('owner-A',{
    sort:'name',pinned:['a9','a2','gone'],order:[],
  })
  sharedAlbumOrganization.writeMediaAlbumPreferences('owner-B',{
    sort:'name',pinned:['a4'],order:[],
  })
  const opened=[],sections=[]
  let view
  try {
    const render=scope=>React.createElement(Collections,{
      ...data,albums,accountScope:scope,
      onOpenAlbum:album=>opened.push(album.id),
      onOpenSection:section=>sections.push(section),
    })
    await act(async()=>{view=renderer.create(render('owner-A'))})
    const pinned=()=>cards(view).filter(c=>
      String(c.props['data-xdrive-mobile-gallery-collection-card']).startsWith('pinned-album-'))
    assert.deepEqual(pinned().map(c=>c.props['data-xdrive-mobile-gallery-collection-card']),[
      'pinned-album-a9','pinned-album-a2',
    ])
    assert.ok(view.root.findAll(x=>x.type==='thumbnail'&&x.props.nodeID===109).length)
    await act(async()=>{pinned()[0].props.onClick()})
    assert.deepEqual(opened,['a9'])
    assert.equal(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-view-all']==='固定项目').length,0,
      'Pinned has its own Edit action; it must not masquerade as the full Albums route')
    const edit=view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0]
    assert.ok(edit,'all pinned items remain accessible from the existing editor')
    await act(async()=>{edit.props.onClick()})
    assert.deepEqual(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-row'])
      .map(x=>x.props['data-xdrive-mobile-gallery-pin-row']).slice(-2),[
      'pinned-album-a9','pinned-album-a2',
    ])
    await act(async()=>{view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-pinned-done'])[0].props.onClick()})
    const albumsHeading=view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-view-all']==='相册')[0]
    assert.ok(albumsHeading,'native Albums heading retains the canonical Albums route')
    await act(async()=>{albumsHeading.props.onClick()})
    assert.deepEqual(sections,['albums'])
    await act(async()=>{view.update(render('owner-B'))})
    assert.deepEqual(pinned().map(c=>c.props['data-xdrive-mobile-gallery-collection-card']),[
      'pinned-album-a4',
    ],'an account switch cannot leak prior album pins')
    await act(async()=>{view.update(render(''))})
    assert.equal(pinned().length,0,'empty/unauthenticated scope has no saved pin state')
  } finally {
    if(view) await act(async()=>{view.unmount()})
    global.window=previousWindow
  }
})

test('P0-3a Collections filters empty memories before bounding preview',async()=>{
  const memories=Array.from({length:13},(_,i)=>({
    id:'m'+i,title:'回忆'+i,item_count:i<9?0:2,cover_node_id:200+i,
  }))
  let view
  const opened=[]
  try {
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,memories,onOpenMemory:m=>opened.push(m.id),onOpenSection:()=>{},
    }))})
    const visible=cards(view).filter(c=>
      String(c.props['data-xdrive-mobile-gallery-collection-card']).startsWith('memory-'))
    assert.deepEqual(visible.map(c=>c.props['data-xdrive-mobile-gallery-collection-card']),[
      'memory-m9','memory-m10','memory-m11','memory-m12',
    ])
    await act(async()=>{visible[0].props.onClick()})
    assert.deepEqual(opened,['m9'])
    assert.equal(cards(view).some(c=>c.props['data-xdrive-mobile-gallery-collection-card']==='memories'),false)
  } finally {if(view)await act(async()=>{view.unmount()})}
})


test('P0-3b iOS 27 Collections layout modes change card geometry and persist per account', async () => {
  const previousWindow=global.window
  const values=new Map()
  global.window={localStorage:{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,v)=>values.set(key,String(v)),
  }}
  let view
  const create=scope=>React.createElement(Collections,{
    ...data,accountScope:scope,onOpenSection:()=>{},onOpenAlbum:()=>{},
  })
  const layouts=view=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-option'])
  const tileWidth=()=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-card-width']!==undefined)[0]
    .props['data-xdrive-mobile-gallery-card-width']
  const clickOption=async mode=>{
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-trigger'])[0]
        .props.onClick({currentTarget:{}})
    })
    assert.equal(view.root.findAll(x=>x.type==='menu'&&x.props.open).length,1)
    const option=layouts(view).find(x=>x.props['data-xdrive-mobile-gallery-layout-option']===mode)
    assert.ok(option)
    await act(async()=>{option.props.onClick()})
  }
  try {
    await act(async()=>{view=renderer.create(create('owner-A'))})
    assert.equal(tileWidth(),132,'mixed default is not silently the large/small layout')
    await clickOption('large')
    assert.equal(tileWidth(),196)
    await clickOption('small')
    assert.equal(tileWidth(),104)
    await clickOption('mixed')
    assert.equal(tileWidth(),132)
    const stored=JSON.parse(values.get(
      'xdrive.gallery.mobile.collections.layout.v1:owner-A'))
    assert.equal(stored.layout,'mixed')
    await clickOption('large')
    await act(async()=>{view.update(create('owner-B'))})
    assert.equal(tileWidth(),132,'switching owners must not retain the prior layout')
    await act(async()=>{view.update(create('owner-A'))})
    assert.equal(tileWidth(),196,'return restores the account-scoped layout')
    await act(async()=>{view.unmount()})
  }finally{
    global.window=previousWindow
  }
})

test('P0-3b individual and all-group collapse hide thumbnails without hiding actions', async()=>{
  const previousWindow=global.window
  const storage=new Map()
  global.window={localStorage:{
    getItem:key=>storage.get(key)||null,
    setItem:(key,v)=>storage.set(key,String(v)),
  }}
  let view
  const sections=[]
  const props={...data,accountScope:'owner-X',onOpenSection:s=>sections.push(s),
    onOpenAlbum:()=>{}}
  const toggle=id=>view.root.findAll(x=>
    x.props?.['data-xdrive-mobile-gallery-collapse-group']===id)[0]
  const findCard=id=>cards(view).find(x=>x.props['data-xdrive-mobile-gallery-collection-card']===id)
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,props))})
    assert.ok(view.root.findAll(x=>x.type==='thumbnail').length>0)
    const pinned=toggle('pinned')
    assert.equal(pinned.props['aria-expanded'],true)
    assert.equal(pinned.props.sx.minHeight,44)
    assert.equal(pinned.props.sx.minWidth,44)
    await act(async()=>{pinned.props.onClick()})
    assert.equal(toggle('pinned').props['aria-expanded'],false)
    assert.ok(findCard('favorites'),'a collapsed group retains its accessible routes')
    await act(async()=>{findCard('favorites').props.onClick()})
    assert.deepEqual(sections,['favorites'])
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-trigger'])[0]
        .props.onClick({currentTarget:{}})
    })
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-collapse-all'])[0]
        .props.onClick()
    })
    assert.equal(view.root.findAll(x=>x.type==='thumbnail').length,0,
      'collapsed preview covers must unmount to release image requests')
    assert.ok(findCard('album-a1'))
    assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-view-all']==='相册').length)
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-expand-all'])[0]
        .props.onClick()
    })
    assert.ok(view.root.findAll(x=>x.type==='thumbnail').length>0)
    const saved=JSON.parse(storage.get('xdrive.gallery.mobile.collections.layout.v1:owner-X'))
    assert.deepEqual(saved.collapsed,[])
  }finally{
    if(view)await act(async()=>{view.unmount()})
    global.window=previousWindow
  }
})

test('P0-3b stored collection layout is bounded and ignores invalid group names',()=>{
  const read=output.exports.xDriveReadMobileGalleryCollectionsPresentation
  const write=output.exports.xDriveWriteMobileGalleryCollectionsPresentation
  const previous=global.window
  const state=new Map()
  global.window={localStorage:{
    getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,String(v)),
  }}
  try{
    state.set('xdrive.gallery.mobile.collections.layout.v1:scope',
      JSON.stringify({layout:'unknown',collapsed:['bad','pinned','pinned','memories']}))
    assert.deepEqual(read('scope'),{layout:'mixed',collapsed:['pinned','memories']})
    write('scope',{layout:'small',collapsed:['albums','bad','albums']})
    assert.deepEqual(read('scope'),{layout:'small',collapsed:['albums']})
    write('',{layout:'large',collapsed:[]})
    assert.equal(state.has('xdrive.gallery.mobile.collections.layout.v1:'),false)
    assert.deepEqual(read(''),{layout:'mixed',collapsed:[]})
  }finally{global.window=previous}
})

test('P0-3b bounded collection widths do not depend on media count or viewport',()=>{
  const width=output.exports.xDriveMobileGalleryCollectionTileWidth
  for(const group of ['pinned','memories','albums','people','places','sync-folders','utilities']){
    assert.equal(width('large',group),196)
    assert.equal(width('small',group),104)
    assert.ok(width('mixed',group)>=104 && width('mixed',group)<=196)
  }
  assert.match(file(sourcePath),/COLLECTIONS_LAYOUT_KEY/)
  assert.doesNotMatch(file(sourcePath),/listItemRange\(|new XMLHttpRequest\(|fetch\(/)
})


test('P0-3c1 normalized group order is scoped, forwards compatible and movable',()=>{
  const normalize=output.exports.xDriveNormalizeMobileGalleryGroupOrder
  const move=output.exports.xDriveMoveMobileGalleryGroup
  const read=output.exports.xDriveReadMobileGalleryGroupOrder
  const write=output.exports.xDriveWriteMobileGalleryGroupOrder
  const defaultOrder=['pinned','memories','albums','people','places','sync-folders','utilities']
  assert.deepEqual(normalize(['albums','albums','invalid','pinned']),[
    'albums','pinned','memories','people','places','sync-folders','utilities',
  ])
  assert.deepEqual(move(defaultOrder,'albums','pinned'),[
    'albums','pinned','memories','people','places','sync-folders','utilities',
  ])
  assert.deepEqual(move(defaultOrder,'pinned','albums'),[
    'memories','albums','pinned','people','places','sync-folders','utilities',
  ])
  assert.deepEqual(move(defaultOrder,'pinned','pinned'),defaultOrder)
  const oldWindow=global.window,storage=new Map()
  global.window={localStorage:{
    getItem:k=>storage.get(k)||null,
    setItem:(k,v)=>storage.set(k,String(v)),
  }}
  try{
    write('owner-A',['albums','pinned','memories'])
    assert.deepEqual(read('owner-A').slice(0,3),['albums','pinned','memories'])
    assert.deepEqual(read('owner-B'),defaultOrder)
    write('',['albums','pinned'])
    assert.equal(storage.has('xdrive.gallery.mobile.collections.group-order.v1:'),false)
    storage.set('xdrive.gallery.mobile.collections.group-order.v1:broken','{broken')
    assert.deepEqual(read('broken'),defaultOrder)
    assert.deepEqual(read(''),defaultOrder)
  }finally{global.window=oldWindow}
})

test('P0-3c1 rendered editor supports long-touch drag, keyboard and account restore',async()=>{
  const oldWindow=global.window,oldDocument=global.document,oldNow=Date.now
  const storage=new Map()
  let clock=1000,view
  Date.now=()=>clock
  global.window={localStorage:{
    getItem:k=>storage.get(k)||null,
    setItem:(k,v)=>storage.set(k,String(v)),
  }}
  const render=accountScope=>React.createElement(Collections,{
    ...data,accountScope,onOpenAlbum:()=>{},onOpenSection:()=>{},
  })
  const rows=()=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-row'])
    .map(x=>x.props['data-xdrive-mobile-gallery-reorder-row'])
  const control=(name,id)=>view.root.findAll(x=>x.props?.[name]===id)[0]
  const e={
    pointerId:9,pointerType:'touch',button:0,clientX:20,clientY:40,
    currentTarget:{
      setPointerCapture:()=>{},hasPointerCapture:()=>true,
      releasePointerCapture:()=>{},
    },preventDefault:()=>{},
  }
  try {
    await act(async()=>{view=renderer.create(render('owner-A'))})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-bottom'])[0].props.onClick()})
    assert.deepEqual(rows(),['pinned','memories','albums','people','utilities'])
    await act(async()=>{control('data-xdrive-mobile-gallery-reorder-down','pinned').props.onClick()})
    assert.deepEqual(rows(),['memories','pinned','albums','people','utilities'])
    const handle=control('data-xdrive-mobile-gallery-reorder-handle','albums')
    assert.equal(handle.props.sx.minHeight,44)
    assert.equal(handle.props.sx.minWidth,44)
    global.document={elementFromPoint:()=>({closest:()=>({
      getAttribute:()=> 'pinned',
    })})}
    await act(async()=>{handle.props.onPointerDown(e)})
    clock+=100
    await act(async()=>{control('data-xdrive-mobile-gallery-reorder-handle','albums')
      .props.onPointerMove({...e,clientY:100})})
    assert.deepEqual(rows(),['memories','pinned','albums','people','utilities'],
      'drag before touch hold threshold must not move')
    clock+=200
    await act(async()=>{control('data-xdrive-mobile-gallery-reorder-handle','albums')
      .props.onPointerMove({...e,clientY:100})})
    assert.deepEqual(rows(),['memories','albums','pinned','people','utilities'])
    await act(async()=>{control('data-xdrive-mobile-gallery-reorder-handle','albums')
      .props.onPointerUp(e)})
    const keyHandle=control('data-xdrive-mobile-gallery-reorder-handle','pinned')
    await act(async()=>{keyHandle.props.onKeyDown({key:'ArrowUp',preventDefault:()=>{}})})
    assert.deepEqual(rows(),['memories','pinned','albums','people','utilities'])
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-done'])[0].props.onClick()})
    const groups=()=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-collection-group-id'])
      .map(x=>x.props['data-xdrive-mobile-gallery-collection-group-id'])
    assert.deepEqual(groups(),['memories','pinned','albums','people','utilities'])
    assert.ok(cards(view).find(x=>x.props['data-xdrive-mobile-gallery-collection-card']==='favorites'))
    await act(async()=>{view.update(render('owner-B'))})
    assert.deepEqual(groups(),['pinned','memories','albums','people','utilities'])
    await act(async()=>{view.update(render('owner-A'))})
    assert.deepEqual(groups(),['memories','pinned','albums','people','utilities'])
  }finally{
    if(view)await act(async()=>{view.unmount()})
    global.document=oldDocument
    global.window=oldWindow
    Date.now=oldNow
  }
})

test('P0-3c1 Layout menu and bottom action open the exact same reorder editor',async()=>{
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,onOpenSection:()=>{},
    }))})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-trigger'])[0]
      .props.onClick({currentTarget:{}})})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-layout-reorder'])[0]
      .props.onClick()})
    assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-editor']).length)
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-done'])[0].props.onClick()})
    assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-reorder-bottom']).length)
  }finally{if(view)await act(async()=>{view.unmount()})}
})


test('P0-3c2 mobile pinned keys normalize, preserve empty, and isolate accounts',()=>{
  const normalize=output.exports.xDriveNormalizeMobileGalleryPinnedKeys
  const move=output.exports.xDriveMoveMobileGalleryPinnedKey
  const read=output.exports.xDriveReadMobileGalleryPinnedKeys
  const write=output.exports.xDriveWriteMobileGalleryPinnedKeys
  assert.deepEqual(normalize(null),['favorites','albums','people','media-types'])
  assert.deepEqual(normalize([]),[],'explicitly clearing all pins must stay empty')
  assert.deepEqual(normalize(['favorites','favorites','trash','bad','pinned-album-a1','pinned-album-']),[
    'favorites','trash','pinned-album-a1',
  ])
  assert.deepEqual(move(['favorites','albums','pinned-album-a1'],'pinned-album-a1','favorites'),[
    'pinned-album-a1','favorites','albums',
  ])
  assert.deepEqual(move(['favorites','albums'],'nope','albums'),['favorites','albums'])
  const prev=global.window,store=new Map()
  global.window={localStorage:{
    getItem:k=>store.has(k)?store.get(k):null,
    setItem:(k,v)=>store.set(k,String(v)),
  }}
  try{
    write('owner-A',['trash','pinned-album-a1'])
    assert.deepEqual(read('owner-A'),['trash','pinned-album-a1'])
    assert.deepEqual(read('owner-B'),['favorites','albums','people','media-types'])
    write('owner-A',[])
    assert.deepEqual(read('owner-A'),[])
    write('',['trash'])
    assert.equal(store.has('xdrive.gallery.mobile.collections.pinned-order.v1:'),false)
    store.set('xdrive.gallery.mobile.collections.pinned-order.v1:broken','{')
    assert.deepEqual(read('broken'),['favorites','albums','people','media-types'])
  }finally{global.window=prev}
})

test('P0-3c2 pinned editor uses the canonical Web/Desktop album pin store',async()=>{
  const old=global.window,store=new Map()
  global.window={localStorage:{
    getItem:k=>store.has(k)?store.get(k):null,
    setItem:(k,v)=>store.set(k,String(v)),
  }}
  const albums=[{id:'a1',kind:'manual',name:'家庭',item_count:9,cover_node_id:81},
    {id:'a2',kind:'smart',name:'摄影',item_count:8,cover_node_id:82}]
  const opened=[],sections=[]
  const render=scope=>React.createElement(Collections,{
    ...data,albums,accountScope:scope,onOpenAlbum:a=>opened.push(a.id),
    onOpenSection:s=>sections.push(s),
  })
  let view
  const item=(id)=>cards(view).find(x=>x.props['data-xdrive-mobile-gallery-collection-card']===id)
  const control=(attr,id)=>view.root.findAll(x=>x.props?.[attr]===id)[0]
  try{
    await act(async()=>{view=renderer.create(render('owner-A'))})
    assert.ok(control('data-xdrive-mobile-gallery-edit-pinned',true) ||
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned']).length)
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0].props.onClick()
    })
    assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pinned-editor']).length)
    const add=async key=>await act(async()=>{control('data-xdrive-mobile-gallery-pin-add',key).props.onClick()})
    const remove=async key=>{
      await act(async()=>{control('data-xdrive-mobile-gallery-pin-remove',key)
        .props.onClick({currentTarget:{}})})
      assert.ok(view.root.findAll(x=>x.props?.['aria-label']==='确认取消固定'&&x.props.open).length)
      await act(async()=>{view.root.findAll(x=>
        x.props?.['data-xdrive-mobile-gallery-pin-confirm-remove'])[0].props.onClick()})
    }
    await add('pinned-album-a1')
    await add('pinned-album-a2')
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1','a2'],
      'both widths share one canonical pin preference')
    const keys=()=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-row'])
      .map(x=>x.props['data-xdrive-mobile-gallery-pin-row'])
    assert.deepEqual(keys().slice(-2),['pinned-album-a1','pinned-album-a2'])
    await act(async()=>{control('data-xdrive-mobile-gallery-pin-up','pinned-album-a2').props.onClick()})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a2','a1'])
    await remove('pinned-album-a1')
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a2'])
    await add('memories')
    assert.ok(keys().includes('memories'))
    await remove('favorites')
    assert.ok(!keys().includes('favorites'))
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pinned-done'])[0].props.onClick()})
    assert.ok(item('pinned-album-a2'))
    assert.ok(item('memories'))
    assert.ok(!item('favorites'))
    await act(async()=>{item('pinned-album-a2').props.onClick()})
    await act(async()=>{item('memories').props.onClick()})
    assert.deepEqual(opened,['a2'])
    assert.deepEqual(sections,['memories'])
    await act(async()=>{view.update(render('owner-B'))})
    assert.ok(item('favorites'))
    assert.ok(!item('pinned-album-a2'))
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-B').pinned,[])
    await act(async()=>{view.update(render('owner-A'))})
    assert.ok(item('pinned-album-a2'))
    assert.ok(!item('favorites'))
  }finally{
    if(view)await act(async()=>{view.unmount()})
    global.window=old
  }
})

test('P0-3c2 all pins can be removed without losing the edit entry',async()=>{
  const old=global.window,store=new Map()
  global.window={localStorage:{
    getItem:k=>store.has(k)?store.get(k):null,
    setItem:(k,v)=>store.set(k,String(v)),
  }}
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,accountScope:'owner-A',onOpenSection:()=>{},
    }))})
    const edit=()=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0]
    await act(async()=>{edit().props.onClick()})
    for(const id of ['favorites','albums','people','media-types']){
      await act(async()=>{view.root.findAll(x=>
        x.props?.['data-xdrive-mobile-gallery-pin-remove']===id)[0]
        .props.onClick({currentTarget:{}})})
      await act(async()=>{view.root.findAll(x=>
        x.props?.['data-xdrive-mobile-gallery-pin-confirm-remove'])[0]
        .props.onClick()})
    }
    assert.equal(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-row']).length,0)
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pinned-done'])[0].props.onClick()})
    assert.ok(edit(),'an empty pinned group must still be editable')
    await act(async()=>{edit().props.onClick()})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-add']==='favorites')[0].props.onClick()})
    assert.ok(view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-row']==='favorites').length)
  }finally{if(view)await act(async()=>{view.unmount()});global.window=old}
})

test('P0-3c2 touch handle reorders actual pinned albums after hold and preserves 44px controls',async()=>{
  const oldWindow=global.window,oldDocument=global.document,oldNow=Date.now
  const store=new Map()
  global.window={localStorage:{
    getItem:k=>store.has(k)?store.get(k):null,
    setItem:(k,v)=>store.set(k,String(v)),
  }}
  const albums=[
    {id:'a1',kind:'manual',name:'家庭',item_count:9,cover_node_id:81},
    {id:'a2',kind:'manual',name:'工作',item_count:6,cover_node_id:82},
  ]
  sharedAlbumOrganization.writeMediaAlbumPreferences('owner-A',{
    sort:'name',pinned:['a1','a2'],order:[],
  })
  let view,clock=1000
  Date.now=()=>clock
  const event={pointerId:7,pointerType:'touch',button:0,clientX:10,clientY:25,
    currentTarget:{setPointerCapture:()=>{},hasPointerCapture:()=>true,releasePointerCapture:()=>{}},
    preventDefault:()=>{}}
  const find=(id)=>view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-handle']===id)[0]
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,albums,accountScope:'owner-A',onOpenAlbum:()=>{},onOpenSection:()=>{},
    }))})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0].props.onClick()})
    assert.equal(find('pinned-album-a2').props.sx.minWidth,44)
    assert.equal(find('pinned-album-a2').props.sx.minHeight,44)
    global.document={elementFromPoint:()=>({closest:()=>({
      getAttribute:()=> 'pinned-album-a1',
    })})}
    await act(async()=>{find('pinned-album-a2').props.onPointerDown(event)})
    clock+=100
    await act(async()=>{find('pinned-album-a2').props.onPointerMove({...event,clientY:70})})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1','a2'])
    clock+=160
    await act(async()=>{find('pinned-album-a2').props.onPointerMove({...event,clientY:70})})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a2','a1'])
    await act(async()=>{find('pinned-album-a2').props.onPointerCancel(event)})
    await act(async()=>{find('pinned-album-a1').props.onKeyDown({key:'ArrowUp',preventDefault:()=>{}})})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1','a2'])
  }finally{
    if(view)await act(async()=>{view.unmount()})
    Date.now=oldNow;global.document=oldDocument;global.window=oldWindow
  }
})

test('P0-3c2 album suggestions stay bounded while search reaches any real album',async()=>{
  const old=global.window,storage=new Map()
  global.window={localStorage:{
    getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),
  }}
  const albums=Array.from({length:120},(_,i)=>({
    id:'a'+i,kind:'manual',name:'相册-'+i,item_count:2,
  }))
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,albums,accountScope:'owner-A',onOpenAlbum:()=>{},onOpenSection:()=>{},
    }))})
    await act(async()=>{view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0].props.onClick()})
    const list=()=>view.root.findAll(x=>String(x.props?.['data-xdrive-mobile-gallery-pin-add']).startsWith('pinned-album-'))
    assert.equal(list().length,48,'the editor must not mount every album suggestion')
    await act(async()=>{
      view.root.findAll(x=>x.props?.label==='搜索精选集或相册')[0]
        .props.onChange({target:{value:'相册-119'}})
    })
    const matching=view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-pin-add']==='pinned-album-a119')[0]
    assert.ok(matching,'search must reach albums beyond the preview limit')
    await act(async()=>{matching.props.onClick()})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a119'])
  }finally{if(view)await act(async()=>{view.unmount()});global.window=old}
})


test('P0-3d keyboard context menu pins and unpins real albums through canonical store',async()=>{
  const old=global.window,store=new Map()
  global.window={localStorage:{
    getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),
  }}
  const albums=[{id:'a1',kind:'manual',name:'家庭',item_count:4,cover_node_id:81}]
  const opened=[]
  let view
  const albumCard=()=>cards(view).find(x=>
    x.props['data-xdrive-mobile-gallery-collection-card']==='album-a1')
  const menu=()=>view.root.findAll(x=>x.props?.['aria-label']==='精选集快速固定菜单'
    && x.props.open)[0]
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,albums,accountScope:'owner-A',onOpenAlbum:a=>opened.push(a.id),
      onOpenSection:()=>{},
    }))})
    assert.ok(albumCard())
    let prevented=0,stopped=0
    await act(async()=>{albumCard().props.onContextMenu({
      currentTarget:{},preventDefault:()=>prevented++,stopPropagation:()=>stopped++,
    })})
    assert.equal(prevented,1)
    assert.equal(stopped,1)
    assert.ok(menu())
    const action=()=>view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-quick-pin-action'])[0]
    assert.equal(action().children.includes('固定'),true)
    await act(async()=>{action().props.onClick()})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1'])
    assert.ok(cards(view).find(x=>
      x.props['data-xdrive-mobile-gallery-collection-card']==='pinned-album-a1'))
    await act(async()=>{albumCard().props.onContextMenu({
      currentTarget:{},preventDefault:()=>{},stopPropagation:()=>{},
    })})
    assert.ok(menu())
    assert.equal(action().children.includes('取消固定'),true)
    await act(async()=>{action().props.onClick()})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,[])
    await act(async()=>{albumCard().props.onClick()})
    assert.deepEqual(opened,['a1'],'normal short tap still uses unchanged album opening')
  }finally{if(view)await act(async()=>{view.unmount()});global.window=old}
})

test('P0-3d touch hold opens quick Pin only after 450ms and suppresses synthetic click',async()=>{
  const oldWindow=global.window,oldSetTimeout=global.setTimeout
  const oldClearTimeout=global.clearTimeout
  const oldNow=Date.now
  const store=new Map()
  global.window={localStorage:{
    getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),
  }}
  let scheduled=null,cancelled=[],now=1000,view
  Date.now=()=>now
  const open=[]
  const evt={pointerId:6,pointerType:'touch',clientX:20,clientY:40,
    currentTarget:{},preventDefault:()=>{},
  }
  const favorite=()=>cards(view).find(x=>
    x.props['data-xdrive-mobile-gallery-collection-card']==='favorites')
  const menu=()=>view.root.findAll(x=>x.props?.['aria-label']==='精选集快速固定菜单'
    && x.props.open)
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,accountScope:'owner-A',onOpenSection:s=>open.push(s),
    }))})
    global.setTimeout=(callback,delay)=>{scheduled={callback,delay};return 9001}
    global.clearTimeout=(id)=>{cancelled.push(id);scheduled=null}
    await act(async()=>{favorite().props.onPointerDown(evt)})
    assert.equal(scheduled?.delay,450)
    now+=100
    await act(async()=>{favorite().props.onPointerMove({...evt,clientX:30})})
    assert.deepEqual(cancelled,[9001],'moving 10px cancels the hold')
    assert.equal(menu().length,0)
    await act(async()=>{favorite().props.onPointerDown(evt)})
    await act(async()=>{favorite().props.onPointerLeave(evt)})
    assert.deepEqual(cancelled,[9001,9001],'pointer leaving cancels its held timer')
    await act(async()=>{favorite().props.onClick()})
    assert.deepEqual(open,['favorites'],'a cancelled hold must still allow short tap')
    await act(async()=>{favorite().props.onPointerDown(evt)})
    assert.equal(scheduled?.delay,450)
    now+=450
    await act(async()=>{scheduled.callback()})
    assert.equal(menu().length,1)
    now += 2500
    await act(async()=>{favorite().props.onPointerUp(evt)})
    await act(async()=>{favorite().props.onClick()})
    assert.deepEqual(open,['favorites'],'post-long-press click must not also navigate')
    await act(async()=>{
      view.root.findAll(x=>x.props?.['data-xdrive-mobile-gallery-quick-pin-action'])[0]
        .props.onClick()
    })
    assert.ok(!cards(view).some(x=>
      x.props['data-xdrive-mobile-gallery-collection-card']==='favorites'))
    await act(async()=>{view.update(React.createElement(Collections,{
      ...data,accountScope:'owner-B',onOpenSection:s=>open.push(s),
    }))})
    assert.ok(cards(view).some(x=>
      x.props['data-xdrive-mobile-gallery-collection-card']==='favorites'),
      'a fast unpin must not leak into other accounts')
  }finally{
    if(view)await act(async()=>{view.unmount()})
    global.window=oldWindow;global.setTimeout=oldSetTimeout
    global.clearTimeout=oldClearTimeout;Date.now=oldNow
  }
})

test('P0-3d removal confirmation offers cancel and performs no album deletion',async()=>{
  const old=global.window,store=new Map()
  global.window={localStorage:{
    getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),
  }}
  const albums=[{id:'a1',kind:'manual',name:'家庭',item_count:7,cover_node_id:81}]
  let view
  const openEdit=async()=>await act(async()=>{view.root.findAll(x=>
    x.props?.['data-xdrive-mobile-gallery-edit-pinned'])[0].props.onClick()})
  const remove=async()=>await act(async()=>{view.root.findAll(x=>
    x.props?.['data-xdrive-mobile-gallery-pin-remove']==='pinned-album-a1')[0]
    .props.onClick({currentTarget:{}})})
  try{
    sharedAlbumOrganization.writeMediaAlbumPreferences('owner-A',{
      sort:'name',pinned:['a1'],order:[],
    })
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,albums,accountScope:'owner-A',onOpenAlbum:()=>{},
      onOpenSection:()=>{},
    }))})
    await openEdit()
    await remove()
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1'],
      'remove button only opens a confirmation')
    const dialog=()=>view.root.findAll(x=>x.props?.['aria-label']==='确认取消固定'&&x.props.open)
    assert.equal(dialog().length,1)
    await act(async()=>{view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-pin-cancel-remove'])[0].props.onClick()})
    assert.equal(dialog().length,0)
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,['a1'])
    await remove()
    await act(async()=>{view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-pin-confirm-remove'])[0].props.onClick()})
    assert.deepEqual(sharedAlbumOrganization.readMediaAlbumPreferences('owner-A').pinned,[])
    assert.equal(albums.length,1,'unpin does not mutate or delete the actual album')
  }finally{if(view)await act(async()=>{view.unmount()});global.window=old}
})

test('P0-3d unsupported People/Memory and folder previews retain original tap actions',async()=>{
  let view
  const opened=[]
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,memories:[{id:'m1',title:'旅途',item_count:2}],
      onOpenSection:()=>{},onOpenMemory:m=>opened.push(m.id),
    }))})
    const memory=cards(view).find(x=>
      x.props?.['data-xdrive-mobile-gallery-collection-card']==='memory-m1')
    assert.ok(memory)
    await act(async()=>{memory.props.onContextMenu({
      currentTarget:{},preventDefault:()=>{throw Error('unsupported item pinned')},
      stopPropagation:()=>{},
    })})
    assert.equal(view.root.findAll(x=>
      x.props?.['aria-label']==='精选集快速固定菜单'&&x.props.open).length,0)
    await act(async()=>{memory.props.onClick()})
    assert.deepEqual(opened,['m1'])
  }finally{if(view)await act(async()=>{view.unmount()})}
})


test('P0-3e iOS 27 tappable section headings open the existing full collection route',async()=>{
  const sections=[]
  const places=[{id:'geo1',name:'苏州',latitude:31.3,longitude:120.6,
    item_count:2,cover_node_id:109}]
  const folders=[{source_id:9,source_name:'本机备份',source_kind:'local_folder',
    source_status:'ready',target_node_id:99,target_name:'照片',
    target_path:'/Photos',direct_media_count:5,child_folder_count:0}]
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,places,syncFolders:folders,onOpenSection:s=>sections.push(s),
      onOpenAlbum:()=>{},onOpenPerson:()=>{},onOpenPlace:()=>{},
      onOpenSyncFolder:()=>{},
    }))})
    const heading=(id)=>view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-section-heading']===id)[0]
    const expected=[
      ['memories','回忆','memories'],
      ['albums','相册','albums'],
      ['people','人物与宠物','people'],
      ['places','地点','places'],
      ['sync-folders','同步文件夹','albums'],
    ]
    for(const [id,title,section] of expected){
      const button=heading(id)
      assert.ok(button,'missing real aggregate heading '+id)
      assert.equal(button.props['data-xdrive-mobile-gallery-view-all'],title)
      assert.equal(button.props['aria-label'],'查看全部'+title)
      assert.equal(button.props.sx.minHeight,44)
      assert.equal(button.props.sx.textTransform,'none')
      await act(async()=>{button.props.onClick()})
      assert.equal(sections.at(-1),section)
    }
    assert.deepEqual(sections,['memories','albums','people','places','albums'])
    assert.equal(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-section-heading']==='pinned').length,0)
    assert.equal(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-section-heading']==='utilities').length,0)
    assert.ok(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-edit-pinned']).length,
      'Pinned remains editable even without an invented full-Pinned route')
    const albumGroup=view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-collection-group-id']==='albums')[0]
    const actions=albumGroup.findAll(x=>x.props?.['data-xdrive-mobile-gallery-view-all']==='相册')
    assert.equal(actions.length,1,'a section must not have a second redundant View All action')
  }finally {if(view)await act(async()=>{view.unmount()})}
})

test('P0-3e collapsed section title remains a 44px reachable route without waking covers',async()=>{
  const sections=[]
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Collections,{
      ...data,onOpenSection:s=>sections.push(s),onOpenAlbum:()=>{},
    }))})
    const albums=()=>view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-section-heading']==='albums')[0]
    const fold=view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-collapse-group']==='albums')[0]
    await act(async()=>{fold.props.onClick()})
    assert.equal(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-collapse-group']==='albums')[0]
      .props['aria-expanded'],false)
    assert.equal(albums().props.sx.minHeight,44)
    await act(async()=>{albums().props.onClick()})
    assert.deepEqual(sections,['albums'])
    assert.ok(view.root.findAll(x=>
      x.props?.['data-xdrive-mobile-gallery-collection-card']==='album-a1').length,
      'the album identity remains present in the collapsed text-only view')
  }finally{if(view)await act(async()=>{view.unmount()})}
})
