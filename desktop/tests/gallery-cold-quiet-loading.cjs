const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
const chrome = fs.readFileSync(path.join(root, 'desktop/scripts/mobile-web-app-browser.cjs'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')

test('first unrequested Gallery Range is quiet rather than false empty or instant spinner', () => {
  for (const token of [
    'hasRequestedPhotoRange={collectionTarget !== null}',
    'loadingEpoch={requestID.current}',
    'hasRequestedPhotoRange = true',
    'const showDelayedColdPhotoLoad = loading && logicalItemCount === 0',
    'const coldPhotoLoadKey =',
    'setVisibleColdPhotoLoadKey(coldPhotoLoadKey), 300',
    'data-xdrive-gallery-cold-pending',
    '(!hasRequestedPhotoRange && logicalItemCount === 0)',
  ]) assert.ok(source.includes(token), 'cold first-Range boundary missing: ' + token)
  assert.ok(source.includes('(loading || !hasRequestedPhotoRange) && logicalItemCount === 0'),
    'unverified zero total must not advertise an authoritative count in Gallery subtitle')
  assert.ok(!source.includes(') : loading && logicalItemCount === 0 ? (\n          <Box sx={{ minHeight: 220'),
    'old eager spinner branch must not survive')
  assert.ok(source.includes('const keepAcceptedEmpty = hasRequestedPhotoRange &&'),
    'previous authorized empty collection is content; keep it during refresh')
  assert.ok(source.includes('!keepAcceptedEmpty && visibleColdPhotoLoadKey === coldPhotoLoadKey'),
    'old request progress must not leak into next collection generation')
})

test('Chrome P39 uses compiled Gallery, held authenticated Range0 and painted-frame assertions', () => {
  for (const token of [
    'async function galleryColdFirstRangeAcceptance()',
    'galleryColdFirstRangeGate={hits:0,notify,wait}',
    "await page.goto(origin+'/#/app/gallery',{waitUntil:'domcontentloaded'})",
    "await page.reload({waitUntil:'domcontentloaded'})",
    "url.searchParams.get('range') === 'true'",
    "url.searchParams.get('offset') === '0'",
    'window.__p39Frames.push(frame)',
    'early.frames.every(silent)',
    'settled.rows>0&&!settled.empty&&!settled.pending',
    'P39 every first real Gallery Range frame avoids false empty and fast spinner',
  ]) assert.ok(chrome.includes(token), token)
  assert.ok(workflow.includes('XDRIVE_GALLERY_COLD_P39:') &&
    workflow.includes("test/mobile-gallery-ios27-real-chrome-p39-"),
    'real Chrome acceptance must not be silently skipped')
  assert.ok(workflow.includes('--scenario=gallery-ios27-chrome'),
    'run source-exact built Web with existing Gallery fixture')
})
