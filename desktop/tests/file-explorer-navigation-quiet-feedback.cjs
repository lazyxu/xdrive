const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const hook = read('ui', 'shared', 'src', 'mui', 'useDeferredLoading.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('tree disclosure keeps a stable real button throughout a pending directory GET', () => {
  const start = pane.indexOf('const renderNode = (node:')
  const end = pane.indexOf('const displayedQuickAccessItems', start)
  assert.ok(start >= 0 && end > start)
  const tree = pane.slice(start, end)
  assert.ok(tree.includes('role="treeitem"'))
  assert.ok(tree.includes('aria-busy={loading || undefined}'))
  assert.ok(tree.includes('aria-expanded={expandable ? expanded : undefined}'))
  assert.ok(tree.includes('aria-label={expanded ? `折叠 ${node.name}` : `展开 ${node.name}`}'))
  assert.ok(tree.includes('toggleExpanded(node)'), 'collapse must remain available while awaiting the network')
  assert.ok(tree.includes('void onNavigate(node.crumbs)'), 'directory navigation remains independent from expansion')
  assert.equal(tree.includes('loading && !loaded ? ('), false, 'pending must not replace the interactive chevron with a ring')
  assert.ok(tree.includes('data-xdrive-file-explorer-tree-load-feedback'))
  assert.ok(tree.includes("position: 'absolute'"))
  assert.ok(tree.includes("pointerEvents: 'none'"))
  assert.ok(tree.includes('<XDriveNavigationQuietSpinner pending={loading && !loaded && expanded} size={12} />'))
  assert.ok(tree.includes('children.map((child) => renderNode(child, depth + 1))'))
  assert.ok(tree.includes('onLoad={() => loadChildren(node, true)}'), 'network pagination remains active')
})

test('quick-access, favorites and recent cold spinners share one delayed nonblocking feedback contract', () => {
  assert.ok(pane.includes("import { useXDriveDeferredPendingLoading } from './useDeferredLoading'"))
  assert.ok(pane.includes('const visible = useXDriveDeferredPendingLoading(pending)'))
  assert.ok(pane.includes('return visible ? <CircularProgress size={size} /> : null'))
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'))
  assert.ok(hook.includes('return pending && visible'), 'resolved requests must hide a pending-only ring')
  for (const term of [
    'pending={quickAccessLoading && quickAccessItems.length === 0}',
    'pending={favoritesLoading && favoriteItems.length === 0}',
    'pending={recentLoading && recentItems.length === 0}',
  ]) assert.ok(pane.includes(term), term)
  assert.ok(pane.includes('minHeight: compactViewport ? 44 : 32'), 'cold sidebar slot must remain stable')
})

test('Web and Desktop retain the same shared navigation state and requests', () => {
  for (const [name, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('XDriveFileExplorerNavigationPane'), name + ' must use the shared pane')
    assert.ok(source.includes('loadDirectoryPage={loadTreeDirectoryPage}'), name + ' must retain paged folder reads')
  }
  assert.ok(pane.includes('loadingIDsRef.current.get(node.id) === generation'))
  assert.ok(pane.includes('requestLifecycleKey !== lifecycleKeyRef.current'))
  assert.ok(pane.includes('setExpandedIDs(new Set())'), 'session isolation must still reset the navigation tree')
})
