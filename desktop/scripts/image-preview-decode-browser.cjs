#!/usr/bin/env node
// Optional real-browser regression. Requires installed desktop dependencies and
// Playwright with Chromium. Use --source-root to compare another checkout/export.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '../..');
const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--(source-root|output-dir)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument: ${argument}. Use --source-root=/path and --output-dir=/path.`);
  options[match[1]] = match[2];
}
if (!options['output-dir']) throw new Error('Supply --output-dir=/path for JSON, bundle, and screenshots.');
const sourceRoot = path.resolve(options['source-root'] || repoRoot);
const outputDir = path.resolve(options['output-dir']);
const playwrightModule = process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightModule);
const fixtures = {
  '/thumb.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAIAAAABc2X6AAAAc0lEQVR4nO3PgQ0AEADAMPz/M1+Q1HrBNvf4y3odcFvDuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNewrmFdw7qGdQ3rGtY1rGtY17CuYV3DuoZ1Desa1jWsa1jXsK5hXcO6hnUN6xrWNaxrWNew7gDdvwGf2GYUOgAAAABJRU5ErkJggg==', 'base64'),
  '/original.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAIAAAAP3aGbAAAFMklEQVR4nO3UQQ0AIBDAsAP/nsECP7KkVbDX1swZgIL9OwDglWEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZFzHygQfYywm8AAAAABJRU5ErkJggg==', 'base64'),
};

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const bundlePath = path.join(outputDir, 'bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'image-preview-decode-browser.tsx')],
    bundle: true,
    outfile: bundlePath,
    jsx: 'automatic',
    nodePaths: [path.join(repoRoot, 'desktop/node_modules')],
    alias: {
      __SURFACE__: path.join(sourceRoot, 'ui/shared/src/mui/FilePreviewSurface.tsx'),
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const requests = {};
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests[request.url] = (requests[request.url] || 0) + 1;
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>');
    } else if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(fs.readFileSync(bundlePath));
    } else if (fixtures[url.pathname]) {
      response.setHeader('Content-Type', 'image/png');
      response.end(fixtures[url.pathname]);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  let browser;
  const results = { sourceRoot, checks: {}, samples: {}, errors: [] };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const args = process.env.XDRIVE_BROWSER_ARGS
      ? JSON.parse(process.env.XDRIVE_BROWSER_ARGS) : undefined;
    if (args && (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))) {
      throw new Error('XDRIVE_BROWSER_ARGS must be a JSON array of strings.');
    }
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.XDRIVE_BROWSER_EXECUTABLE || undefined,
      args,
      env: process.env.XDRIVE_BROWSER_FONTCONFIG
        ? { ...process.env, FONTCONFIG_PATH: process.env.XDRIVE_BROWSER_FONTCONFIG }
        : process.env,
    });
    results.browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    page.on('pageerror', (error) => results.errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.previewHarness?.open === 'function');
    // A bounded settle interval lets browser load/onLoad effects and painting run.
    // These intervals are not measurements of application performance.
    const wait = () => page.waitForTimeout(200);
    const sample = async (name) => {
      const state = await page.evaluate(() => ({
        images: [...document.querySelectorAll('img')].map((image) => {
          let visible = true;
          for (let element = image; element; element = element.parentElement) {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) visible = false;
          }
          return {
            src: image.getAttribute('src'), visible, complete: image.complete,
            width: image.naturalWidth, rect: image.getBoundingClientRect().toJSON(),
          };
        }),
        glyphs: document.querySelectorAll('[data-xdrive-live-photo-glyph]').length,
        canvases: [...document.querySelectorAll('canvas')].map((canvas) => ({
          width: canvas.width, height: canvas.height,
          pixel: [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data],
        })),
        events: window.previewHarness.events,
      }));
      results.samples[name] = state;
      await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
      return state;
    };
    const control = async (action, ...args) => {
      await page.evaluate(({ action, args }) => window.previewHarness[action](...args), { action, args });
      await wait();
    };
    const visibleImage = (state, src, width) => state.images.some((image) =>
      image.src.includes(src) && image.visible && image.complete && image.width === width);
    const canvasColor = (state, width, red, blue) => state.canvases.some((canvas) =>
      canvas.width === width && canvas.pixel[0] === red && canvas.pixel[2] === blue);

    // Ticket delay and decode delay are independent gates.
    await control('open', 'a');
    let state = await sample('slow-ticket');
    results.checks.thumbnailBeforeTicket = visibleImage(state, 'thumb.png?id=a', 80);
    await control('releaseTicket', 'a');
    state = await sample('decode-held');
    results.checks.thumbnailWhileDecodeHeld = visibleImage(state, 'thumb.png?id=a', 80);
    results.checks.originalHiddenUntilDecoded = !state.images.some((image) =>
      image.src.includes('original.png?id=a') && image.visible);
    results.checks.decodeInvokedOnRenderedOriginal = state.events.some((event) =>
      event.kind === 'decode-ready' && event.id === 'a' && event.connected);
    await control('releaseDecode', 'a');
    state = await sample('decoded');
    results.checks.originalAfterDecode = visibleImage(state, 'original.png?id=a', 400);
    results.checks.originalSingleRequest = requests['/original.png?id=a'] === 1;

    // Late work must not restore a replaced or closed preview.
    await control('open', 'b');
    await control('releaseTicket', 'b');
    await control('open', 'c');
    await control('releaseDecode', 'b');
    state = await sample('replacement');
    results.checks.staleDecodeCannotReplaceTarget = !state.images.some((image) => image.src.includes('id=b'));
    await control('releaseTicket', 'c');
    await control('close');
    await control('releaseDecode', 'c');
    state = await sample('closed');
    results.checks.closedDecodeCannotRestoreImage = state.images.length === 0;
    await control('open', 'd');
    await control('close');
    await control('releaseTicket', 'd');
    state = await sample('late-ticket');
    results.checks.closedTicketCannotRestoreImage = state.images.length === 0;

    // The canvas consumes the already-decoded image without a second fetch.
    await control('open', 'e', true);
    state = await sample('transformed-thumb');
    results.checks.transformedThumbnailPaints = canvasColor(state, 80, 255, 0);
    await control('releaseTicket', 'e');
    state = await sample('transformed-held');
    results.checks.transformedThumbnailWhileDecodeHeld = canvasColor(state, 80, 255, 0);
    await control('releaseDecode', 'e');
    state = await sample('transformed-decoded');
    results.checks.transformedOriginalPaints = canvasColor(state, 400, 0, 255);
    results.checks.transformedOriginalSingleRequest = requests['/original.png?id=e'] === 1;
    results.checks.transformedThumbnailSingleRequest = requests['/thumb.png?id=e'] === 1;

    // The Live Photo wrapper stays mounted and its glyph requires a real still.
    await control('open', 'live');
    state = await sample('live-before-still');
    results.checks.liveGlyphAbsentBeforeStill = state.glyphs === 0;
    await control('releaseThumb', 'live');
    state = await sample('live-thumb');
    results.checks.liveThumbnailAndGlyph = state.glyphs === 1 && visibleImage(state, 'thumb.png?id=live', 80);
    await page.evaluate(() => {
      const harness = window.previewHarness;
      harness.liveThumbNode = document.querySelector('img[src*="thumb.png?id=live"]');
      harness.liveWrapperNode = document.querySelector('[data-xdrive-live-photo-glyph]')?.closest('[role="button"]');
    });
    await control('releaseTicket', 'live');
    state = await sample('live-held');
    results.checks.liveThumbnailWhileDecodeHeld = visibleImage(state, 'thumb.png?id=live', 80);
    await control('releaseDecode', 'live');
    state = await sample('live-decoded');
    results.checks.liveOriginalAfterDecode = visibleImage(state, 'original.png?id=live', 400);
    results.checks.liveNodesRemainMounted = await page.evaluate(() => Boolean(
      window.previewHarness.liveThumbNode?.isConnected && window.previewHarness.liveWrapperNode?.isConnected));
    results.checks.liveOriginalSingleRequest = requests['/original.png?id=live'] === 1;
    results.checks.liveThumbnailSingleRequest = requests['/thumb.png?id=live'] === 1;

    results.requests = requests;
    results.passed = Object.values(results.checks).every(Boolean) && results.errors.length === 0;
    if (!results.passed) process.exitCode = 1;
  } catch (error) {
    results.errors.push(error.stack || String(error));
    results.requests = requests;
    results.passed = false;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({
      sourceRoot, outputDir, checks: results.checks, requests,
      errors: results.errors, passed: results.passed,
    }, null, 2));
    try {
      if (browser) await browser.close();
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
