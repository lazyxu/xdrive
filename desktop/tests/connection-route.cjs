const test = require('node:test')
const assert = require('node:assert/strict')
const { parseConnectionRoute, selectConnectionRoute, ConnectionRouteError, publicConnectionIP } = require('../dist/main/connection_route.cjs')

test('route settings reject ambiguous IPs, unsafe public targets and missing LAN-only target', () => {
  assert.deepEqual(parseConnectionRoute(undefined), { mode: 'auto', lan_ip: '', public_ip: '' })
  for (const value of [
    { mode: 'invalid' }, { mode: null }, { mode: 'public', public_ip: null }, { mode: 'auto', lan_ip: null }, { mode: 'lan' }, { mode: 'auto', lan_ip: 'drive.example' },
    { mode: 'lan', lan_ip: '127.0.0.1' }, { mode: 'auto', lan_ip: '192.168.02.4' },
    { mode: 'public', public_ip: '192.168.2.4' }, { mode: 'public', public_ip: '::1' },
    { mode: 'public', public_ip: '169.254.1.2' }, { mode: 'public', public_ip: '224.0.0.1' },
    { mode: 'public', public_ip: 'https://8.8.8.8:443/' }, { mode: 'auto', lan_ip: '192.168.2.4:8443' },
  ]) assert.throws(() => parseConnectionRoute(value), ConnectionRouteError)
  assert.equal(publicConnectionIP('8.8.8.8'), true)
  assert.equal(publicConnectionIP('2001:4860:4860::8888'), true)
  assert.equal(publicConnectionIP('::ffff:192.168.2.4'), false)
  for (const ip of ['2001:2::1', '2001:10::1', '3fff::1', '192.88.99.1']) assert.equal(publicConnectionIP(ip), false, ip)
})

test('auto prefers verified LAN without DNS; transport failure probes public before choosing it', async () => {
  const route = { mode: 'auto', lan_ip: '192.168.2.4', public_ip: '' }
  const calls = []
  const deps = {
    resolvePublic: async host => { calls.push(['dns', host]); return ['192.168.2.4', '122.235.226.93'] },
    probe: async (server, ip) => { calls.push(['probe', server, ip]); return 'fixture-v1' },
  }
  assert.deepEqual(await selectConnectionRoute('https://drive.example:8443/', route, undefined, deps),
    { ip: '192.168.2.4', kind: 'lan', version: 'fixture-v1' })
  assert.equal(calls.length, 1)
  calls.length = 0
  deps.probe = async (server, ip) => {
    calls.push(['probe', server, ip])
    if (ip === '192.168.2.4') throw new ConnectionRouteError('server_refused')
    return 'fixture-v2'
  }
  assert.deepEqual(await selectConnectionRoute('https://drive.example:8443/', route, undefined, deps),
    { ip: '122.235.226.93', kind: 'public', version: 'fixture-v2' })
  assert.deepEqual(calls, [['probe', 'https://drive.example:8443/', '192.168.2.4'],
    ['dns', 'drive.example'], ['probe', 'https://drive.example:8443/', '122.235.226.93']])
})

test('certificate or HTTP identity failure never triggers public fallback or a credential request', async () => {
  for (const code of ['server_tls_trust', 'server_tls_name', 'server_invalid_response', 'server_auth_redirect']) {
    let resolved = false
    await assert.rejects(selectConnectionRoute('https://drive.example', { mode: 'auto', lan_ip: '192.168.2.4' }, undefined, {
      resolvePublic: async () => { resolved = true; return ['8.8.8.8'] },
      probe: async () => { throw new ConnectionRouteError(code) },
    }), error => error.code === code && !error.message.includes('secret'))
    assert.equal(resolved, false)
  }
})

test('forced modes never probe the other route and public DNS cannot return a hosts-like LAN result', async () => {
  const probed = []
  const deps = { resolvePublic: async () => ['192.168.2.4', '127.0.0.1'], probe: async (_, ip) => { probed.push(ip); return 'v1' } }
  await assert.rejects(selectConnectionRoute('https://drive.example', { mode: 'public' }, undefined, deps), error => error.code === 'server_dns')
  assert.deepEqual(probed, [])
  await selectConnectionRoute('https://drive.example', { mode: 'lan', lan_ip: '192.168.2.4', public_ip: '8.8.8.8' }, undefined, deps)
  assert.deepEqual(probed, ['192.168.2.4'])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(selectConnectionRoute('https://drive.example', { mode: 'public' }, abort.signal, deps), error => error.code === 'server_canceled')
  assert.deepEqual(probed, ['192.168.2.4'])
})
