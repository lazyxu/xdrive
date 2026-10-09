#!/usr/bin/env node
// Optional real-App Public Share and login acceptance. Build web/dist first. The local
// server owns explicit API fixtures and attachment bytes; no production service
// is contacted, and native attachments are not synthesized by route.fulfill.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument: ${argument}`);
  options[match[1]] = match[2];
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON, downloads and screenshots.');
const sourceRoot = path.resolve(options['source-root'] || path.resolve(__dirname, '../..'));
const outputDir = path.resolve(options['output-dir']);
const distRoot = path.join(sourceRoot, 'web/dist');
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright');
const filename = '移动验收报告.txt';
const payload = Buffer.from('xDrive native Public Share acceptance\n');
const fixtures = new Map();
const tickets = new Map();
const result = { sourceRoot, distRoot, startedAt: new Date().toISOString(), checks: [], samples: {}, requests: [], downloads: [], unknownRequests: [], pageErrors: [], consoleErrors: [], failures: [] };
let browser;
let page;
let currentCase = 'startup';

function check(name, passed, evidence) {
  result.checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
}
async function settle() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function waitUntil(predicate, label) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert(Date.now() < deadline, label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function sendJSON(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function requestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    assert(body.length <= 4096, 'Fixture body exceeded its bound');
  }
  return JSON.parse(body || '{}');
}
const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const key = `${request.method} ${url.pathname}`;
  try {
    if (!url.pathname.startsWith('/api/')) {
      const file = path.resolve(distRoot, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
      if (request.method === 'GET' && file.startsWith(`${distRoot}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(fs.readFileSync(file));
        return;
      }
      throw new Error(`Unknown static request ${key}`);
    }
    const entry = { case: currentCase, key, query: url.search };
    result.requests.push(entry);
    if (key === 'GET /api/v1/version' && !url.search) return sendJSON(response, 200, { version: 'public-share-browser-fixture', channel: 'master' });
    const fixture = fixtures.get(request.headers['x-xdrive-share-token']);
    if (key === 'GET /api/v1/public/share' && !url.search && fixture) {
      return sendJSON(response, 200, { name: filename, size: payload.length, requires_password: true, max_downloads: 1, download_count: fixture.issued });
    }
    if (key === 'POST /api/v1/public/share/download-ticket' && !url.search && fixture) {
      const body = await requestBody(request);
      assert.deepEqual(Object.keys(body), ['password']);
      assert.equal(typeof body.password, 'string');
      entry.body = body;
      fixture.posts += 1;
      if (fixture.hold) await new Promise((resolve) => fixture.pending.push(resolve));
      fixture.responses += 1;
      if (body.password !== 'qa-password') {
        entry.status = 401;
        return sendJSON(response, 401, { error: 'invalid share password' });
      }
      if (fixture.issued >= 1) {
        entry.status = 410;
        return sendJSON(response, 410, { error: 'share exhausted' });
      }
      fixture.issued += 1;
      const id = tickets.size + 1;
      const ticketURL = `/api/v1/public-share-download/${id}?ticket=local-${id}`;
      tickets.set(ticketURL, fixture.name);
      entry.status = 200;
      return sendJSON(response, 200, { url: ticketURL, expires_at: '2099-01-01T00:00:00Z' });
    }
    if (request.method === 'GET' && tickets.has(`${url.pathname}${url.search}`)) {
      entry.status = 200;
      entry.bytes = payload.length;
      entry.fetchDestination = request.headers['sec-fetch-dest'];
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': payload.length,
        'Content-Disposition': `attachment; filename="mobile-acceptance.txt"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
      });
      response.end(payload);
      return;
    }
    throw new Error(`Unrecognised API fixture ${key}${url.search}`);
  } catch (error) {
    result.unknownRequests.push({ case: currentCase, request: key, message: error.message });
    sendJSON(response, 501, { error: error.message });
  }
});

