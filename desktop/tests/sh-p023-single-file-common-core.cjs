'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
const owner = read('ui/shared/src/mui/FileExplorer.tsx')
const web = read('web/src/PublicShare.tsx')
const cap = read('ui/shared/src/file-explorer-capabilities.ts')

test('SH-P023 one Core for a single-file share and any 100k Share folder page', () => {
  assert.ok(facade.includes('export type XDrivePublicShareReadOnlyExplorerProps'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  for (const forbidden of [
    'visibleItems.map(', 'XDriveFileExplorerItemSurface', 'XDriveFileExplorerGridTileContent',
    'XDriveFileExplorerDetailsRowCell', 'data-xdrive-public-share-scroll-host',
    'useState(', 'useEffect(', 'useRef(',
  ]) assert.equal(facade.includes(forbidden), false, 'no third Explorer: ' + forbidden)
  assert.ok(bridge.includes("const fileLink = kind === 'file'"))
  assert.ok(bridge.includes('!fileLink && !folderOpened && !pending'),
    'single-file must mount Core immediately without a folder-page request')
  assert.ok(bridge.includes('items.slice(0, fileLink ? 1 : sharePageLimit)'))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(bridge.includes('data-xdrive-public-share-kind={kind}'))
  assert.ok(bridge.includes('forceVirtualization'))
  assert.ok(bridge.includes('getItemMenuItems={contextActions}'))
  assert.ok(bridge.includes('loadThumbnail={thumbnailLoader}'))
  assert.ok(bridge.includes('loadPreviewURL={previewURLLoader}'))
  assert.ok(owner.includes('XDriveFileQuickLookDialog'))
  assert.ok(bridge.includes('useLayoutEffect(() => {'), 'accepted-page identity stays stable before paint')
})

test('SH-P023 default Share read-only remains downloadable, per-action grants remain server-issued', () => {
  assert.ok(web.includes('const grants = share?.capabilities ?? xDriveShareReadOnlyDefaultCapabilities'))
  assert.ok(web.includes('const canDownload = canBrowse && grants.download'))
  assert.ok(web.includes('const canDownloadZip = canDownload && grants.downloadZip'))
  assert.ok(web.includes('kind="file"') && web.includes('kind="dir"'))
  assert.ok(web.includes('items={sharedFileItems}'))
  assert.ok(web.includes('onDownloadItem={() => void download()}'))
  assert.ok(web.includes('disabled={!canStartDownload}'))
  assert.ok(web.includes('api.downloadPublicShare(token, password, entry?.name ?? share.name, entry?.id)'))
  assert.ok(bridge.includes("xDriveResolveFileExplorerCapabilities('share'"))
  assert.ok(bridge.includes('const canStartDownload = caps.download && !downloadPending'))
  assert.ok(bridge.includes('onDownloadItems={caps.download'))
  assert.ok(bridge.includes('folderDownloadSupported={!fileLink && caps.downloadZip}'))
  assert.ok(bridge.includes('!fileLink && <TextField'), 'single-file has no fake search')
  assert.ok(bridge.includes('!fileLink && <Button'), 'single-file has no directory cursor UI')
  assert.ok(bridge.includes('data-xdrive-public-share-file-browser={fileLink || undefined}'))
  assert.ok(bridge.includes('!fileLink && !folderOpened && !pending ? ('))
  assert.ok(bridge.includes('          {toolbarActions}\n        </Stack>'),
    'passworded/unopened Share folder must retain standalone durable ZIP control')
  assert.ok(bridge.includes("search: false, write: false, delete: false"))
  assert.ok(cap.includes("'list' | 'preview' | 'download' | 'downloadZip' | 'search' | 'write' | 'delete'"))
  for (const forbidden of [
    'XDriveApi', 'OwnerJWT', 'onMoveItemsTo=', 'onDeleteItems=', 'onUpload=', 'onPaste=',
    'onRenameItem=', 'onDropItemsToFolder=', 'api.downloadURL(',
  ]) assert.equal(bridge.includes(forbidden) || facade.includes(forbidden), false,
    'no Owner authority may leak to Share renderer: ' + forbidden)
})

test('SH-P023 ephemeral visibility/page abort never becomes an explicit durable ZIP cancel', () => {
  assert.ok(web.includes('pendingPage.current?.abort()'))
  assert.ok(web.includes('activeThumbnailRequests.current'))
  assert.ok(web.includes('signal?.addEventListener(\'abort\', cancelFromViewport, { once: true })'))
  assert.ok(web.includes('zipPollRef.current?.abort()'))
  const visibility = web.slice(web.indexOf('const onVisibilityChange = () => {'),
    web.indexOf('const onPageHide = () =>'))
  assert.ok(visibility.includes('pendingPage.current?.abort()'))
  assert.ok(visibility.includes('abortEphemeralThumbnails()'))
  assert.equal(visibility.includes('cancelPublicShareArchive'), false)
  assert.ok(web.includes('const cancelSharedFolderZIP = async () => {'))
  assert.ok(web.includes('await api.cancelPublicShareArchive(token, password, zipTaskID)'))
  assert.ok(web.includes('await api.publicShareChildren(token, password, parentID, pageCursor, signal)'))
})

test('SH-P023 source-exact TypeScript parser accepts the one Core delegation', () => {
  for (const [file, source] of [
    ['PublicShareReadOnlyExplorer.tsx', facade],
    ['PublicShareUnifiedDirectoryExplorer.tsx', bridge],
  ]) {
    const result = ts.transpileModule(source, {
      fileName: file, reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022, isolatedModules: true,
      },
    })
    const errors = (result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors, [], 'Share presentation TSX must parse: ' + file)
  }
})
