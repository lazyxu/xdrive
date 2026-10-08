const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const theme = read('ui', 'shared', 'src', 'mui', 'theme.ts')
const appearanceProvider = read('ui', 'shared', 'src', 'mui', 'AppearanceThemeProvider.tsx')
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
  const bodyStyles = webStyles.match(/^body\s*\{([^}]*)\}/m)?.[1] ?? ''
  assert.match(bodyStyles, /min-width:\s*320px\s*;/, 'Web responsive minimum width remains platform-local')
  assert.deepEqual(
    [...bodyStyles.matchAll(/\bmin-height:\s*([^;]+);/g)].map((match) => match[1].trim()),
    ['100vh', '100dvh'],
    'Web viewport minimum must preserve a vh fallback before the dynamic viewport value',
  )
  for (const selector of [
    '.external-source-list',
    '.external-source-card-header',
    '.external-source-card-meta',
    '.external-source-subtitle',
    '.external-source-time',
    '.external-source-stats',
    '.external-source-empty',
    '.external-source-actions',
  ]) {
    assert.equal(webStyles.includes(selector), false, `shared SourceManager styling must not remain Web-local: ${selector}`)
  }
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

test('shared appearance provider owns resolved mode, semantic metadata and MUI root composition', () => {
  for (const token of [
    'export function xDriveResolveAppearanceMode',
    'export function XDriveAppearanceThemeProvider',
    "useMediaQuery('(prefers-color-scheme: dark)'",
    'createXDriveMuiTheme(resolvedMode)',
    'document.documentElement.dataset.xdriveTheme = resolvedMode',
    '<ThemeProvider theme={theme}>',
    '<CssBaseline />',
  ]) {
    assert.ok(appearanceProvider.includes(token), `shared appearance provider missing: ${token}`)
  }

  assert.ok(webMain.includes('<XDriveAppearanceThemeProvider appearance={appearance}>'), 'Web must use the shared appearance provider')
  assert.ok(desktopMain.includes('<XDriveAppearanceThemeProvider appearance={appearance}>'), 'Desktop must use the shared appearance provider')
  for (const source of [webMain, desktopMain]) {
    assert.equal(source.includes("useMediaQuery('(prefers-color-scheme: dark)'"), false, 'platform roots must not duplicate system appearance resolution')
    assert.equal(source.includes('document.documentElement.dataset.xdriveTheme = resolvedMode'), false, 'platform roots must not duplicate theme metadata synchronization')
    assert.equal(source.includes('<CssBaseline />'), false, 'platform roots must not duplicate CssBaseline composition')
    assert.equal(source.includes('createXDriveMuiTheme(resolvedMode)'), false, 'platform roots must not construct the shared theme directly')
  }
})
