'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const app=read('web/src/App.tsx'),runtime=read('web/src/webAppRuntime.ts')
const viewer=read('web/src/WebFileViewerApps.tsx')
const helper=read('web/src/webViewerRoute.ts')
test('P1-B Files/Gallery/Viewer are shared lazy presentation, no new backends',()=>{
 for(const str of ["lazy(() => import('./WebFileExplorer'))",
  "import('@xdrive/ui/mui/gallery-page')",
  "import('./WebFileViewerApps')","import('./AdminUsers')","import('./AdminAudit')",
  "import('./StorageStatsPanel')","<XDriveFileExplorerActionFeedback",
  "<XDriveMediaGalleryPage","<WebFileViewerApps"])
  assert(app.includes(str),str)
 assert(!app.includes("import WebFileExplorer from './WebFileExplorer'"))
 assert(!app.includes("import { WebFileViewerApps, xDriveWebOpenRouteForNode } from './WebFileViewerApps'"))
 assert(!app.includes("  XDriveMediaGalleryPage,"))
})
test('P1-B no flicker: React transition retains previous authorized route while lazy code loads',()=>{
 assert(runtime.includes("import { startTransition, useCallback"))
 assert.equal((runtime.match(/startTransition\(\(\) => setRoute\(next\)\)/g)||[]).length,2)
 for(const str of ['data-xdrive-web-route-first-read','<Suspense fallback={',
  'data-xdrive-viewer-route-first-read','aria-busy={true}'])
  assert(app.includes(str),str)
 assert(!app.includes("setTimeout(() => window.location.reload"))
 assert(!app.includes('skipWaiting('))
})
test('P1-B public Service Worker never caches optional routes as private media',()=>{
 const sw=read('assets/icon/web/sw.js')
 const builder=read('web/scripts/build-pwa-shell.mjs')
 assert(sw.includes('OFFLINE_URL'))
 assert(!sw.includes('self.skipWaiting('))
 assert(builder.includes('for (const dependency of entry.imports || []) visit(dependency)'))
 assert(builder.includes('Exclude dynamic imports'))
 for(const path of ['/api/', 'media', 'token']){
   assert(!app.includes("caches.open("+path),'App must not open a private cache')
 }
})
test('P1-B Viewer route classification extracted once; no duplicate implementations',()=>{
 assert(helper.includes("export function xDriveWebOpenRouteForNode"))
 assert(helper.includes('xDriveClassifyFilePreview'))
 assert(viewer.includes("export { xDriveWebOpenRouteForNode } from './webViewerRoute'"))
 assert(!viewer.includes("export function xDriveWebOpenRouteForNode"))
 assert(app.includes("import { xDriveWebOpenRouteForNode } from './webViewerRoute'"))
 for(const name of ['live_photo','media-viewer','pdf-viewer','text-viewer','audio-player'])
  assert(helper.includes(name),name)
})
