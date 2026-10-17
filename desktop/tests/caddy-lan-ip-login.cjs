const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const script = path.join(root, 'deploy/caddy-lan-start.sh')

test('opt-in IP site shares HTTPS port, proxies exact same Web/API, retains public AliDNS', () => {
  const compose = read('deploy/docker-compose.yml')
  const file = read('deploy/Caddyfile.lan-ip')
  const old = read('deploy/Caddyfile')
  const image = read('deploy/Caddy.Dockerfile')
  const common = read('deploy/Caddyfile.common')
  const router = read('internal/api/router.go')
  assert.match(compose, /XD_LAN_HTTPS_IP: \$\{XD_LAN_HTTPS_IP:-\}/)
  assert.match(compose, /XD_WEB_BIND:-127\.0\.0\.1/)
  assert.match(compose, /XD_HTTPS_PORT:-8443}:443\/tcp/)
  assert.match(compose, /\/usr\/local\/bin\/xdrive-caddy-start/)
  assert.match(image, /COPY deploy\/Caddyfile\.lan-ip/)
  assert.match(image, /COPY deploy\/caddy-lan-start\.sh/)
  assert.match(image, /chmod 0755 \/usr\/local\/bin\/xdrive-caddy-start/)
  assert.match(image, /caddy adapt --config \/etc\/caddy\/Caddyfile\.lan-ip/)
  assert.match(file, /\{\$XD_DOMAIN\} \{/)
  assert.match(file, /\{\$XD_LAN_HTTPS_IP\} \{\s*tls internal/)
  assert.match(file, /dns alidns/)
  assert.match(file, /import xdrive_app/g)
  assert.match(old, /dns alidns/)
  assert.match(common, /reverse_proxy server:8080/)
  assert.match(router, /v1\.POST\("\/auth\/login", s\.login\)/)
  assert.match(router, /v1\.POST\("\/auth\/refresh", s\.refresh\)/)
  assert.doesNotMatch(file, /tls_insecure_skip_verify|reverse_proxy https:\/\/192|skip_verify/)
})

test('installer rejects unsafe/ambiguous private IP and never opens plaintext WAN/LAN login port', () => {
  const installer = read('deploy/install-server.sh')
  const compose = read('deploy/docker-compose.yml')
  assert.match(installer, /ensure_env XD_LAN_HTTPS_IP/)
  assert.match(installer, /validate_private_lan_https_ip "\$lan_https_ip"/)
  assert.match(installer, /XD_LAN_HTTPS_IP requires XD_DOMAIN/)
  assert.match(installer, /XD_HTTPS_BIND must permit the LAN IPv4 address/)
  assert.match(installer, /set_env XD_WEB_BIND "127\.0\.0\.1"/)
  assert.match(compose, /XD_WEB_BIND:-127\.0\.0\.1/)
  assert.doesNotMatch(compose, /XD_LAN_HTTP_BIND|XD_LAN_HTTP_PORT|XD_LAN_NO_TLS/)
})

test('Caddy runtime selector refuses spoofed IPs and defaults to untouched domain/HTTP mode', {
  skip: process.platform === 'win32',
}, () => {
  const check = (ip, domain = 'drive.example.com') => spawnSync('sh', [script, '--check'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin', XD_DOMAIN: domain, XD_LAN_HTTPS_IP: ip },
  })
  assert.equal(check('').stdout.trim(), '/etc/caddy/Caddyfile')
  assert.equal(check('', '').stdout.trim(), '/etc/caddy/Caddyfile.http')
  for (const ip of ['192.168.2.4', '10.0.0.2', '172.16.0.1', '172.31.255.254']) {
    const result = check(ip)
    assert.equal(result.status, 0, ip + ': ' + result.stderr)
    assert.equal(result.stdout.trim(), '/etc/caddy/Caddyfile.lan-ip')
  }
  for (const ip of ['8.8.8.8', '127.0.0.1', '169.254.1.1', '172.15.2.4',
    '172.32.2.4', '192.168.02.4', '192.168.2.256', '192.168.2.4;whoami',
    '192.168.2.4/example', '192.168.2.4 ', '192.168.2', '192.168.2.4.5',
    '0.0.0.0', '[::1]', '\u0024{XD_DOMAIN}']) {
    const result = check(ip)
    assert.notEqual(result.status, 0, 'must reject: ' + ip)
    assert.match(result.stderr, /canonical RFC1918 IPv4/)
  }
  const noDomain = check('192.168.2.4', '')
  assert.notEqual(noDomain.status, 0)
  assert.match(noDomain.stderr, /requires a configured public XD_DOMAIN/)
})

test('manual Web and Agent switching is independent of server certificate and refresh-token secrets', () => {
  const dialog = read('web/src/ManualConnectionDialog.tsx')
  const helper = read('web/src/manualConnection.ts')
  const desktop = read('desktop/src/renderer/App.tsx')
  const api = read('web/src/api.ts')
  const docs = read('docs/network-manual-connection.md')
  assert.match(dialog, /target="_blank" rel="noopener noreferrer"/)
  assert.match(helper, /privateIPv4/)
  assert.match(desktop, /data-xdrive-manual-server-switch/)
  assert.match(api, /Authorization/)
  assert.match(docs, /tls internal/)
  for (const forbidden of ['window.location.assign', 'window.location.replace', 'refresh_token', 'access_token']) {
    assert.equal(dialog.includes(forbidden), false)
  }
})
