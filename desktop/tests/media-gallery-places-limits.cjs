const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const repo = path.resolve(process.env.XDRIVE_PLACES_SOURCE_ROOT || path.join(__dirname, '../..'))
const sha = value => createHash('sha256').update(value).digest('hex')
const sources = Object.fromEntries(['web/src/api.ts', 'desktop/src/main/index.cts', 'desktop/src/main/agent_client.cts']
  .map(file => [file, fs.readFileSync(path.join(repo, file), 'utf8')]))
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const moduleFrom = source => {
  const value = { exports: {} }
  new Function('exports', 'module', compile(source))(value.exports, value)
  return value.exports
}
const receipt = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, sha(source)])),
  fixtureHash: sha(fs.readFileSync(__filename)), extractedHashes: {}, checks: [],
  boundary: 'Actual TypeScript AST Web method and registered Desktop handler, including actual AgentIPCError. Only existing HTTP/client/lifecycle boundaries are controlled; no copied limiter, Server, Electron or Agent process claim.',
}

const webAst = ts.createSourceFile('api.ts', sources['web/src/api.ts'], ts.ScriptTarget.Latest, true)
const apiClass = webAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'XDriveApi')
const method = apiClass?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(webAst) === 'mediaPlaces')
assert.ok(method, 'real XDriveApi.mediaPlaces method exists')
const actualMethod = method.getText(webAst)
receipt.extractedHashes.webMethod = sha(actualMethod)
const ActualApi = moduleFrom(`export class ActualApi { ${actualMethod} }`).ActualApi

const mainAst = ts.createSourceFile('index.cts', sources['desktop/src/main/index.cts'], ts.ScriptTarget.Latest, true)
let callback
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(mainAst) === 'ipcMain.handle'
    && node.arguments[0]?.text === 'agent:get-media-places') callback = node.arguments[1]
  ts.forEachChild(node, visit)
}
visit(mainAst)
assert.ok(callback, 'actual registered agent:get-media-places handler exists')
const clientAst = ts.createSourceFile('agent_client.cts', sources['desktop/src/main/agent_client.cts'], ts.ScriptTarget.Latest, true)
const errorClass = clientAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AgentIPCError')
assert.ok(errorClass, 'actual AgentIPCError class exists')
const { AgentIPCError } = moduleFrom(errorClass.getText(clientAst))
const actualHandler = callback.getText(mainAst)
receipt.extractedHashes.desktopHandler = sha(actualHandler)

function desktopHandler(calls) {
  return new Function('runAgentAction', 'requireAgentLifecycle', 'requireAgentCapability', 'requireAgentClient', 'AgentIPCError',
    compile(`const handler = ${actualHandler};`) + '\nreturn handler;')(
      async action => action(),
      () => ({ ensureRunning: async () => ({ capabilities: ['media-gallery'] }) }),
      (hello, capability) => assert.ok(hello.capabilities.includes(capability)),
      () => ({ mediaPlaces: async limit => { calls.push(limit); return [] } }),
      AgentIPCError,
    )
}

for (const [input, expected, name] of [
  [undefined, 24, 'default stays 24'], [100, 100, 'ordinary 100 stays 100'],
  [1000, 1000, 'expanded map preserves existing Server-supported 1000'],
]) {
  test(`Web Places: ${name}`, async () => {
    const api = new ActualApi()
    let url
    api.request = async path => { url = path; return [] }
    await api.mediaPlaces(input)
    const actual = Number(new URL(url, 'https://fixture.invalid').searchParams.get('limit'))
    receipt.checks.push({ name: `Web: ${name}`, input, expected, actual, url, passed: actual === expected })
    assert.equal(actual, expected)
  })
}

for (const [input, expected, name] of [
  [undefined, 24, 'default reaches existing Agent client 24'],
  [100, 100, 'ordinary 100 reaches existing Agent client 100'],
  [1000, 1000, 'expanded 1000 reaches existing Server-capable Agent client'],
]) {
  test(`Desktop Places: ${name}`, async () => {
    const calls = []
    let error
    try { await desktopHandler(calls)({}, input) }
    catch (caught) { error = { name: caught.name, message: caught.message, code: caught.code, status: caught.status } }
    const actual = calls.at(-1) ?? null
    receipt.checks.push({ name: `Desktop: ${name}`, input, expected, actual, error, passed: !error && actual === expected })
    assert.equal(error, undefined)
    assert.equal(actual, expected)
  })
}

process.on('exit', () => {
  if (!process.env.XDRIVE_PLACES_LIMIT_RECEIPT) return
  receipt.passed = receipt.checks.filter(check => check.passed).length
  receipt.failed = receipt.checks.length - receipt.passed
  receipt.sourceHashMatch = Object.entries(sources).every(([file, source]) => sha(fs.readFileSync(path.join(repo, file))) === sha(source))
  fs.writeFileSync(process.env.XDRIVE_PLACES_LIMIT_RECEIPT, JSON.stringify(receipt, null, 2) + '\n')
})
