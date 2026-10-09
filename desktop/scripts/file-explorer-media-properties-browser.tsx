import { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__FILE_EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import goldens from './media-properties-fixtures.cjs'

// The platform responses are controllable; Workspace, file selection/context
// actions, scoped Properties controllers and the canonical MUI Inspector are real.
const stamp = '2026-10-09T10:20:30Z'
const rootCrumb = { id: 1, name: '我的文件' }
const goldenName = new URLSearchParams(location.search).get('golden') || ''
const golden = goldens.items[goldenName] || null
const longPath = '/我的文件/权威目录/' + '保留文件上下文目录/'.repeat(10)
const node = (id: number, name: string, type: 'file' | 'dir' = 'file') => ({
  id, name, type, parent_id: 1, revision: 7, size: type === 'file' ? 1234 : 0,
  created_at: stamp, updated_at: stamp, sha256: `${id}-authoritative-sha256`,
})
const initialNodes = golden ? [structuredClone(golden.node)] : [node(101, 'photo-A.jpg'), node(202, 'photo-B.jpg'), node(303, 'clip.mp4'),
  node(404, 'capture.livp'), node(505, 'ordinary.txt'), node(606, 'folder', 'dir')]
const harness = ((window as any).filesPropertiesHarness = {
  requests: [] as any[], pending: new Map<number, any>(), selected: [] as any[], errors: [] as string[],
  events: [] as any[], mediaMode: 'correct', statsMode: 'correct', sequence: 0,
  longPath, nodes: initialNodes,
})
function mediaValue(request: any, mode = 'correct') {
  if (golden) return structuredClone(golden)
  const selected = request.items[0]
  const source = initialNodes.find(item => item.id === Number(selected.id))!
  const currentNode = { ...source, revision: Number(selected.revision) }
  if (mode === 'wrong-id') { currentNode.id = 9999; currentNode.name = 'WRONG-NODE-NEVER-SHOW.jpg' }
  if (mode === 'wrong-revision') { currentNode.revision += 1; currentNode.name = 'WRONG-REVISION-NEVER-SHOW.jpg' }
  const live = source.name.endsWith('.livp')
  return {
    node: currentNode,
    metadata: {
      node_id: currentNode.id, node_revision: currentNode.revision,
      media_kind: source.name.endsWith('.mp4') ? 'video' : 'image',
      captured_at: '', width: 4032, height: 3024, orientation: 6,
      camera_make: 'Fixture Camera', camera_model: 'A2', lens_model: '35mm',
      latitude: 0, longitude: 0, altitude_m: 0, mime_type: live ? 'application/zip' : 'image/jpeg',
      duration_ms: 45250, rotation_degrees: 90, frame_rate: 29.97, bit_rate: 12000000,
      video_codec: 'h264', audio_codec: 'aac', has_thumbnail: true,
      thumbnail_width: 320, thumbnail_height: 240, thumbnail_mime_type: 'image/jpeg',
      index_error: mode === 'partial' ? 'fixture-partial-metadata' : '',
    },
    asset_kind: live ? 'live_photo' : source.name.endsWith('.mp4') ? 'video' : 'image',
    favorite: true, tags: ['CanonicalTag'], people: ['CanonicalPerson'], description: 'Canonical description',
    resources: live ? [
      { kind: 'file', node_id: 405, role: 'still', name: 'still.heic', size: 2000, mime_type: 'image/heic' },
      { kind: 'file', node_id: 406, role: 'motion', name: 'motion.mov', size: 3000, mime_type: 'video/quicktime' },
    ] : [],
  }
}
function statsValue(request: any) {
  return {
    selected_count: request.items.length, effective_root_count: request.items.length,
    total_bytes: request.items.some((item: any) => item.kind === 'dir') ? 54321 : 1234,
    file_count: request.items.some((item: any) => item.kind === 'dir') ? 12 : 1,
    folder_count: request.items.some((item: any) => item.kind === 'dir') ? 3 : 0,
    sources: [{ id: 9, name: `${request.owner} 相机备份`, kind: 'filesystem' }],
  }
}
function settle(request: any, mode: string, resolve: (value: any) => void, reject: (error: Error) => void) {
  request.settled = true
  if (mode === '404') reject(new Error('404: file is not indexed media'))
  else if (mode === 'index-error') reject(new Error('媒体索引暂时失败'))
  else if (mode === 'reject-old') reject(new Error('OLD-REQUEST-ERROR-NEVER-SHOW'))
  else resolve(request.kind === 'media' ? mediaValue(request, mode) : statsValue(request))
}
function request(kind: 'media' | 'stats', items: readonly any[], signal: AbortSignal, owner: string) {
  const mode = kind === 'media' ? harness.mediaMode : harness.statsMode
  const entry = { sequence: ++harness.sequence, kind, owner, items: items.map(item => ({ id: item.id, revision: item.revision, kind: item.kind, name: item.name })), aborted: signal.aborted, settled: false, mode }
  harness.requests.push(entry)
  signal.addEventListener('abort', () => { entry.aborted = true }, { once: true })
  return new Promise<any>((resolve, reject) => {
    if (mode === 'hold') harness.pending.set(entry.sequence, { entry, resolve, reject })
    else settle(entry, mode, resolve, reject)
  })
}
harness.release = (sequence: number, mode = 'correct') => {
  const pending = harness.pending.get(sequence)
  if (!pending) throw new Error(`No held request ${sequence}`)
  harness.pending.delete(sequence)
  settle(pending.entry, mode, pending.resolve, pending.reject)
}
harness.setModes = (media: string, stats = 'correct') => { harness.mediaMode = media; harness.statsMode = stats }
const onError = (error: unknown) => harness.errors.push(String((error as Error)?.message || error))
const onSelectionChange = (ids: any[]) => { harness.selected = [...ids] }
const loadRoot = async () => rootCrumb
const loadSearchRange = async (_query: string, _filters: any, _group: any, _sort: any, offset: number, limit: number) => ({ items: [], offset, limit, totalCount: 0, groups: [] })
const findChildDirectory = async () => null

function FilesFixture() {
  const [owner, setOwner] = useState('session-a')
  const [nodes, setNodes] = useState(initialNodes)
  const [crumbs, setCrumbs] = useState(golden
    ? [rootCrumb, { id: goldens.parentNode.id, name: goldens.parentNode.name }]
    : [rootCrumb])
  const [supported, setSupported] = useState(new URLSearchParams(location.search).get('supported') !== 'false')
  const onLoadDirectory = useCallback(async (_id: number, nextCrumbs: any[]) => { setCrumbs(nextCrumbs); return true }, [])
  const workspace = useXDriveFileExplorerWorkspace({
    items: nodes, crumbs, viewModeStorageKey: 'm09.fixture.view', navigationSessionStorageKey: owner,
    onLoadDirectory, loadRoot, loadSearchRange, findChildDirectory, onError,
  })
  const items = useMemo(() => workspace.explorerItems.map(item => ({
    ...item, path: longPath + item.name,
    properties: [{ label: '业务上下文', value: <strong data-fixture-file-context>Project-Artemis-{item.id}</strong>, section: 'technical' as const }],
  })), [workspace.explorerItems])
  const loadMediaItem = useCallback((item: any, signal: AbortSignal) => request('media', [item], signal, owner), [owner])
  const loadPropertiesStats = useCallback((selected: readonly any[], signal: AbortSignal) => request('stats', selected, signal, owner), [owner])
  harness.setOwner = setOwner
  harness.setSupported = setSupported
  harness.replaceRevision = (id: number, revision: number) => setNodes(current => current.map(item => item.id === id ? { ...item, revision } : item))
  harness.navigate = () => workspace.navigateTo([rootCrumb, { id: 22, name: '替换目录' }])
  harness.state = { owner, supported, currentID: workspace.current?.id, ids: items.map(item => item.id) }
  return <div style={{ height: '100dvh', minHeight: 0, display: 'flex' }}>
    <XDriveFileExplorer
      items={items} crumbs={workspace.explorerCrumbs} interactionLifecycleKey={owner}
      viewMode="details" onViewModeChange={() => {}} sort={{ key: 'name', direction: 'asc' }}
      grouping={{ groupBy: 'none', foldersFirst: false }} onSelectionChange={onSelectionChange}
      onOpenItem={item => { void workspace.openItem(item, node => harness.events.push({ type: 'open', id: node.id })) }}
      onPathSubmit={workspace.submitPath} onBack={() => { void workspace.goBack() }}
      canGoBack={workspace.canGoBack} searchEnabled={false}
      loadMediaItem={supported ? loadMediaItem : undefined} loadPropertiesStats={loadPropertiesStats}
      getItemAvailability={() => ({ kind: 'always-local', label: '始终保留在此设备上', title: 'authoritative availability' })}
      loadThumbnail={async item => { harness.events.push({ type: 'thumbnail', id: item.id }); return null }}
      loadPreviewURL={async item => { harness.events.push({ type: 'preview', id: item.id }); return null }}
      loadLivePhotoMotion={async item => { harness.events.push({ type: 'motion', id: item.id }); return null }}
    />
  </div>
}
function FixtureRoot() {
  const [visible, setVisible] = useState(true)
  harness.unmount = () => setVisible(false)
  harness.mount = () => setVisible(true)
  return visible ? <FilesFixture /> : <div data-fixture-unmounted>Files unmounted</div>
}
createRoot(document.getElementById('root')!).render(<XDriveAppearanceThemeProvider appearance="light"><FixtureRoot /></XDriveAppearanceThemeProvider>)
