const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
function compile(source, filename) {
  return ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}, fileName: filename,
  }).outputText
}
const modelFile = path.join(root, 'ui/shared/src/server-update.ts')
const model = {exports: {}}
new Function('module', 'exports', compile(fs.readFileSync(modelFile, 'utf8'), modelFile))(model, model.exports)

test('server source choices and confirmation display xDrive Share without relabeling it GitHub', () => {
  assert.deepEqual(model.exports.xDriveServerUpdateSources, [
    {value: 'github', label: 'GitHub'}, {value: 'gitlab', label: 'GitLab'}, {value: 'xdrive', label: 'xDrive 分享'},
  ])
  for (const [source, label] of [['github', 'GitHub'], ['gitlab', 'GitLab'], ['xdrive', 'xDrive 分享']]) {
    const summary = model.exports.xDriveServerUpdateConfirmationDescription({source, channel: 'master', backupFileData: true})
    assert.ok(summary.includes('来源：' + label))
    assert.ok(summary.includes('文件数据备份：开启'))
  }
})

test('Share channel choices expose master only while GitHub and GitLab retain both channels', () => {
  for (const source of ['github', 'gitlab', 'xdrive']) {
    const options = model.exports.xDriveServerUpdateChannelsForSource(source)
    assert.deepEqual(options.map((option) => option.value), source === 'xdrive' ? ['master'] : ['stable', 'master'])
    for (const channel of ['stable', 'master']) {
      assert.equal(model.exports.xDriveServerUpdateChannelForSource(source, channel), source === 'xdrive' ? 'master' : channel)
    }
  }
})

function actualServerStartHandler(client) {
  const filename = path.join(root, 'desktop/src/main/index.cts')
  const source = fs.readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let handler
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle' &&
        node.arguments[0]?.text === 'agent:start-server-update') handler = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(handler, 'must exercise the actual Electron server-update handler')
  const code = compile('const handler = ' + handler.getText(ast) + ';', filename)
  return new Function('runAgentAction', 'requireAgentLifecycle', 'requireAgentCapability', 'requireAgentClient', 'AgentIPCError', 'exports',
    code + '\nreturn handler;')(
    (operation) => operation(), () => ({ensureRunning: async () => ({capabilities: ['server-update']})}),
    (hello, capability) => assert.ok(hello.capabilities.includes(capability)), () => client,
    class AgentIPCError extends Error {}, {},
  )
}

test('Electron server update gate accepts Share master and refuses Share stable before transport', async () => {
  const calls = []
  const handler = actualServerStartHandler({startServerUpdate: async (...args) => { calls.push(args); return {state: 'queued'} }})
  await handler(null, 'xdrive', 'master', true)
  assert.deepEqual(calls, [['xdrive', 'master', true]])
  await assert.rejects(handler(null, 'xdrive', 'stable', false))
  assert.equal(calls.length, 1)
  for (const source of ['github', 'gitlab']) {
    for (const channel of ['stable', 'master']) await handler(null, source, channel, false)
  }
  assert.equal(calls.length, 5)
})
