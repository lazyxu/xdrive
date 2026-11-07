// DSM 7 Package Center-compatible, read-only Synology package source.
// Free Cloudflare Workers endpoint; package bytes stay on immutable GitHub Releases.
// A missing/invalid catalog NEVER becomes an advertisement for a new package.
const RELEASES = 'https://github.com/lazyxu/xdrive/releases/download/';
const NAME = 'xdrivenas';
const VERSION = /^0\.1\.0-([1-9][0-9]*)$/;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const LANG = /^[a-z]{3}$/;
const MAX_CATALOG = 8192;
const MIN_BUILD = 40759;
const CHANNELS = new Set(['stable', 'edge']);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function validateCatalog(value, channel) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== 1 || value.channel !== channel ||
      value.package !== NAME || value.arch !== 'armada38x' ||
      typeof value.commit !== 'string' || !SHA.test(value.commit) ||
      typeof value.version !== 'string' || !VERSION.test(value.version) ||
      typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) ||
      typeof value.md5 !== 'string' || !MD5.test(value.md5) ||
      !Number.isSafeInteger(value.size) || value.size < 1024 || value.size > 134217728 ||
      value.os_min_ver !== '7.0-40759') {
    throw new Error('Invalid published DSM catalog');
  }
  const expected = RELEASES + 'dsm-' + channel + '-' + value.commit +
    '/xdrivenas-armada38x-' + value.version + '.spk';
  if (value.link !== expected) {
    throw new Error('DSM catalog link is not pinned to its immutable release');
  }
  return value;
}

function entry(catalog) {
  return {
    package: NAME,
    version: catalog.version,
    dname: 'xDrive NAS Backup',
    desc: 'xDrive NAS backup agent for DSM 7, with authenticated local UI',
    link: catalog.link,
    md5: catalog.md5,
    size: catalog.size,
    thumbnail: [],
    snapshot: [],
    qinst: true,
    qupgrade: true,
    qstart: true,
    startable: 'yes',
    download_count: 0,
    recent_download_count: 0,
    maintainer: 'xDrive Project',
  };
}

export async function loadCatalog(channel, fetcher = fetch) {
  if (!CHANNELS.has(channel)) throw new Error('Invalid update channel');
  const url = RELEASES + 'dsm-' + channel + '-feed/catalog.json';
  const response = await fetcher(url, {
    redirect: 'follow',
    headers: { 'Accept': 'application/json', 'User-Agent': 'xdrive-dsm-feed/1' },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (response.status === 404) return null; // No stable release yet.
  if (!response.ok) throw new Error('DSM catalog fetch failed');
  const text = await response.text();
  if (text.length > MAX_CATALOG) throw new Error('DSM catalog too large');
  return validateCatalog(JSON.parse(text), channel);
}

function getChannel(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const channel = segments[0] === 'edge' ? 'edge' : 'stable';
  if (segments[0] === 'stable' || segments[0] === 'edge') segments.shift();
  return { channel, segments };
}

async function parseDevice(request) {
  const url = new URL(request.url);
  if (request.method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
    const text = await request.text();
    if (text.length > 8192) return null;
    return new URLSearchParams(text);
  }
  return url.searchParams;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { channel, segments } = getChannel(url.pathname);
    if (segments.length === 1 && segments[0] === 'healthz' && request.method === 'GET') {
      return json({ ok: true, service: 'xdrive-dsm-package-source', channel });
    }
    if (segments.length === 0 && request.method === 'GET') {
      return new Response('xDrive DSM package source (' + channel + '). Add this URL in DSM Package Center > Settings > Package Sources.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (segments.length !== 1 || segments[0] !== 'nas' ||
        (request.method !== 'GET' && request.method !== 'POST')) {
      return json({ error: 'not found' }, 404);
    }
    try {
      const args = await parseDevice(request);
      if (!args || !args.has('arch') || !args.has('build') || !args.has('language')) {
        return json({ error: 'missing or invalid device parameters' }, 400);
      }
      const buildText = args.get('build') || '';
      const language = args.get('language') || '';
      if (!/^[0-9]{4,6}$/.test(buildText) || !LANG.test(language)) {
        return json({ error: 'invalid firmware or language' }, 422);
      }
      const build = Number(buildText);
      const major = args.get('major');
      // Only the published DSM 7 ARMv7 target is eligible; never advertise an
      // incompatible SPK to a different NAS architecture or firmware.
      if (args.get('arch') !== 'armada38x' || build < MIN_BUILD ||
          (major !== null && major !== '7')) {
        return json({ packages: [] });
      }
      const catalog = await loadCatalog(channel);
      return json({ packages: catalog ? [entry(catalog)] : [] });
    } catch (_) {
      // Upstream transport/manifest problems are explicit 503s, not an empty
      // catalog that could make Package Center think a release was withdrawn.
      return json({ error: 'package catalog unavailable' }, 503);
    }
  },
};