async function snapshot(name) {
  await settle();
  const sample = await page.evaluate(() => {
    const bounds = (element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      inputs: [...document.querySelectorAll('input')].map((element) => ({ placeholder: element.placeholder, label: [...(element.labels || [])].map((label) => label.textContent).join(' '), ...bounds(element) })),
      buttons: [...document.querySelectorAll('button')].filter((element) => element.getClientRects().length).map((element) => ({ label: element.textContent, disabled: element.disabled, ...bounds(element) })),
    };
  });
  result.samples[name] = sample;
  check(`${name}: requested CSS width without horizontal overflow`, sample.viewport.width === page.viewportSize().width && sample.document.width <= sample.viewport.width + 1, sample);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
}
const ticketCount = () => page.evaluate(() => window.__xdrivePublicShareQaFetches.filter((entry) => entry.method === 'POST' && entry.path === '/api/v1/public/share/download-ticket').length);
async function saveDownload(download, name) {
  const target = path.join(outputDir, `${name}.txt`);
  await download.saveAs(target);
  const downloaded = fs.readFileSync(target);
  const evidence = { case: currentCase, url: download.url(), suggestedFilename: download.suggestedFilename(), failure: await download.failure(), bytes: downloaded.length, payloadMatches: downloaded.equals(payload) };
  result.downloads.push(evidence);
  check(`${name}: native browser receives the exact named attachment`, new URL(evidence.url).pathname.startsWith('/api/v1/public-share-download/') && evidence.suggestedFilename === filename && evidence.failure === null && evidence.payloadMatches, evidence);
}
async function startCase(name, origin, hold = false) {
  currentCase = name;
  const fixture = { name, issued: 0, posts: 0, responses: 0, hold, pending: [] };
  fixtures.set(`qa-${name}`, fixture);
  // Separate processes also support portable Chromium's single-process mode.
  const args = process.env.XDRIVE_BROWSER_ARGS ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined;
  if (args) assert(Array.isArray(args) && args.every((argument) => typeof argument === 'string'), 'XDRIVE_BROWSER_ARGS must be a JSON string array');
  browser = await chromium.launch({ headless: true, executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined, args,
    env: process.env.XDRIVE_BROWSER_FONTCONFIG ? { ...process.env, FONTCONFIG_PATH: process.env.XDRIVE_BROWSER_FONTCONFIG } : process.env });
  result.browserVersion = browser.version();
  const touch = name !== 'login-fine';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true, serviceWorkers: 'block' });
  await context.addInitScript(({ origin }) => {
    if (location.origin !== origin) return;
    window.__xdrivePublicShareQaFetches = [];
    const fetch = window.fetch;
    window.fetch = function (input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      window.__xdrivePublicShareQaFetches.push({ path: url.pathname, method: init?.method || input.method || 'GET' });
      return fetch.apply(this, arguments);
    };
  }, { origin });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    result.unknownRequests.push({ case: name, request: route.request().url(), message: 'Unexpected external network request' });
    await route.fulfill({ status: 501, body: 'Unexpected external request' });
  });
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => result.pageErrors.push({ case: name, message: error.message }));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push({ case: name, message: message.text() }); });
  await page.goto(name.startsWith('login-') ? origin : `${origin}/#/s/qa-${name}`, { waitUntil: 'domcontentloaded' });
  await (name.startsWith('login-') ? page.locator('#web-login-password') : page.getByPlaceholder('分享密码')).waitFor();
  return fixture;
}

