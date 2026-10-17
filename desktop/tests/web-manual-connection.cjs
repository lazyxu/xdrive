const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const file = 'web/src/manualConnection.ts'
function loadHelper() {
  const compiled = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const failures = (compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(failures.map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  const exports = {}
  new Function('exports', 'require', compiled.outputText)(exports, () => {
    throw new Error('manual connection validation must be pure')
  })
  return exports
}

test('manual LAN origin accepts only canonical private IPv4 with explicit scheme/port', () => {
  const { xDriveManualEndpoint: check } = loadHelper()
  for (const ip of ['192.168.2.4', '10.0.0.5', '172.16.0.1', '172.31.255.254']) {
    assert.deepEqual(check('lan', 'https://' + ip + ':8443'), {
      origin: 'https://' + ip + ':8443', insecure: false, error: '',
    })
  }
  assert.deepEqual(check('lan', 'http://192.168.2.4:3000'), {
    origin: 'http://192.168.2.4:3000', insecure: true, error: '',
  })
  for (const candidate of [
    'https://8.8.8.8:8443', 'https://172.32.0.1',
    'https://127.0.0.1', 'https://169.254.0.1', 'https://0.0.0.0',
    'https://192.168.02.4:8443', 'https://192.168.2.4.example.com',
    'https://user:password@192.168.2.4', 'https://192.168.2.4/?token=secret',
    'https://192.168.2.4/#/app', 'https://192.168.2.4/files',
    'javascript:alert(1)', '//192.168.2.4', 'http://192.168.2.4:65536',
  ]) {
    const result = check('lan', candidate)
    assert.ok(result.error && !result.origin, 'must fail closed: ' + candidate)
  }
})

test('manual public entry requires HTTPS domain and strips path-bearing inputs', () => {
  const { xDriveManualEndpoint: check } = loadHelper()
  assert.deepEqual(check('public', ' https://drive.example.com:8443/ '), {
    origin: 'https://drive.example.com:8443', insecure: false, error: '',
  })
  for (const url of [
    'http://drive.example.com', 'https://192.168.2.4',
    'https://localhost:8443', 'https://internal.local',
    'https://evil.example.com/a', 'https://drive.example.com/?s=1',
    'https://drive.example.com/#/app', 'https://user@drive.example.com',
    'file:///etc/passwd', 'data:text/plain,hi',
  ]) {
    const result = check('public', url)
    assert.ok(result.error && !result.origin, 'reject public endpoint: ' + url)
  }
})

test('Web/Mobile Web/PWA login and account menu expose manual origin navigation without token migration', () => {
  const app = read('web/src/App.tsx')
  const dialog = read('web/src/ManualConnectionDialog.tsx')
  const helper = read(file)
  assert.match(app, /data-xdrive-manual-connection-login/)
  assert.match(app, /data-xdrive-manual-connection-menu/)
  assert.ok((app.match(/<XDriveManualConnectionDialog/g) || []).length >= 2)
  assert.match(dialog, /data-xdrive-open-manual-lan/)
  assert.match(dialog, /data-xdrive-open-manual-public/)
  assert.match(dialog, /target="_blank" rel="noopener noreferrer"/)
  assert.match(dialog, /allowInsecureLAN/)
  assert.match(dialog, /lanTarget\.insecure/)
  assert.match(dialog, /HTTPS.*证书/)
  assert.match(dialog, /window\.location\.origin/)
  assert.match(dialog, /window\.localStorage\.(?:getItem|setItem)/)
  assert.match(helper, /'xdrive\.manual_endpoint\.lan'/)
  assert.match(helper, /'xdrive\.manual_endpoint\.public'/)
  for (const forbidden of ['Authorization', 'refresh_token', 'access_token',
    'window.location.assign', 'window.location.replace', 'location.href', 'fetch(',
    'window.opener', 'document.cookie']) {
    assert.equal(dialog.includes(forbidden), false, 'manual navigation never touches credentials or running transports: ' + forbidden)
  }
  assert.match(app, /window\.addEventListener\('beforeunload', xDriveWarnBeforeLeavingUpload\)/)
  assert.match(app, /setTransferSessionKey\(username \?/)
})

test('Desktop explicit switch goes through existing logout confirmation and editable Server login', () => {
  const app = read('desktop/src/renderer/App.tsx')
  assert.match(app, /data-xdrive-manual-server-switch/)
  assert.match(app, /const requestSwitchServer = \(\) => \{/)
  assert.match(app, /requestConfirmation\(/)
  assert.match(app, /await run\('logout', \(\) => window\.xdriveDesktop\.agent\.logout\(\)\)/)
  assert.match(app, /id="desktop-login-server"/)
  assert.match(app, /freeSolo/)
  assert.match(app, /server: server\.trim\(\)/)
  assert.doesNotMatch(app, /setServer\('192\.168\.2\.4'\)/)
})
