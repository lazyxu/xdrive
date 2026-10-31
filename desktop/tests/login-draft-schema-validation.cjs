const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the real standalone pure TypeScript normalization, not a surrogate.
const filename = path.join(__dirname, '../../ui/shared/src/login-draft.ts')
const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, URL }
vm.runInNewContext(js, context)
const normalize = context.exports.xDriveNormalizeLoginDraft
const draft = (server, lanIp = '', username = 'alice') =>
  normalize({ version: 1, server, lanIp, username })

test('restore a valid HTTPS login draft without storing credentials', () => {
  const valid = draft('https://drive.example.com:8443', '192.168.2.4')
  assert.equal(valid.server, 'https://drive.example.com:8443')
  assert.equal(valid.lanIp, '192.168.2.4')
  assert.equal(valid.username, 'alice')
  assert.equal(draft('', '', 'alice').username, 'alice')
})

test('reject unsafe origins, URL-embedded passwords and token queries', () => {
  for (const server of [
    'http://drive.example.com', 'https://alice:secret@drive.example.com',
    'https://drive.example.com/?token=secret', 'https://drive.example.com/#secret',
    'https://drive.example.com/evil', 'https://drive.example.com\n/evil',
    'not-a-url',
  ]) {
    assert.equal(draft(server).server, '', 'unsafe origin accepted: ' + JSON.stringify(server))
  }
})

test('reject nonprivate/ambiguous LAN hints and malformed records', () => {
  for (const ip of ['8.8.8.8', '192.168.001.2', '172.32.0.1', 'localhost', '10.1.1.1:8443']) {
    assert.equal(draft('https://drive.example.com', ip).server, '', 'unsafe LAN IP: ' + ip)
  }
  assert.equal(normalize({ version: 2, server: 'https://drive.example.com', lanIp: '', username: 'a' }).server, '')
  assert.equal(normalize({ server: 'https://drive.example.com', lanIp: '', username: 'a\nsecret' }).server, '')
})
