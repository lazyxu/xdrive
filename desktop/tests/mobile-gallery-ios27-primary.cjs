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
const mocks={
  react:React, 'react/jsx-runtime':require('react/jsx-runtime'),
  '@mui/material': Object.fromEntries(['Box','Button','Stack','Typography'].map(s=>[s,s.toLowerCase()])),
  '@mui/icons-material/PhotoLibraryOutlined':'icon',
  './MediaGalleryPreviewMedia': {XDriveMediaAsyncThumbnail:'thumbnail'},
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
