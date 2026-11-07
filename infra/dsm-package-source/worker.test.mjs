import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateCatalog, loadCatalog } from './worker.mjs';

const commit = 'a'.repeat(40);
const version = '0.1.0-9000';
const releaseUrl = 'https://github.com/lazyxu/xdrive/releases/download/';
const manifest = (channel = 'stable') => ({
  schema: 1, channel, package: 'xdrivenas', arch: 'armada38x',
  commit, version, sha256: 'b'.repeat(64), md5: 'c'.repeat(32),
  size: 7340032, os_min_ver: '7.0-40759',
  link: releaseUrl + 'dsm-' + channel + '-' + commit +
    '/xdrivenas-armada38x-' + version + '.spk',
});

function request(path, params = { arch: 'armada38x', build: '64570', major: '7', language: 'enu' },
                 method = 'POST') {
  const data = new URLSearchParams(params);
  return new Request('https://xdrive-dsm.example.workers.dev' + path +
    (method === 'GET' ? '?' + data : ''), method === 'POST'
      ? { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() }
      : { method });
}

async function withFetch(fake, action) {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await action(); } finally { globalThis.fetch = oldFetch; }
}

const successful = channel => async (url, options) => {
  assert.equal(url, releaseUrl + 'dsm-' + channel + '-feed/catalog.json');
  assert.equal(options.redirect, 'follow');
  return new Response(JSON.stringify(manifest(channel)), { status: 200 });
};

test('synology-compatible catalog for POST, with pinned immutable SPK', async () => {
  await withFetch(successful('stable'), async () => {
    const res = await worker.fetch(request('/nas/'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.equal(data.packages.length, 1);
    assert.deepEqual({
      package: data.packages[0].package,
      version: data.packages[0].version,
      link: data.packages[0].link,
      md5: data.packages[0].md5,
      size: data.packages[0].size,
      qinst: data.packages[0].qinst,
      qupgrade: data.packages[0].qupgrade,
    }, {
      package: 'xdrivenas', version, link: manifest().link,
      md5: 'c'.repeat(32), size: 7340032,
      qinst: true, qupgrade: true,
    });
  });
});

test('edge channel is opt-in and independent from stable', async () => {
  await withFetch(successful('edge'), async () => {
    const res = await worker.fetch(request('/edge/nas', {}, 'GET'));
    assert.equal(res.status, 400);
    const valid = await worker.fetch(request('/edge/nas', {
      arch: 'armada38x', build: '64570', major: '7', language: 'enu',
    }, 'GET'));
    assert.equal((await valid.json()).packages[0].link, manifest('edge').link);
  });
});

test('wrong arch/DSM/firmware return empty catalog without upstream fetch', async () => {
  await withFetch(async () => { throw new Error('must not fetch'); }, async () => {
    for (const args of [
      { arch: 'x86_64', build: '64570', major: '7', language: 'enu' },
      { arch: 'armada38x', build: '64570', major: '6', language: 'enu' },
      { arch: 'armada38x', build: '40000', major: '7', language: 'enu' },
    ]) {
      const res = await worker.fetch(request('/nas', args));
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).packages, []);
    }
  });
});

test('missing stable feed returns no packages; malformed feed fails closed', async () => {
  await withFetch(async () => new Response('not found', { status: 404 }), async () => {
    const r = await worker.fetch(request('/nas'));
    assert.deepEqual((await r.json()).packages, []);
  });
  for (const broken of [
    { ...manifest(), link: 'https://evil.example/bad.spk' },
    { ...manifest(), arch: 'x86_64' },
    { ...manifest(), size: 0 },
    { ...manifest(), version: '0.1.0-1', link: manifest().link },
    { ...manifest(), sha256: 'broken' },
  ]) {
    await withFetch(async () => new Response(JSON.stringify(broken)), async () => {
      const r = await worker.fetch(request('/nas'));
      assert.equal(r.status, 503);
      assert.deepEqual(await r.json(), { error: 'package catalog unavailable' });
    });
  }
});

test('malformed form, oversized data, upstream failure and non-DSM paths rejected', async () => {
  await withFetch(async () => new Response('bad', { status: 502 }), async () => {
    assert.equal((await worker.fetch(request('/nas'))).status, 503);
    assert.equal((await worker.fetch(request('/edge/not-nas'))).status, 404);
    assert.equal((await worker.fetch(request('/nas', { arch: 'armada38x', build: 'x', language: 'enu' }))).status, 422);
    const bad = new Request('https://xdrive-dsm.example.workers.dev/nas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal((await worker.fetch(bad)).status, 400);
    const tooLarge = new Request('https://xdrive-dsm.example.workers.dev/nas', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a'.repeat(10000),
    });
    assert.equal((await worker.fetch(tooLarge)).status, 400);
  });
});

test('static health and root page do not depend on GitHub', async () => {
  const res = await worker.fetch(new Request('https://xdrive-dsm.example.workers.dev/stable/healthz'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const page = await worker.fetch(new Request('https://xdrive-dsm.example.workers.dev/edge'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Package Sources/);
});

test('validates immutable catalog shape independently of transport', () => {
  assert.deepEqual(validateCatalog(manifest(), 'stable'), manifest());
  assert.throws(() => validateCatalog(manifest('edge'), 'stable'));
  assert.throws(() => validateCatalog({ ...manifest(), commit: 'short' }, 'stable'));
});

test('read-only feed loader follows only fixed HTTPS release URL', async () => {
  const answer = await loadCatalog('stable', successful('stable'));
  assert.deepEqual(answer, manifest());
  await assert.rejects(loadCatalog('test', async () => { throw new Error('should not fetch'); }));
});
