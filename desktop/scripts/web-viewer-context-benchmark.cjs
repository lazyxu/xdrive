// Controlled-latency request replay; this does not measure server, decode, or renderer latency.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const repo = path.join(__dirname, '../..')
const baseline = process.argv.includes('--baseline')
const direct = process.argv.includes('--direct')
const upstream = process.argv.includes('--upstream')
const source = baseline || upstream ? execFileSync('git', ['show', `${upstream ? '30e9eb7' : '3a35c385'}:web/src/webViewerContext.ts`], { cwd: repo, encoding: 'utf8' }) : fs.readFileSync(path.join(repo, 'web/src/webViewerContext.ts'), 'utf8')
const mod = { exports: {} }
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
new Function('exports', 'module', 'require', output)(mod.exports, mod, () => ({ xDriveClassifyFilePreview: () => 'image' }))
const methods = mod.exports
const delay = () => new Promise((resolve) => setTimeout(resolve, 8))
const node = (id) => ({ id, revision: 1, name: `${id}.jpg`, type: 'file', size: 1, created_at: '', updated_at: '' })
async function sample() {
  const counts = { range: 0, node: 0, media: 0 }
  const api = {
    node: async (id) => { counts.node++; await delay(); return node(id) },
    mediaItem: async (id) => { counts.media++; await delay(); return { node: node(id), metadata: {} } },
  }
  const gallery = { listItemRange: async (limit, offset) => { counts.range++; await delay(); return { total_count: 100000, items: Array.from({ length: limit }, (_, i) => ({ node: node(offset + i + 1), metadata: {} })) } } }
  const context = direct ? null : { kind: 'gallery', target: { kind: 'library', query: {} }, activeIndex: 64, totalCount: 100000 }
  const start = performance.now()
  for (let index = 64; index < 84; index++) {
    // Match mounted hook freshness: every active-item step owns a new reader.
    const resolver = upstream && context ? methods.xDriveCreateWebViewerContextResolver(api, gallery, context) : null
    const reader = baseline || (upstream && direct) ? {
      current: async (id) => Promise.all([api.node(id), api.mediaItem(id)]),
      neighbor: (i, direction, predicate) => methods.xDriveFindWebViewerNeighbor(api, gallery, context, i, direction, predicate),
    } : upstream ? {
      current: (_id, i) => resolver.resolveCandidateAt(i),
      neighbor: (i, direction, predicate) => resolver.findNeighbor(i, direction, predicate),
    } : methods.createXDriveWebViewerSession(api, gallery, context)
    await Promise.all([
      reader.current(index + 1, index, true),
      ...(direct ? [] : [reader.neighbor(index, -1, () => true), reader.neighbor(index, 1, () => true)]),
    ])
  }
  return { ms: Number((performance.now() - start).toFixed(3)), ...counts }
}
;(async () => {
  const samples = []
  for (let i = 0; i < 5; i++) samples.push(await sample())
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b)
  console.log(JSON.stringify({ workload: direct ? 'viewer-direct-media-20-distinct-links' : 'viewer-gallery-100k-20-same-page-steps', mode: baseline ? 'before-fixed-base-3a35c385' : upstream ? 'upstream-30e9eb7' : 'after-fresh-active-step', transportDelayMs: 8, samples, medianMs: sorted[2], minMs: sorted[0], maxMs: sorted[4] }, null, 2))
})().catch((error) => { console.error(error); process.exitCode = 1 })
