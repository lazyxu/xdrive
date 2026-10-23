'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const app=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
const wrapper=fs.readFileSync(path.join(root,'web/src/PwaMediaGalleryRoute.tsx'),'utf8')
const source=fs.readFileSync(path.join(root,'desktop/scripts/pwa-p102-paired-bundle-graph.cjs'),'utf8')
const flow=fs.readFileSync(path.join(root,'.github/workflows/pwa-p102-paired-bundle-trial.yml'),'utf8')
test('single Owner API, App Frame and virtualizer; heavy pages only dynamically imported',()=>{
 for(const k of ["lazy(() => import('./WebFileExplorer'))",
  "lazy(() => import('./PwaMediaGalleryRoute'))",
  "lazy(() => import('./AdminUsers'))","lazy(() => import('./AdminAudit'))",
  "lazy(() => import('./StorageStatsPanel'))",
  "xDriveWebAppRouteForWorkspaceKey", "XDriveMobileAppHeader",
  "xDriveFileExplorerResolveFolderUploadTargets",
  "data-xdrive-pwa-route-chunk-pending", "<Suspense fallback="])
  assert(app.includes(k),k)
 for(const bad of ["import WebFileExplorer from './WebFileExplorer'",
   "import AdminUsersPanel from './AdminUsers'","  XDriveMediaGalleryPage,"])
   assert(!app.includes(bad),bad)
 assert(wrapper.includes("XDriveMediaGalleryPage as default"))
 assert(!app.includes('caches.open('))
})
test('real normal Vite build graph A/B has no fixed production success assertions',()=>{
 for(const k of ['.vite/manifest.json',"m[k].imports","gzipSync",
  "benefitUnproven:ratio<=0.05","actualChromeAfter:false",
  "genuine100kAfter:false"])assert(source.includes(k),k)
})
test('exact HEAD, two independently built actual source trees, no auto GC',()=>{
 for(const k of ["github.event.pull_request.head.sha","git worktree add",
  "node desktop/scripts/pwa-p102-paired-bundle-graph.cjs",
  "npm --prefix web run build",
  "node --test desktop/tests/pwa-p102-paired-bundle-contract.cjs",
  "actions/upload-artifact@v4"])
  assert(flow.includes(k),k)
 assert(!flow.includes('continue-on-error:'))
 assert(!flow.includes('workflow_dispatch:'))
})
