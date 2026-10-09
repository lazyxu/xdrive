import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryPage } from '@probe/gallery'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const stamp = '2026-10-09T12:00:00Z'
const makeItems = (startID: number, count = 4) => Array.from({ length: count }, (_, index) => ({
  node: { id: startID + index, name: `人物照片-${startID === 100 ? index+1 : startID+index}.jpg`, type: 'file', parent_id: 1, size: 4096,
    revision: 7, created_at: stamp, updated_at: stamp },
  metadata: { media_kind: 'image', mime_type: 'image/jpeg', width: 100, height: 100,
    captured_at: stamp, has_thumbnail: false, index_state: 'ready' },
  favorite: false, tags: [], people: [],
}))
const items = makeItems(100)
let people = Array.from({ length: 24 }, (_, index) => ({
  id: `person-${index+1}`, name: index === 0 ? '人物甲' : `人物 ${String(index+1).padStart(2,'0')}`,
  hidden: false, revision: 7+index, item_count: 4, cover_node_id: 100, updated_at: stamp,
}))
let suggestions = [{ id: 'suggestion-a', face_count: 4, item_count: 4, cover_node_id: 100, updated_at: stamp }]
const personItems = new Map(people.map((person, index) => [person.id, index === 0 ? items : makeItems(200 + (index-1)*4)]))
const suggestionItems = new Map([['suggestion-a', makeItems(500)]])
const pets = [{ id: 'cat',name: '猫',item_count: 2,cover_node_id:100 },{ id: 'dog',name:'狗',item_count:2,cover_node_id:101 }]
const probe = (window as any).peopleProbe = { calls: [] as any[], ranges: [] as any[], errors: [] as string[], rejectNext: '' }
const range = (kind: string, id: string, limit: number, offset: number) => {
  probe.ranges.push({ kind,id,limit,offset })
  const members = kind === 'person' ? personItems.get(id) || [] : kind === 'suggestion' ? suggestionItems.get(id) || [] : items
  return { items: structuredClone(members.slice(offset,offset+limit)),offset,limit,total_count:members.length,has_more:offset+limit<members.length }
}
const startMutation = (kind: string, args: unknown[]) => {
  probe.calls.push({ kind,args:structuredClone(args) })
  if (probe.rejectNext === kind) { probe.rejectNext=''; throw new Error('人物保存被拒绝，请重试。') }
}
const source = {
  listItems: async (limit: number, offset: number) => items.slice(offset,offset+limit),
  listItemRange: async (limit: number, offset: number) => range('all','',limit,offset),
  listAlbums: async () => [],
  listAlbumItems: async () => [],
  listAlbumItemRange: async (_id: string,limit: number,offset: number) => range('album','',limit,offset),
  listPeople: async (_hidden: boolean,limit: number,offset: number) => structuredClone(people.slice(offset,offset+limit)),
  listSuggestedPeople: async () => structuredClone(suggestions),
  listSuggestedPersonItems: async (id: string) => structuredClone(suggestionItems.get(id) || []),
  listSuggestedPersonItemRange: async (id: string,limit: number,offset: number) => range('suggestion',id,limit,offset),
  listPersonItems: async (id: string) => structuredClone(personItems.get(id) || []),
  listPersonItemRange: async (id: string,limit: number,offset: number) => range('person',id,limit,offset),
  listPets: async () => pets,
  listPetItemRange: async (id: string,limit: number,offset: number) => range('pet',id,limit,offset),
  loadThumbnail: async () => null,
  updatePerson: async (id: string,revision: number,input: any) => {
    startMutation('update',[id,revision,input])
    const updated = {...people.find(p=>p.id===id)!,...input,revision:revision+1}
    people = people.map(p=>p.id===id?updated:p)
    return structuredClone(updated)
  },
  adoptSuggestedPerson: async (id: string,name: string) => {
    startMutation('adopt',[id,name])
    const created = {id:'person-created',name,revision:1,item_count:4,hidden:false,cover_node_id:100,updated_at:stamp}
    personItems.set(created.id, suggestionItems.get(id) || [])
    people=people.concat(created);suggestions=suggestions.filter(p=>p.id!==id)
    return structuredClone(created)
  },
  addSuggestedPersonToPerson: async (suggestionID: string,id: string,revision: number) => {
    startMutation('assign',[suggestionID,id,revision])
    const members = [...new Map([...(personItems.get(id) || []), ...(suggestionItems.get(suggestionID) || [])].map(item=>[item.node.id,item])).values()]
    personItems.set(id,members)
    const updated={...people.find(p=>p.id===id)!,revision:revision+1,item_count:members.length}
    people=people.map(p=>p.id===id?updated:p);suggestions=suggestions.filter(p=>p.id!==suggestionID)
    return structuredClone(updated)
  },
  reviewSuggestedPerson: async (id:string,state:string) => { startMutation('review',[id,state]);return{id,review_state:state} },
  mergePeople: async (id:string,revision:number,sourceIDs:string[]) => {
    startMutation('merge',[id,revision,sourceIDs])
    const members = [...new Map([id,...sourceIDs].flatMap(personID=>personItems.get(personID) || []).map(item=>[item.node.id,item])).values()]
    personItems.set(id,members)
    sourceIDs.forEach(sourceID=>personItems.delete(sourceID))
    const updated={...people.find(p=>p.id===id)!,revision:revision+1,item_count:members.length}
    people=people.filter(p=>!sourceIDs.includes(p.id)).map(p=>p.id===id?updated:p)
    return structuredClone(updated)
  },
  splitPerson: async (id:string,revision:number,nodeIDs:number[],name:string) => {
    startMutation('split',[id,revision,nodeIDs,name])
    const selectedIDs = new Set(nodeIDs)
    const members = personItems.get(id) || []
    personItems.set(id,members.filter(item=>!selectedIDs.has(item.node.id)))
    personItems.set('split-person',members.filter(item=>selectedIDs.has(item.node.id)))
    const updated={...people.find(p=>p.id===id)!,revision:revision+1,item_count:members.length-nodeIDs.length}
    const created={...updated,id:'split-person',revision:1,name,item_count:nodeIDs.length}
    people=people.map(p=>p.id===id?updated:p).concat(created)
    return {source:structuredClone(updated),created}
  },
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light">
    <main style={{height:'100dvh',overflow:'auto'}} aria-label="人物测试工作区">
      <XDriveMediaGalleryPage source={source} initialSection="people" preferenceScope="m15-people-probe"
        onError={error=>probe.errors.push(error instanceof Error?error.message:String(error))}/>
    </main>
  </XDriveAppearanceThemeProvider>,
)
