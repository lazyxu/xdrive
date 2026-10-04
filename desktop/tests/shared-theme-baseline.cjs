const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const theme = read('ui', 'shared', 'src', 'mui', 'theme.ts')
const webMain = read('web', 'src', 'main.tsx')
const desktopMain = read('desktop', 'src', 'renderer', 'main.tsx')
const webStyles = read('web', 'src', 'styles.css')
const desktopStyles = read('desktop', 'src', 'renderer', 'styles.css')

test('shared MUI CssBaseline owns global xDrive visual tokens', () => {
  for (const token of [
    'MuiCssBaseline',
    "pageBg: '#f4f6fa'",
    "pageBg: '#0f141d'",
    "'--page-bg': tokens.pageBg",
    "'--surface': tokens.surface",
    "'--border': tokens.border",
    "'--text': tokens.text",
    "'--primary': tokens.primary",
    "'--danger-bg': tokens.dangerBg",
    "'--success-bg': tokens.successBg",
    "'--warning-bg': tokens.warningBg",
    "'--info-bg': tokens.infoBg",
    'colorScheme: mode',
    "fontSynthesis: 'none'",
    "textRendering: 'optimizeLegibility'",
    'backgroundColor: tokens.pageBg',
    'color: tokens.text',
  ]) {
    assert.ok(theme.includes(token), `shared CssBaseline missing: ${token}`)
  }
})

test('Web keeps only platform and feature CSS outside the shared baseline', () => {
  assert.equal(/^:root\s*\{/m.test(webStyles), false, 'Web must not keep a local root palette block')
  assert.equal(/^:root\[data-xdrive-theme='dark'\]\s*\{/m.test(webStyles), false, 'Web must not keep a local dark root palette block')
  assert.equal(webStyles.includes('* { box-sizing: border-box; }'), false, 'Web box sizing must come from CssBaseline')
  assert.ok(webStyles.includes('body { min-width: 320px; min-height: 100vh; }'), 'Web responsive minimums remain platform-local')
  assert.ok(webStyles.includes(":root[data-xdrive-theme='dark'] .external-source-subtitle"), 'feature-specific dark styling should remain local')
})

test('Desktop keeps window constraints local but consumes shared root tokens', () => {
  assert.equal(/^:root\s*\{/m.test(desktopStyles), false, 'Desktop must not keep a local root palette block')
  assert.equal(desktopStyles.includes('@media (prefers-color-scheme: dark)'), false, 'Desktop theme mode must not be duplicated in CSS')
  assert.equal(desktopStyles.includes(":root[data-xdrive-theme='light']"), false, 'Desktop light tokens must come from shared theme')
  assert.equal(desktopStyles.includes(":root[data-xdrive-theme='dark']"), false, 'Desktop dark tokens must come from shared theme')
  assert.equal(desktopStyles.includes('* { box-sizing: border-box; }'), false, 'Desktop box sizing must come from CssBaseline')
  assert.ok(desktopStyles.includes('html, body, #root { width: 100%; height: 100%; overflow: hidden; }'), 'Electron root sizing remains Desktop-local')
  assert.ok(desktopStyles.includes('body { min-width: 760px; min-height: 520px; }'), 'Desktop window minimums remain local')
  assert.ok(desktopStyles.includes('background: var(--page-bg)'), 'Desktop business chrome should continue consuming shared CSS variables')
})

test('appearance roots keep semantic mode metadata without inline color-scheme ownership', () => {
  for (const source of [webMain, desktopMain]) {
    assert.ok(source.includes('document.documentElement.dataset.xdriveTheme = resolvedMode'))
    assert.equal(source.includes('document.documentElement.style.colorScheme = resolvedMode'), false)
    assert.ok(source.includes('<CssBaseline />'))
    assert.ok(source.includes('createXDriveMuiTheme(resolvedMode)'))
  }
})
