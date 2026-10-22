'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
const core = read('ui/shared/src/mui/FileExplorer.tsx')
const publicPage = read('web/src/PublicShare.tsx')
const browser = read('desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs')


test('both authorized Share folders and single-file links mount the identical Owner FileExplorer core', () => {
  assert(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert(bridge.includes('<XDriveFileExplorer'))
  assert(bridge.includes('data-xdrive-public-share-unified-core="true"'))
  assert(bridge.includes('data-xdrive-public-share-kind={kind}'))
  assert(bridge.includes("const fileLink = kind === 'file'"))
  assert(bridge.includes('!fileLink && !folderOpened && !pending'))
  assert(core.includes('XDriveFileExplorerThumbnailProvider'))
  assert(core.includes('XDriveFileQuickLookDialog'))
  assert(bridge.includes('forceVirtualization'))
  assert(core.includes('forceVirtualization || virtualCollectionEnabled'))
  assert(bridge.includes('const thumbnailLoader = useMemo('))
  assert(bridge.includes('const previewURLLoader = useMemo('))
  assert(bridge.includes('items={projectedItems}'))
})


test('Share folder reads stay <=100 and single-file payload <=1, with no false whole-tree search', () => {
  assert(bridge.includes('const sharePageLimit = 100'))
  assert(bridge.includes('items.slice(0, fileLink ? 1 : sharePageLimit)'))
  assert(bridge.includes('getItemMenuItems={contextActions}'))
  assert(bridge.includes('searchEnabled={false}'))
  assert(bridge.includes('groupingEnabled={false}'))
  assert(bridge.includes('筛选当前页'))
  assert(bridge.includes('排序仅影响当前页'))
  assert(publicPage.includes('api.publicShareChildren(token, password, parentID, pageCursor, signal)'))
  assert(publicPage.includes('createPublicShareFileExplorerAdapter('))
  assert(browser.includes('[data-xdrive-file-explorer-scroll-host]'))
  assert(browser.includes('[data-xdrive-file-explorer-item]'))
})

test('Share grants cannot attach Owner mutations or cancel durable user operations on eviction', () => {
  assert(bridge.includes("xDriveResolveFileExplorerCapabilities('share'"))
  assert(bridge.includes('search: false, write: false, delete: false'))
  assert(bridge.includes('const entry = entryFor(item)'))
  assert(bridge.includes('if (!entry || !canStartDownload) return'))
  assert(bridge.includes('if (caps.downloadZip && !folderZIPPreparing)'))
  assert(bridge.includes('targets.length !== 1'))
  for (const forbidden of [
    'XDriveApi', 'api.', 'import { XDriveAgent', 'readOnly=true',
    'onUpload=', 'onDeleteItems=', 'onMoveItemsTo=', 'onRenameItem=',
    'onPaste=', 'onDropItemsToFolder=', 'api.downloadURL(',
  ]) assert.equal(bridge.includes(forbidden), false, 'forbidden bridge privilege: ' + forbidden)
  assert(publicPage.includes('activeThumbnailRequests.current'))
  assert(publicPage.includes('pendingPage.current?.abort()'))
  assert(publicPage.includes('api.cancelPublicShareArchive('),
    'durable ZIP requires its independent explicit Cancel')
})

test('shared new TSX bridge and legacy facade parse without masking TypeScript diagnostics', () => {
  for (const [name, source] of [
    ['PublicShareUnifiedDirectoryExplorer.tsx', bridge],
    ['PublicShareReadOnlyExplorer.tsx', facade],
  ]) {
    const result = ts.transpileModule(source, {
      fileName: name, reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022, isolatedModules: true,
      },
    })
    const errors = (result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors, [], name + ' must parse as TSX')
  }
})
