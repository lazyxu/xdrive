'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const renderer = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const shared = read('ui/shared/src/mui/FileExplorerSearch.ts')
const preload = read('desktop/src/preload/index.cts')
const types = read('desktop/src/renderer/global.d.ts')
const main = read('desktop/src/main/index.cts')
const agent = read('desktop/src/main/agent_client.cts')

function section(source, first, last) {
  const start = source.indexOf(first)
  assert.ok(start >= 0, 'missing start of ' + first)
  const end = source.indexOf(last, start + first.length)
  assert.ok(end > start, 'missing end of ' + first)
  return source.slice(start, end)
}

test('Desktop Files Search initial and virtual Ranges reach sender-scoped Agent GET cancellation', () => {
  // Shared Search already cancels old first-page and virtualized page signals.
  assert.match(shared, /initialPageControllerRef\.current\?\.abort\(\)/)
  assert.match(shared, /XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,\s*controller\.signal,/)
  assert.match(shared, /range\.limit,\s*signal,/)
  const search = section(renderer, 'loadSearchRange: async', 'loadRoot: async')
  assert.match(search, /limit,\s*signal\)\s*=>/)
  assert.match(search, /hostPort\.requestViewport\(signal,\s*requestID =>/)
  assert.match(search, /hostPort\.browse\.cloudSearchRange\([\s\S]*?searchGrouping,\s*requestID,/)
  assert.doesNotMatch(search, /cancelTransfer|cancelBackup|cancelSync|cloudDownload|cloudUpload|cloudRename/)
  const pre = section(preload, '  cloudSearchRange: (', "  cloudQuota: (")
  assert.match(pre, /requestID\?: string/)
  assert.match(pre, /'agent:cloud-search-range'[\s\S]*?grouping,\s*requestID,/)
  const type = section(types, '        cloudSearchRange: (', '        cloudQuota: ')
  assert.match(type, /requestID\?: string/)
  const handler = section(main, "ipcMain.handle('agent:cloud-search-range'", "ipcMain.handle('agent:cloud-quota'")
  assert.match(handler, /viewportRequests\.run\(event\.sender,\s*requestID,\s*async\s*\(?signal\)?\s*=>/)
  assert.match(handler, /requireAgentCapability\(hello, 'cloud-files'\)/)
  assert.match(handler, /normalizeCloudSearchFilters\(filtersValue\)/)
  assert.match(handler, /normalizeFileExplorerGrouping\(groupingValue\)/)
  assert.match(handler, /requireAgentClient\(\)\.cloudSearchRange\([\s\S]*?grouping,\s*signal,/)
  const transport = section(agent, '  cloudSearchRange(', '  cloudQuota()')
  assert.match(transport, /signal\?: AbortSignal/)
  assert.match(transport, /filters\.availability \? 130_000 : 45_000,\s*signal,/,
    'availability-based slow search retains its timeout; only obsolete GET aborts')
  assert.match(transport, /this\.request<AgentCloudSearchRange>\(\s*'GET'/)
})

test('Desktop Files Column A to B forwards its signal, but legacy cursor callers stay compatible', () => {
  const columns = section(renderer, 'const loadColumnPage = useCallback', 'const favorites =')
  assert.match(columns, /signal: AbortSignal/)
  assert.match(columns, /hostPort\.requestViewport\(signal,\s*requestID =>/)
  assert.match(columns, /hostPort\.browse\.cloudChildrenPage\([\s\S]*?requestID\)/)
  const pre = section(preload, '  cloudChildrenPage: (', '  cloudChildrenRange: (')
  assert.match(pre, /requestID\?: string/)
  assert.match(pre, /ipcRenderer\.invoke\('agent:cloud-children-page', parentID, options, requestID\)/)
  const type = section(types, '        cloudChildrenPage: (', '        cloudChildrenRange: (')
  assert.match(type, /requestID\?: string/)
  const handler = section(main, "ipcMain.handle('agent:cloud-children-page'", 'const normalizeFileExplorerGrouping =')
  assert.match(handler, /viewportRequests\.run\(event\.sender,\s*requestID,\s*async\s*\(?signal\)?\s*=>/)
  assert.match(handler, /requireAgentCapability\(hello, 'cloud-files'\)/)
  assert.match(handler, /Directory page limit must be between 1 and 500/)
  assert.match(handler, /requireAgentClient\(\)\.cloudChildrenPage\(parentID, \{[\s\S]*?\}, signal\)/)
  const transport = section(agent, '  cloudChildrenPage(', '  cloudChildrenRange(')
  assert.match(transport, /signal\?: AbortSignal/)
  assert.match(transport, /this\.request<AgentCloudChildrenPage>\([\s\S]*?'GET'[\s\S]*?10_000,\s*signal,/)
  // Non-viewport uses (folder-upload lookup, navigation tree) still pass no
  // request ID, so Main's existing no-request-ID branch runs normally.
  const viewport = read('desktop/src/main/viewport_requests.cts')
  assert.match(viewport, /if \(requestID === undefined\) return execute\(\)/)
  assert.match(viewport, /this\.key\(sender, requestID\)/)
})

test('aborting obsolete Desktop Files query cannot cancel current search or durable jobs', async () => {
  const file = 'desktop/src/renderer/abortableViewportRequest.ts'
  const js = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', js)(mod.exports, mod)
  const previous = global.window
  const cancels = []
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => { cancels.push(id); return { ok: true } },
  } } }
  let resolveOld, resolveNew
  const oldGate = new Promise(resolve => { resolveOld = resolve })
  const newGate = new Promise(resolve => { resolveNew = resolve })
  const first = new AbortController()
  const second = new AbortController()
  const durableUpload = new AbortController()
  const durableDownload = new AbortController()
  const durableBackup = new AbortController()
  const durableSync = new AbortController()
  let oldID, newID
  try {
    const oldRead = mod.exports.xDriveDesktopViewportRequest(first.signal, id => {
      oldID = id
      return oldGate
    })
    const currentRead = mod.exports.xDriveDesktopViewportRequest(second.signal, id => {
      newID = id
      return newGate
    })
    assert.ok(oldID?.startsWith('viewport-') && newID?.startsWith('viewport-'))
    assert.notEqual(oldID, newID, 'same-window searches have distinct cancel IDs')
    first.abort()
    assert.deepEqual(cancels, [oldID], 'only superseded read-only Range is cancelled')
    resolveOld({ data: { items: ['obsolete'] } })
    await assert.rejects(oldRead, error => error?.name === 'AbortError')
    resolveNew({ data: { items: ['current'] } })
    assert.deepEqual((await currentRead).data.items, ['current'])
    assert.equal(second.signal.aborted, false)
    for (const durable of [durableUpload, durableDownload, durableBackup, durableSync]) {
      assert.equal(durable.signal.aborted, false, 'durable operation was touched by viewport abort')
    }
    assert.deepEqual(cancels, [oldID])
  } finally {
    resolveOld?.({ data: null })
    resolveNew?.({ data: null })
    if (previous === undefined) delete global.window
    else global.window = previous
  }
})
