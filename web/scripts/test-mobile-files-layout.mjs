import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const stateSrc = readFileSync(resolve(here, '../src/mobileFilesState.ts'), 'utf8')
const compiled = ts.transpileModule(stateSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'Mobile Files geometry must transpile')
const mod = { exports: {} }
const mockRequire = name => {
  if (name.endsWith('/FileExplorerVirtualSurface')) return {
    xDriveFileExplorerDetailsVirtualWindow: () => assert.fail('No virtual reads during geometry checks'),
  }
  throw Error('Unexpected module import: ' + name)
}
new Function('require', 'module', 'exports', compiled.outputText)(mockRequire, mod, mod.exports)
const geometry = mod.exports

assert.equal(geometry.MOBILE_FILES_ROW_HEIGHT, 68, 'list virtual-row size stays stable')
assert.equal(geometry.MOBILE_FILES_GRID_ROW_HEIGHT, 150, 'grid virtual-row size stays stable')
assert.equal(geometry.MOBILE_FILES_ITEM_TEXT_GAP_PX, 12)
assert.equal(geometry.mobileFilesDirectoryRowTextInset(false), 96,
  'disclosure 44 + thumbnail 40 + visible text gap 12')
assert.equal(geometry.mobileFilesDirectoryRowTextInset(false, 1), 112)
assert.equal(geometry.mobileFilesDirectoryRowTextInset(false, 4), 160)
assert.equal(geometry.mobileFilesDirectoryRowTextInset(false, 20), 160,
  'deep nesting is capped consistently with the actual visual indent')
assert.equal(geometry.mobileFilesDirectoryRowTextInset(false, -1), 96)
assert.equal(geometry.mobileFilesDirectoryRowTextInset(true), 120,
  'selection checkbox uses its own gutter instead of the disclosure slot')
assert.equal(geometry.mobileFilesDirectoryRowTextInset(true, 2), 152)
assert.equal(geometry.mobileFilesRowTextInset(false), 84,
  'Browse Home / Recent / Favorites keep their 28 + 44 + 12 geometry')
assert.equal(geometry.mobileFilesRowTextInset(true), 120)

const files = readFileSync(resolve(here, '../src/MobileFiles.tsx'), 'utf8')
const nav = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
const html = readFileSync(resolve(here, '../index.html'), 'utf8')
const excerpt = (source, from, to) => {
  const start = source.indexOf(from)
  assert.notEqual(start, -1, 'Missing layout landmark ' + from)
  const end = source.indexOf(to, start)
  assert.notEqual(end, -1, 'Missing end landmark ' + to)
  return source.slice(start, end)
}
const directory = excerpt(files, 'left: mobileFilesDirectoryRowTextInset', 'const mobileRow = (')
assert.match(directory, /left: mobileFilesDirectoryRowTextInset\(selectionMode, depth\)/,
  'folder separators must track the actual text position')
assert.match(directory, /ml: !effectiveGrid && !selectionMode \? \`\$\{MOBILE_FILES_ITEM_TEXT_GAP_PX\}px\` : undefined/,
  'ordinary list icon and title must be spaced separately from disclosure')
assert.match(directory, /rowGap: '3px'/, 'name and metadata use a consistent 3px gap')
const collection = excerpt(files, 'const mobileRow = (', 'const editableHomeRow = (')
assert.match(collection, /left: mobileFilesRowTextInset\(false\)/,
  'Recent / Favorites / Browse Home separators retain their own geometry')
assert.match(collection, /gap: 1\.5/, 'collection thumbnails retain the 12px visible gap')
assert.match(collection, /rowGap: '3px'/, 'collection metadata matches directory spacing')

const top = excerpt(files, 'data-mobile-files-navigation-bar', 'data-xdrive-mobile-files-scroll')
assert.match(top, /px: 2, flexShrink: 0, minHeight: 52/,
  'local title bar is 52px with 16px gutters')
assert.match(top, /width: 44, height: 44/, 'local navigation targets remain tappable')
const search = excerpt(files, 'data-mobile-files-search-region', 'data-xdrive-mobile-files-home')
assert.match(search, /px: 2, py: 0\.75/, 'search has 16px gutters and 6px vertical padding')
assert.match(search, /<Stack direction="row" spacing={1}/, 'search/filter gap is 8px')
assert.match(search, /minWidth: 44, minHeight: 44/, 'filter action has a 44px hit area')
const localBar = excerpt(files, 'data-xdrive-mobile-selection-toolbar', 'data-mobile-files-location-menu')
assert.doesNotMatch(localBar, /safe-area-inset-bottom/,
  'Files category and selection bars leave the system inset to global navigation')
assert.match(localBar, /mb: 1/, 'category pill has 8px separation from global navigation')
assert.match(localBar, /px: 0\.75, py: 0\.25/, 'category pill is approximately 50px tall')
assert.match(localBar, /minHeight: 44, gap: 0\.25/, 'category buttons meet minimum touch area')
assert.match(localBar, /minHeight: 44, flex: 1/, 'selection buttons meet minimum touch area')

const globalBar = excerpt(nav, 'data-xdrive-mobile-five-slot', 'BottomNavigationAction value="all"')
assert.match(globalBar, /pb: 'env\(safe-area-inset-bottom\)'/,
  'global five-slot bar alone owns the Home Indicator inset')
assert.match(globalBar, /height: 56/, 'five-slot navigation content is 56px')
assert.match(globalBar, /minHeight: 56/, 'all five taps retain a 56px target')
assert.match(globalBar, /height: 44/, 'landscape compact controls remain present')
assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover"/,
  'iOS Safari/PWA exposes safe-area insets instead of masking Home Indicator')
console.log('Mobile Files layout: row geometry, title/search spacing, stacked docks and safe areas passed')
