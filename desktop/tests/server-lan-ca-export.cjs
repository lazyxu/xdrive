'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const host = path.join(root, 'scripts/xdrive-server-host.sh')

test('Host CA export is trusted-local, validates live IP TLS, and never overwrites roots', {
  skip: process.platform === 'win32' || spawnSync('openssl', ['version']).status !== 0,
}, t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-ca-'))
  t.after(() => fs.rmSync(work, { recursive: true, force: true }))
  const config = path.join(work, 'config')
  const bin = path.join(work, 'bin')
  fs.mkdirSync(config)
  fs.mkdirSync(bin)
  const envFile = path.join(config, '.env')
  fs.writeFileSync(envFile, 'XD_LAN_HTTPS_IP=192.168.2.4\nXD_HTTPS_PORT=8443\n')
  fs.writeFileSync(path.join(config, 'docker-compose.yml'), 'services: {}\n')
  const cert = path.join(work, 'trusted-root.crt')
  const key = path.join(work, 'trusted-root.key')
  const issued = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=xDrive test local CA',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { encoding: 'utf8' })
  assert.equal(issued.status, 0, issued.stderr)

  fs.writeFileSync(path.join(bin, 'docker'), [
    '#!/bin/sh',
    'case " $* " in',
    '  *" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt "*) cat "$XDRIVE_TEST_CA" ;;',
    '  *) exit 51 ;;',
    'esac',
    '',
  ].join('\n'), {mode:0o700})
  fs.writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'printf "%s\\n" "$@" > "$XDRIVE_TEST_CURL_ARGS"',
    'printf "%s" "$XDRIVE_TEST_HTTP"',
    '',
  ].join('\n'), {mode:0o700})
  const output = path.join(work, 'exported-root.crt')
  const argsLog = path.join(work, 'curl-args')
  const run = (moreEnv={}) => spawnSync('bash', [host, 'lan-ca', 'export', output], {
    encoding: 'utf8', timeout: 12000,
    env: { ...process.env, PATH: bin+path.delimiter+process.env.PATH,
      XD_CONFIG_DIR: work, XDRIVE_TEST_CA: cert, XDRIVE_TEST_HTTP: '200',
      XDRIVE_TEST_CURL_ARGS: argsLog, ...moreEnv },
  })
  const good = run()
  assert.equal(good.status, 0, good.stderr)
  assert.deepEqual(fs.readFileSync(output), fs.readFileSync(cert))
  assert.equal(fs.statSync(output).mode & 0o777, 0o600)
  assert.match(good.stdout, /Verified LAN HTTPS: https:\/\/192\.168\.2\.4:8443/)
  assert.match(good.stdout, /CA PEM SHA256 \(compare on client\): [a-f0-9]{64}/)
  assert.match(good.stdout, /No operating-system certificate stores/)
  const args = fs.readFileSync(argsLog, 'utf8')
  for (const expected of ['--noproxy', '--cacert', '/api/v1/readyz', '--connect-timeout']) {
    assert.match(args, new RegExp(expected))
  }
  assert.doesNotMatch(args, /(?:^|\n)-k(?:\n|$)|--insecure/)
  assert.match(args, /https:\/\/192\.168\.2\.4:8443\/api\/v1\/readyz/)
  const exists = run()
  assert.notEqual(exists.status, 0)
  assert.deepEqual(fs.readFileSync(output), fs.readFileSync(cert))
  fs.unlinkSync(output)

  const redirect = run({XDRIVE_TEST_HTTP:'302'})
  assert.notEqual(redirect.status, 0)
  assert.equal(fs.existsSync(output), false)
  fs.writeFileSync(envFile, 'XD_LAN_HTTPS_IP=8.8.8.8\nXD_HTTPS_PORT=8443\n')
  const publicIP = run()
  assert.notEqual(publicIP.status, 0)
  assert.equal(fs.existsSync(output), false)
  fs.writeFileSync(envFile, 'XD_LAN_HTTPS_IP=192.168.2.4\nXD_HTTPS_PORT=8443\n')
  const fakeCert = path.join(work, 'fake.crt')
  fs.writeFileSync(fakeCert, 'not a CA certificate')
  const invalidRoot = run({XDRIVE_TEST_CA:fakeCert})
  assert.notEqual(invalidRoot.status, 0)
  assert.equal(fs.existsSync(output), false)
})

test('CA export source uses the existing trusted Docker control plane, not HTTPS TOFU', () => {
  const src = fs.readFileSync(host, 'utf8')
  assert.match(src, /compose exec -T caddy cat \/data\/caddy\/pki\/authorities\/local\/root\.crt/)
  assert.match(src, /openssl verify -CAfile "\$temp" "\$temp"/)
  assert.match(src, /--noproxy '\*' --cacert "\$temp"/)
  assert.match(src, /"https:\/\/\$ip:\$port\/api\/v1\/readyz"/)
  assert.match(src, /ln -- "\$temp" "\$output"/)
  assert.doesNotMatch(src, /curl[^\n]*\s-k(?:\s|$)|tls_insecure_skip_verify/)
})
