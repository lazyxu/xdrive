const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const requireDependency = createRequire(path.join(repo, 'desktop/package.json'))
const ts = requireDependency('typescript')
const React = requireDependency('react')
const TestRenderer = requireDependency('react-test-renderer')
const { renderToStaticMarkup } = requireDependency('react-dom/server')
const { buildSync } = requireDependency('esbuild')
const observations = []
const modules = new Map()

function loadSource(relativePath) {
  const filename = path.resolve(repo, relativePath)
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText
  const localRequire = (request) => {
    if (!request.startsWith('.')) return requireDependency(request)
    const resolved = path.resolve(path.dirname(filename), request)
    const source = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!source) throw new Error(`Missing source import ${request} from ${filename}`)
    return loadSource(source)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function loadPane() {
  const output = buildSync({
    entryPoints: [path.join(repo, 'ui/shared/src/mui/FileExplorerNavigationPane.tsx')],
    bundle: true, packages: 'external', platform: 'node', format: 'cjs',
    jsx: 'automatic', write: false, logLevel: 'silent',
  }).outputFiles[0].text
  const mod = { exports: {} }
  const requireUI = (request) => request.startsWith('@mui/icons-material/')
    ? requireDependency(request).default : requireDependency(request)
  new Function('module', 'exports', 'require', output)(mod, mod.exports, requireUI)
  return mod.exports.XDriveFileExplorerNavigationPane
}

const { useXDriveFileExplorerWorkspace } = loadSource('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
const { useXDriveFileExplorerOrganization } = loadSource('ui/shared/src/mui/FileExplorerOrganizationController.ts')
const organizationModel = loadSource('ui/shared/src/file-explorer-organization.ts')
const searchModel = loadSource('ui/shared/src/file-explorer-search.ts')
const Pane = loadPane()

function adapterBindings(platform) {
  const filename = path.join(repo, platform === 'Web' ? 'web/src/WebFileExplorer.tsx' : 'desktop/src/renderer/DesktopFileExplorer.tsx')
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  const jsx = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node)
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast)
      if (!jsx.has(name)) jsx.set(name, node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const tagState = declarations.get('[tagDialogItems, setTagDialogItems]')?.parent.parent
  const lifecycle = declarations.get('organizationLifecycleKeyRef')?.parent.parent
  const last = declarations.get('canSaveSmartFolder')?.parent.parent
  assert.ok(tagState && lifecycle && last, `${platform} actual organization state declarations`)
  const statements = [...tagState.parent.statements]
  const start = Math.min(statements.indexOf(tagState), statements.indexOf(lifecycle))
  const body = statements.slice(start, statements.indexOf(last) + 1).map(node => node.getText(ast)).join('\n')
  function value(tag, name, optional = false) {
    const attribute = jsx.get(tag)?.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name)
    if (!attribute) {
      assert.ok(optional, `${platform} ${tag}.${name} exists`)
      return 'undefined'
    }
    if (!attribute.initializer) return 'true'
    return ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression.getText(ast) : attribute.initializer.getText(ast)
  }
  const navFields = [
    'savedSearchesEnabled', 'savedSearches', 'activeSavedSearchID', 'onActivateSavedSearch',
    'onRenameSavedSearch', 'onReplaceSavedSearch', 'canReplaceSavedSearch',
    'onDeleteSavedSearch', 'onReorderSavedSearches', 'tagsEnabled', 'tags', 'activeTagID', 'onActivateTag', 'onNavigate', 'onNavigateTrash',
  ]
  const optionalNavFields = ['organizationLoading', 'organizationError', 'onRetryOrganization', 'onManageTags', 'onSaveCurrentSearch', 'canSaveCurrentSearch', 'savedSearchRuleLabels', 'currentSearchNotice', 'matchingSavedSearchIDs']
  const navObject = [...navFields.map(name => `${name}: ${value('XDriveFileExplorerNavigationPane', name)}`),
    ...optionalNavFields.map(name => `${name}: ${value('XDriveFileExplorerNavigationPane', name, true)}`)].join(',\n')
  const fields = ['onSearch', 'onSearchValueChange', 'onBack', 'onForward']
  const fileObject = fields.map(name => `${name}: ${value('XDriveFileExplorer', name)}`).join(',\n')
  const names = [
    'useState', 'useRef', 'useMemo', 'useCallback', 'useEffect', 'organization', 'navigationSessionStorageKey',
    'searchState', 'searchFilters', 'applySearch', 'changeSearchFilters', 'changeSearchValue', 'submitSearch',
    'goBack', 'goForward', 'navigateTo', 'beginNavigationIntent', 'trashActive', 'onOpenTrash', 'onCloseTrash', 'onFeedback', 'fileTagsSupported', 'savedSearchesSupported', 'searchSourceOptions',
    ...Object.keys(organizationModel), ...Object.keys(searchModel),
  ]
  const program = `const { ${[...new Set(names)].join(',')} } = dependencies;\n${body}\nreturn {
    nav: { ${navObject} }, files: { ${fileObject} },
    changeFilters: ${value('XDriveFileExplorerSearchFilters', 'onChange')},
    tagDialogOpen: ${value('XDriveFileTagDialog', 'open')},
    tagDialogNodeIDs: ${value('XDriveFileTagDialog', 'nodeIDs')},
    tagDialogMode: ${value('XDriveFileTagDialog', 'mode', true)},
    tagDialogClose: ${value('XDriveFileTagDialog', 'onClose')},
    projectTagDialogNodeIDs: (tagDialogItems) => ${value('XDriveFileTagDialog', 'nodeIDs')},
  };`
  const output = ts.transpileModule(program, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  return new Function('dependencies', output)
}

const rootCrumb = { id: 1, name: '我的文件' }
const folderCrumb = { id: 2, name: '项目' }
const folder = { id: 2, parent_id: 1, name: '项目', type: 'dir', revision: 1, size: 0 }
const tagA = { id: 7, name: '旅行', color: '#118877', item_count: 3, created_at: '', updated_at: '' }
const tagB = { ...tagA, id: 8, name: '工作' }
const savedA = { id: 17, name: '旅行照片', query: 'photo', filters: { kind: 'image', tagID: 7 }, position: 0, created_at: '', updated_at: '' }
const savedB = { ...savedA, id: 18, name: '工作文本', query: 'invoice', filters: { kind: 'text', tagID: 8 }, position: 1 }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function mount(platform, overrides = {}) {
  const useAdapterBindings = adapterBindings(platform)
  const errors = [], requests = [], feedback = []
  let current, renderer, updateDirectory
  const adapter = {
    listTags: async () => [tagA, tagB],
    listSavedSearches: async () => [savedA, savedB],
    createTag: async (name, color) => ({ ...tagA, id: 9, name, color }),
    updateTag: async (id, input) => ({ ...tagA, id, ...input }),
    deleteTag: async () => {}, queryNodeTags: async ids => { requests.push({ kind: 'assignments', ids }); return [] },
    addTagNodes: async () => {}, removeTagNodes: async () => {},
    createSavedSearch: async input => ({ ...savedA, ...input, id: 20 }),
    updateSavedSearch: async (id, input) => ({ ...savedA, ...input, id }),
    deleteSavedSearch: async () => {}, reorderSavedSearches: async () => {},
    ...overrides,
  }
  const props = {
    viewModeStorageKey: 'm08-probe-view', navigationSessionStorageKey: 'account-a',
    loadRoot: async () => rootCrumb,
    findChildDirectory: async (_parentID, name) => name === folder.name ? folder : null,
    onLoadDirectory: async (id, crumbs) => { requests.push({ kind: 'directory', id }); updateDirectory({ crumbs, items: id === 1 ? [folder] : [] }); return true },
    loadSearchRange: async (query, filters, grouping, sort, offset, limit) => {
      requests.push({ kind: 'search', query, filters, offset, limit })
      return { items: offset === 0 ? [{ node: folder, path: '/项目', crumbs: [rootCrumb, folderCrumb] }] : [], offset, limit, totalCount: 1, groups: [] }
    },
    searchCrumbsForResult: result => result.crumbs,
    onError: error => errors.push(error instanceof Error ? error.message : String(error)),
  }
  function Harness() {
    const [directory, setDirectory] = React.useState({ crumbs: [rootCrumb], items: [folder] })
    const [trashActive, setTrashActive] = React.useState(false)
    updateDirectory = setDirectory
    const workspace = useXDriveFileExplorerWorkspace({ ...props, ...directory })
    const organization = useXDriveFileExplorerOrganization({ lifecycleKey: 'account-a', adapter, onError: props.onError })
    const binding = useAdapterBindings({
      ...React, ...organizationModel, ...searchModel, ...workspace, organization,
      navigationSessionStorageKey: 'account-a', fileTagsSupported: true, savedSearchesSupported: true, searchSourceOptions: [],
      trashActive, onOpenTrash: () => setTrashActive(true), onCloseTrash: () => setTrashActive(false),
      onFeedback: (tone, message) => feedback.push({ tone, message }),
    })
    current = { workspace, organization, binding, directory, trashActive, closeTrash: () => setTrashActive(false) }
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  return {
    get current() { return current }, errors, requests, feedback,
    async run(action) {
      await TestRenderer.act(async () => {
        await action(current)
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
    },
    record(label) {
      const { workspace, organization, binding } = current
      const state = {
        platform, label, query: workspace.searchState.query, filters: workspace.searchFilters,
        searchActive: workspace.searchState.results !== null, currentID: workspace.current?.id,
        activeSavedSearchID: binding.nav.activeSavedSearchID, activeTagID: binding.nav.activeTagID,
        organizationLoading: organization.loading, organizationError: organization.error,
        savedCount: organization.savedSearches.length, tagCount: organization.tags.length,
        tagDialogOpen: binding.tagDialogOpen,
      }
      observations.push(state)
      return state
    },
    section(label) {
      const markup = renderToStaticMarkup(React.createElement(Pane, {
        lifecycleKey: 'account-a', currentCrumbs: current.directory.crumbs,
        loadDirectoryPage: async () => ({ items: [], nextCursor: '', hasMore: false }),
        ...current.binding.nav,
      }))
      const section = markup.match(new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`))?.[1]
      assert.ok(section, `${label} section exists in actual MUI output`)
      return section.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')
    },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

for (const platform of ['Web', 'Desktop']) {
  test(`${platform}: Trash hides retained Search organization markers and saving until Files is active again`, async () => {
    const h = await mount(platform)
    try {
      await h.run(current => current.binding.nav.onActivateSavedSearch(savedA))
      assert.equal(h.current.binding.nav.activeSavedSearchID, savedA.id)
      const searchReads = h.requests.filter(request => request.kind === 'search').length
      await h.run(current => current.binding.nav.onNavigateTrash())
      assert.equal(h.current.trashActive, true)
      assert.equal(h.current.workspace.searchState.query, savedA.query, 'the existing Search remains retained behind Trash')
      assert.notEqual(h.current.workspace.searchState.results, null)
      assert.equal(h.current.binding.nav.activeSavedSearchID, null, 'Trash is the displayed context')
      assert.deepEqual(h.current.binding.nav.matchingSavedSearchIDs, [])
      assert.equal(h.current.binding.nav.activeTagID, null)
      assert.equal(h.current.binding.nav.canSaveCurrentSearch, false)
      await h.run(current => current.closeTrash())
      assert.equal(h.current.binding.nav.activeSavedSearchID, savedA.id)
      assert.equal(h.current.binding.nav.activeTagID, tagA.id)
      assert.equal(h.current.binding.nav.canSaveCurrentSearch, true)
      assert.equal(h.requests.filter(request => request.kind === 'search').length, searchReads)
    } finally { await h.dispose() }
  })
  test(`${platform}: saved activation describes the actual committed portable Search`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      const state = h.record('saved activation control')
      assert.equal(state.query, savedA.query)
      assert.deepEqual(state.filters, savedA.filters)
      assert.equal(state.activeSavedSearchID, savedA.id)
      assert.equal(state.activeTagID, savedA.filters.tagID)
    } finally { await h.dispose() }
  })

  test(`${platform}: ordinary new query cannot retain an exact saved-rule active marker`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      await h.run(({ binding }) => binding.files.onSearch('invoice'))
      const state = h.record('ordinary new query')
      assert.equal(state.query, 'invoice', 'the real Search must actually change')
      assert.notEqual(state.activeSavedSearchID, savedA.id, 'saved photo rule must not still be marked active for invoice')
    } finally { await h.dispose() }
  })

  test(`${platform}: filter edits clear the saved marker and follow the actual tag predicate`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      await h.run(({ binding }) => binding.changeFilters({ kind: 'text', tagID: 8 }))
      const state = h.record('changed filters control')
      assert.deepEqual(state.filters, { kind: 'text', tagID: 8 })
      assert.equal(state.activeSavedSearchID, null)
      assert.equal(state.activeTagID, 8)
    } finally { await h.dispose() }
  })

  test(`${platform}: unchanged portable filters do not lose their exact saved-rule match`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      await h.run(({ binding }) => binding.changeFilters({ ...savedA.filters }))
      const state = h.record('identical filters reapplied')
      assert.equal(state.query, savedA.query)
      assert.deepEqual(state.filters, savedA.filters)
      assert.equal(state.activeSavedSearchID, savedA.id, 'matching must follow the actual rule rather than the last callback name')
    } finally { await h.dispose() }
  })

  test(`${platform}: directory navigation cannot retain saved-search or tag active markers`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      await h.run(({ binding }) => binding.nav.onNavigate([rootCrumb, folderCrumb]))
      const state = h.record('directory after saved Search')
      assert.equal(state.currentID, 2)
      assert.equal(state.searchActive, false, 'navigation must actually leave Search')
      assert.deepEqual([state.activeSavedSearchID, state.activeTagID], [null, null], 'directory view has no active Search predicates')
    } finally { await h.dispose() }
  })

  test(`${platform}: Back matches restored saved A instead of the later folder Search B`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedA))
      await h.run(({ binding }) => binding.nav.onNavigate([rootCrumb, folderCrumb]))
      await h.run(({ binding }) => binding.nav.onActivateSavedSearch(savedB))
      await h.run(({ binding }) => binding.files.onBack())
      const state = h.record('Back restored A after folder B')
      assert.equal(state.query, savedA.query, 'real history restores A')
      assert.deepEqual(state.filters, savedA.filters)
      assert.deepEqual([state.activeSavedSearchID, state.activeTagID], [savedA.id, tagA.id], 'sidebar must describe restored A instead of stale B')
    } finally { await h.dispose() }
  })

  test(`${platform}: manual Search matching a saved rule is recognized by its portable definition`, async () => {
    const h = await mount(platform)
    try {
      await h.run(({ workspace }) => workspace.applySearch(savedA.query, { ...savedA.filters }))
      const state = h.record('manual exact portable match')
      assert.equal(state.activeSavedSearchID, savedA.id)
      assert.equal(state.activeTagID, tagA.id)
    } finally { await h.dispose() }
  })

  test(`${platform}: pending organization lists are not presented as confirmed empty`, async () => {
    const pending = deferred()
    const h = await mount(platform, { listTags: () => pending.promise, listSavedSearches: () => pending.promise })
    try {
      const state = h.record('pending organization')
      assert.equal(state.organizationLoading, true)
      const texts = [h.section('标签'), h.section('智能文件夹')]
      observations.push({ platform, label: 'pending section text', texts })
      assert.equal(texts.some(text => /暂无/.test(text)), false, 'pending read is unknown, not a confirmed empty organization')
      assert.ok(texts.every(text => /加载/.test(text)), 'both sections explain the pending state')
    } finally { await h.dispose() }
  })

  test(`${platform}: failed organization reads expose an in-section error and retry`, async () => {
    const h = await mount(platform, { listTags: async () => { throw new Error('标签目录读取失败') } })
    try {
      h.record('failed organization')
      assert.deepEqual(h.errors, ['标签目录读取失败'], 'the real controller actually received a failed read')
      const texts = [h.section('标签'), h.section('智能文件夹')]
      observations.push({ platform, label: 'failed section text', texts })
      assert.ok(texts.some(text => /失败/.test(text)) && texts.some(text => /重试/.test(text)), 'failure must remain discoverable beside organization entries')
      assert.equal(texts.some(text => /暂无/.test(text)), false, 'read failure must not claim a known empty list')
    } finally { await h.dispose() }
  })

  test(`${platform}: successful empty organization remains a genuine empty state`, async () => {
    const h = await mount(platform, { listTags: async () => [], listSavedSearches: async () => [] })
    try {
      const state = h.record('successful empty control')
      assert.equal(state.organizationLoading, false)
      assert.deepEqual(h.errors, [])
      assert.doesNotMatch(h.section('标签'), /暂无标签|点击标签查找文件/)
      assert.doesNotMatch(h.section('智能文件夹'), /暂无保存的搜索|保存搜索规则/)
    } finally { await h.dispose() }
  })

  test(`${platform}: empty Tags offers management without requiring selected files`, async () => {
    const h = await mount(platform, { listTags: async () => [], listSavedSearches: async () => [] })
    try {
      const state = h.record('no-selection management entry')
      assert.equal(state.tagDialogOpen, false)
      assert.deepEqual(h.requests.filter(request => request.kind === 'assignments'), [])
      assert.match(h.section('标签'), /管理标签|新建标签/, 'a discoverable organization action must exist without selecting a file')
      await h.run(current => current.binding.nav.onManageTags())
      assert.equal(h.current.binding.tagDialogOpen, true)
      assert.equal(h.current.binding.tagDialogMode, 'manage')
      assert.deepEqual(h.current.binding.tagDialogNodeIDs, [])
      await h.run(current => current.binding.tagDialogClose())
      assert.equal(h.current.binding.tagDialogOpen, false)
    } finally { await h.dispose() }
  })

  test(`${platform}: the tag dialog receives the complete mapped selection for boundary validation`, async () => {
    const h = await mount(platform)
    try {
      const ids = h.current.binding.projectTagDialogNodeIDs([{ id: '19' }, { id: 'unavailable' }])
      assert.equal(ids.length, 2, 'an invalid item must not be silently dropped into a partial assignment')
      assert.equal(ids[0], 19)
      assert.ok(Number.isNaN(ids[1]), 'the shared dialog must see and reject the invalid identifier')
    } finally { await h.dispose() }
  })

  for (const operation of ['update', 'delete']) {
    test(`${platform}: refused saved-rule ${operation} is reported once without an unhandled rejection or optimistic loss`, async () => {
      const message = operation === 'update' ? '更新规则失败' : '删除规则失败'
      const h = await mount(platform, {
        [operation === 'update' ? 'updateSavedSearch' : 'deleteSavedSearch']: async () => { throw new Error(message) },
      })
      const unhandled = []
      const observe = reason => unhandled.push(String(reason))
      process.on('unhandledRejection', observe)
      try {
        await h.run(current => current.binding.nav.onActivateSavedSearch(savedA))
        await h.run(current => operation === 'update'
          ? current.binding.nav.onReplaceSavedSearch(savedA)
          : current.binding.nav.onDeleteSavedSearch(savedA.id))
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(h.errors, [message], 'the authoritative hook reports the original failure exactly once')
        assert.deepEqual(h.current.organization.savedSearches, [savedA, savedB], 'a refused mutation preserves authoritative definitions')
        assert.equal(h.current.binding.nav.activeSavedSearchID, savedA.id)
        assert.deepEqual(h.feedback, [], 'a refused mutation must not announce success')
        assert.deepEqual(unhandled, [], 'the fire-and-forget caller must consume the already-reported rejection')
      } finally {
        process.removeListener('unhandledRejection', observe)
        await h.dispose()
      }
    })
  }
}