async function submissionCase(origin) {
  const fixture = await startCase('submission', origin);
  const password = page.getByPlaceholder('分享密码');
  const button = page.getByRole('button', { name: '下载', exact: true });
  check('password has an accessible label', await page.getByLabel('分享密码', { exact: true }).count() === 1);
  for (const viewport of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await snapshot(`share-${viewport.width}x${viewport.height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  check('empty password disables Download', await button.isDisabled());
  const beforeEmpty = await ticketCount();
  await password.press('Enter');
  await settle();
  const emptyPosts = await ticketCount() - beforeEmpty;
  check('empty-password Enter cannot request a download ticket', emptyPosts === 0, { extraTicketRequests: emptyPosts });
  if (emptyPosts) await page.getByText('分享密码错误。', { exact: true }).waitFor();
  await snapshot('share-after-empty-enter');

  await password.fill('wrong-password');
  const beforeWrong = await ticketCount();
  await password.press('Enter');
  await page.getByText('分享密码错误。', { exact: true }).waitFor();
  await settle();
  check('eligible Enter submits once and displays password error', await ticketCount() === beforeWrong + 1 && await button.isEnabled());
  await password.fill('qa-password');
  const beforeSuccess = await ticketCount();
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  await saveDownload(await downloadPromise, 'share-native-download');
  await page.getByText('已交给浏览器下载。', { exact: true }).waitFor();
  await page.getByText('此分享已达到下载上限。', { exact: true }).waitFor();
  check('corrected password recovers through one button submission', await ticketCount() === beforeSuccess + 1 && !await page.getByText('分享密码错误。', { exact: true }).isVisible());
  check('native handoff does not fetch payload bytes into the page', await page.evaluate(() => !window.__xdrivePublicShareQaFetches.some((entry) => entry.path.startsWith('/api/v1/public-share-download/'))));
  check('handoff notice does not claim page-owned 100 percent completion', !await page.getByText(/100\s*%/).isVisible() && await page.getByRole('progressbar').count() === 0);
  check('one successful ticket exhausts this one-download share', fixture.issued === 1 && await button.isDisabled());
  await snapshot('share-exhausted');
  const beforeExhausted = await ticketCount();
  await password.press('Enter');
  await settle();
  const exhaustedPosts = await ticketCount() - beforeExhausted;
  check('exhausted-share Enter cannot request another ticket', exhaustedPosts === 0, { extraTicketRequests: exhaustedPosts });
  if (exhaustedPosts) await page.getByText('此分享已过期、达到下载上限或已被撤销。', { exact: true }).waitFor();
  await snapshot('share-after-exhausted-enter');
  await browser.close();
  browser = undefined;
}

async function pendingCase(origin) {
  const fixture = await startCase('pending', origin, true);
  const password = page.getByPlaceholder('分享密码');
  await password.fill('qa-password');
  const downloadPromise = page.waitForEvent('download');
  await password.press('Enter');
  await page.getByRole('button', { name: /正在下载/ }).waitFor();
  await waitUntil(() => fixture.posts === 1, 'Initial ticket request never reached the fixture');
  check('pending request disables Download', await page.getByRole('button', { name: /正在下载/ }).isDisabled());
  await password.press('Enter');
  await settle();
  const posts = await ticketCount();
  check('pending-request Enter cannot submit a second ticket', posts === 1, { ticketRequests: posts });
  await snapshot('share-ticket-pending');
  fixture.hold = false;
  for (const release of fixture.pending.splice(0)) release();
  await saveDownload(await downloadPromise, 'share-pending-native-download');
  await waitUntil(() => fixture.responses >= posts, 'Pending fixture responses did not settle');
  await page.getByText('已交给浏览器下载。', { exact: true }).waitFor();
  check('released request hands off one valid ticket', fixture.issued === 1);
  await snapshot('share-pending-released');
  await browser.close();
  browser = undefined;
}

async function loginCase(origin, touch) {
  const name = touch ? 'login-touch' : 'login-fine';
  await startCase(name, origin);
  const password = page.locator('#web-login-password');
  await page.locator('#web-login-username').fill('qa-user');
  await password.fill('qa-password');
  check(`${name}: primary pointer matches fixture`, await page.evaluate(() => matchMedia('(pointer: coarse)').matches) === touch);
  for (const viewport of touch ? [{ width: 390, height: 844 }, { width: 900, height: 700 }] : [{ width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await snapshot(`${name}-${viewport.width}`);
    const compact = touch && viewport.width < 900;
    const eye = await page.getByRole('button', { name: '显示密码', exact: true }).boundingBox();
    const submit = await page.getByRole('button', { name: '登录', exact: true }).boundingBox();
    check(`${name}-${viewport.width}: password visibility target`, Boolean(eye) && (compact ? eye.width >= 44 && eye.height >= 44 : Math.abs(eye.width - 30) < 1 && Math.abs(eye.height - 30) < 1), eye);
    check(`${name}-${viewport.width}: submit target`, Boolean(submit) && (compact ? submit.height >= 44 : Math.abs(submit.height - 42) < 1), submit);
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    check(`${name}-${viewport.width}: show keeps password value`, await password.getAttribute('type') === 'text' && await password.inputValue() === 'qa-password');
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
    check(`${name}-${viewport.width}: hide keeps password value without submitting`, await password.getAttribute('type') === 'password' && await password.inputValue() === 'qa-password' && await page.evaluate(() => !window.__xdrivePublicShareQaFetches.some((entry) => entry.path === '/api/v1/auth/login')));
  }
  await browser.close();
  browser = undefined;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const html = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
  result.appEntry = html.match(/src="([^\"]+\.js)"/)?.[1];
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await submissionCase(origin);
    await pendingCase(origin);
    await loginCase(origin, true);
    await loginCase(origin, false);
    check('no unrecognised API or external requests', result.unknownRequests.length === 0, result.unknownRequests);
    check('no application page errors', result.pageErrors.length === 0, result.pageErrors);
    const unexpectedConsole = result.consoleErrors.filter((entry) => !/^Failed to load resource: the server responded with a status of (401|410) /.test(entry.message));
    check('no unexpected console errors', unexpectedConsole.length === 0, unexpectedConsole);
  } catch (error) {
    result.failures.push({ case: currentCase, message: error.message, stack: error.stack });
    if (page && !page.isClosed()) {
      result.failureAccessibility = await page.locator('body').ariaSnapshot().catch(() => 'unavailable');
      await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    result.finishedAt = new Date().toISOString();
    result.passed = result.failures.length === 0 && result.checks.every((entry) => entry.passed);
    fs.writeFileSync(path.join(outputDir, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, failedChecks: result.checks.filter((entry) => !entry.passed), failures: result.failures, unknownRequests: result.unknownRequests, outputDir }, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
