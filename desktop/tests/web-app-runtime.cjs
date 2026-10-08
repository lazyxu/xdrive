const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')

const contract = read('ui', 'shared', 'src', 'web-app.ts')
const registry = read('web', 'src', 'webApps.ts')
const runtime = read('web', 'src', 'webAppRuntime.ts')
const app = read('web', 'src', 'App.tsx')
const explorer = read('web', 'src', 'WebFileExplorer.tsx')
const viewers = read('web', 'src', 'WebFileViewerApps.tsx')
const viewerContext = read('web', 'src', 'webViewerContext.ts')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const preview = read('ui', 'shared', 'src', 'file-preview.ts')
const previewSurface = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const sourceManager = read('ui', 'shared', 'src', 'mui', 'SourceManager.tsx')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const docs = read('docs', 'web-app-runtime.md')

test('Web App Registry contains the fifteen agreed applications', () => {
  for (const id of [
    'overview',
    'files',
    'gallery',
    'sync-folders',
    'tasks',
    'local-storage',
    'cloud-storage',
    'preview',
    'media-viewer',
    'text-viewer',
    'pdf-viewer',
    'audio-player',
    'admin-users',
    'admin-audit',
    'admin-storage',
  ]) {
    assert.ok(contract.includes(`'${id}'`), 'shared launch contract missing: ' + id)
    assert.ok(registry.includes(`${id.includes('-') ? `'${id}'` : id}:`), 'Web registry missing: ' + id)
  }
  assert.ok(contract.includes("export type XDriveWebAppPresentation = 'workspace' | 'viewer' | 'immersive'"))
  assert.ok(registry.includes("preview: { id: 'preview', title: '预览', presentation: 'immersive'"))
  assert.ok(registry.includes("'media-viewer': { id: 'media-viewer', title: '媒体查看器', presentation: 'immersive'"))
})

test('Hash routes are typed and browsing context stays out of the URL', () => {
  for (const token of [
    'xDriveWebAppHash',
    'xDriveParseWebAppHash',
    "#/app/",
    "preview: { node: number; context?: string }",
    "'media-viewer': { node: number; context?: string }",
    "'text-viewer': { node: number; line?: number; column?: number }",
    "'pdf-viewer': { node: number; page?: number }",
    "files: { dir?: number }",
  ]) {
    assert.ok(contract.includes(token), 'route contract missing: ' + token)
  }
  assert.ok(runtime.includes("const WEB_APP_SESSION_PREFIX = 'xdrive.web_app.session.v1:'"))
  assert.ok(runtime.includes('window.sessionStorage.setItem('))
  assert.ok(runtime.includes('xDriveWriteWebAppBrowseSession(id, context)'))
  assert.equal(contract.includes('nodeIDs='), false, 'large selection lists must never be encoded into route URLs')
})

test('Web FileExplorer launches Web programs while Desktop ordinary Open uses the OS', () => {
  assert.ok(explorer.includes('onOpenFile('))
  assert.ok(explorer.includes('browseContextForItem(item)'))
  assert.ok(explorer.includes("{ kind: 'selection', nodeIDs: [node.id], activeIndex: 0 }"))
  assert.ok(explorer.includes('onOpenQuickLook('))
  assert.ok(explorer.includes("label: '在新浏览器标签页打开'"))
  assert.equal(explorer.includes('XDriveOpenPreviewDialog'), false, 'Web ordinary Open must not keep a local preview dialog')
  assert.ok(app.includes('xDriveWebOpenRouteForNode'))
  assert.ok(app.includes("app: 'preview'"))
  assert.ok(app.includes('{ viewerReturn: true }'))
  assert.ok(app.includes('event.ctrlKey || event.metaKey'))

  assert.ok(desktop.includes("onOpen: node.type === 'file'"))
  assert.ok(desktop.includes('void openLocalNode(node)'))
  assert.equal(desktop.includes('openWorkspaceItem(item, openPreviewNode)'), false)
  assert.equal(desktop.includes("onSystemOpen: node.type === 'file'"), false)
  assert.ok(desktop.includes("label: '打开方式…'"))
})

test('Preview and media viewers preserve collection navigation without materializing huge lists', () => {
  assert.ok(viewerContext.includes('xDriveFindWebViewerNeighbor'))
  assert.ok(viewerContext.includes('const pageSize = 128'))
  assert.ok(viewerContext.includes('api.listRange('))
  assert.ok(viewerContext.includes('api.searchRange('))
  assert.ok(viewerContext.includes('loadGalleryRange('))
  assert.ok(viewers.includes('Space / Esc 返回 · ← / → 切换'))
  assert.ok(viewers.includes('slideshow'))
  assert.ok(viewers.includes('interactiveImage'))
  assert.ok(gallery.includes('XDriveMediaGalleryOpenViewerContext'))
  assert.ok(gallery.includes('onOpenViewer(item, {'))
})

test('Text/Code Viewer is read-only textarea with common source/config allowlist and 1 MiB bound', () => {
  for (const token of [
    "'js'", "'mjs'", "'cjs'", "'h'", "'hpp'", "'cpp'", "'go'", "'rs'", "'java'",
    "'py'", "'html'", "'svg'", "'vue'", "'svelte'", "'swift'", "'dart'", "'php'",
    "'.env'", "'.npmrc'", "'.eslintrc'", "'.prettierrc'",
  ]) {
    assert.ok(preview.includes(token), 'text/source allowlist missing: ' + token)
  }
  assert.ok(preview.includes("base.startsWith('.env.')"))
  assert.ok(viewers.includes('component="textarea"'))
  assert.ok(viewers.includes('readOnly'))
  assert.ok(viewers.includes('文件较大，仅显示前 1 MiB'))
  assert.ok(previewSurface.includes('仅显示前 1 MiB'))
})

test('optional deep-link arguments are consumed by their owning apps', () => {
  assert.ok(app.includes("initialDirectoryID={route.app === 'files' ? route.params.dir : undefined}"))
  assert.ok(app.includes("initialSection={route.app === 'gallery'"))
  assert.ok(app.includes("initialSourceID={route.app === 'sync-folders' ? route.params.source : undefined}"))
  assert.ok(app.includes("focusUserID={route.app === 'admin-users' ? route.params.user : undefined}"))
  assert.ok(app.includes("focusSection={route.app === 'admin-storage' ? route.params.section : undefined}"))
  assert.ok(app.includes("route.app === 'admin-storage' && route.params.task"))
  assert.ok(sourceManager.includes('onSelectedSourceChange?.(row.source.id)'))
  assert.ok(gallery.includes('routeSectionInitializedRef'))
})

test('Web App Runtime design document records the navigation and platform boundary', () => {
  for (const token of [
    '15 个 Web 程序',
    '浏览器历史只负责程序级跳转',
    'FileExplorer 自己维护目录与内部标签历史',
    'Desktop',
    '系统默认程序',
    'sessionStorage',
    '1 MiB',
  ]) {
    assert.ok(docs.includes(token), 'Web App Runtime documentation missing: ' + token)
  }
})
