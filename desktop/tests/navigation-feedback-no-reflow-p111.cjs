'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const mobile = read('web/src/MobileFiles.tsx')
const ast = ts.createSourceFile('MediaGallery.tsx', gallery, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

function attr(node, marker) {
  return node?.attributes?.properties?.find(a =>
    ts.isJsxAttribute(a) && a.name.getText(ast) === marker) ?? null
}
function tagged(marker) {
  const found = []
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        attr(node, marker)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, marker + ' must have exactly one real JSX owner')
  return found[0]
}
function inside(node, marker) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && attr(p.openingElement, marker)) return true
  }
  return false
}
test('P111: Mobile Browse Home async errors live in the existing P109 zero-flow overlay', () => {
  const start = mobile.indexOf('<Box data-xdrive-mobile-files-home')
  const end = mobile.indexOf('data-mobile-files-arrangement-status', start)
  assert.ok(start >= 0 && end > start)
  assert.equal(mobile.slice(start, end).includes('data-mobile-files-organization-error'), false,
    'a late organization failure cannot insert a Browse Home scroll row')
  const owner = mobile.indexOf('<Box data-mobile-files-feedback-overlay')
  const footer = mobile.indexOf('{selectionActive ? (', owner)
  assert.ok(owner > end && footer > owner)
  const overlay = mobile.slice(owner, footer)
  for (const marker of [
    "position: 'absolute'", "pointerEvents: 'none'", "pointerEvents: 'auto'",
    'data-mobile-files-organization-error', 'props.organizationError',
    'props.onRetryOrganization', 'role="alert"',
  ]) assert.ok(overlay.includes(marker), marker)
  assert.equal(overlay.includes('flexShrink: 0'), false)
  assert.ok(mobile.includes('data-xdrive-file-explorer-scroll-host'))
})
test('P111: shared Gallery feedback never enters the virtual/photo wall or header flex flow', () => {
  const floating = tagged('data-xdrive-gallery-floating-feedback')
  const globals = [
    'data-xdrive-gallery-global-error',
    'data-xdrive-gallery-sync-folders-error',
    'data-xdrive-gallery-day-jump-feedback',
  ]
  for (const marker of globals) {
    const node = tagged(marker)
    assert.ok(inside(node, 'data-xdrive-gallery-floating-feedback'), marker)
    assert.equal(inside(node, 'data-xdrive-gallery-toolbar'), false)
    assert.equal(inside(node, 'data-xdrive-gallery-photo-wall'), false)
  }
  assert.match(floating.parent.getText(ast).slice(0, 1100), /position: 'fixed'/)
  assert.match(floating.parent.getText(ast).slice(0, 1300), /pointerEvents: 'none'/)
  assert.match(floating.parent.getText(ast), /safe-area-inset-bottom/)
  const index = tagged('data-xdrive-gallery-index-feedback')
  assert.ok(inside(index, 'data-xdrive-gallery-search-feedback'))
  assert.match(index.parent.getText(ast).slice(0, 1200), /position: 'absolute'/)
  assert.ok(inside(tagged('data-xdrive-gallery-index-status'), 'data-xdrive-gallery-index-feedback'))
  assert.ok(inside(tagged('data-xdrive-gallery-index-status-error'), 'data-xdrive-gallery-index-feedback'))
  const pages = tagged('data-xdrive-places-pagination-error')
  assert.ok(inside(pages, 'data-xdrive-places-pagination'))
  assert.match(pages.parent.getText(ast).slice(0, 700), /position: 'absolute'/)
  assert.match(pages.parent.getText(ast).slice(0, 900), /pointerEvents: 'none'/)
})
test('P111: real loading and failure actions remain; no invented navigation frame', () => {
  for (const marker of [
    'data-xdrive-gallery-photo-wall','data-xdrive-gallery-cold-pending',
    'data-xdrive-gallery-load-error','data-xdrive-gallery-index-status-request',
    'data-xdrive-gallery-index-status-error','data-xdrive-places-pagination-quiet-status',
    'data-xdrive-gallery-sync-folders-error','XDriveMediaGalleryCoverThumbnail',
    'data-xdrive-media-gallery-virtual-grid',
  ]) assert.ok(gallery.includes(marker), marker)
  assert.ok(mobile.includes('data-mobile-files-select-progress'))
  assert.ok(mobile.includes('cancelSelectAll'))
  assert.ok(mobile.includes('XDriveFileExplorerThumbnail'))
  const agents = read('AGENTS.md')
  assert.equal(agents.split('## P111 · Async feedback must never reflow Files/Gallery scroll owners').length, 2)
})
