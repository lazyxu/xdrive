const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const rendererMain = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8')
const sharedTheme = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'theme.ts'), 'utf8')
const sharedAppearance = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'AppearanceField.tsx'), 'utf8')
const sharedPreferences = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'preferences.ts'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const preferences = fs.readFileSync(path.join(root, 'src', 'main', 'window_preferences.cts'), 'utf8')

test('desktop renderer supports light, dark, and system appearance', () => {
  assert.ok(rendererMain.includes("useMediaQuery('(prefers-color-scheme: dark)'"), 'missing system dark-mode media query')
  assert.ok(rendererMain.includes("appearance === 'system'"), 'renderer must resolve the system option')
  assert.ok(rendererMain.includes('createXDriveMuiTheme(resolvedMode)'), 'desktop must pass the resolved appearance into the shared theme')
  assert.ok(rendererMain.includes('document.documentElement.dataset.xdriveTheme = resolvedMode'), 'legacy CSS theme marker is missing')
  assert.ok(rendererMain.includes('<App appearance={appearance} onAppearanceChange={changeAppearance} />'), 'App must receive the appearance controls')
  assert.ok(rendererMain.includes('<ThemeProvider theme={theme}>'), 'missing MUI ThemeProvider')
  assert.ok(rendererMain.includes('<CssBaseline />'), 'missing MUI CssBaseline')
  assert.ok(sharedTheme.includes("export function createXDriveMuiTheme(mode: PaletteMode = 'light')"), 'shared MUI theme factory is missing')
  assert.ok(sharedTheme.includes('palette: {\n      mode,'), 'shared MUI palette must use the requested appearance')
  for (const label of ['白天模式', '黑夜模式', '跟随系统']) {
    assert.ok(sharedPreferences.includes(label), `shared appearance option missing: ${label}`)
  }
  assert.ok(sharedAppearance.includes('xDriveAppearanceOptions.map'), 'shared appearance field must render the shared options')
})

test('legacy desktop CSS follows the resolved appearance instead of only the OS', () => {
  assert.ok(styles.includes("@media (prefers-color-scheme: dark)"), 'system dark fallback is missing')
  assert.ok(styles.includes(":root[data-xdrive-theme='light']"), 'forced light selector is missing')
  assert.ok(styles.includes(":root[data-xdrive-theme='dark']"), 'forced dark selector is missing')
  assert.ok(styles.includes('--page-bg: #0f141d'), 'missing dark page surface')
  assert.ok(styles.includes('--surface: #171d27'), 'missing dark panel surface')
  assert.ok(styles.includes('--text: #e7edf7'), 'missing dark primary text')
  assert.ok(styles.includes('background: var(--surface);'), 'legacy surfaces must use theme variables')
  assert.equal(styles.includes('background: white;'), false, 'hard-coded white surfaces would break dark mode')
})

test('native Electron window persists and applies the selected appearance before window creation', () => {
  assert.ok(preferences.includes("export type DesktopAppearance = 'system' | 'light' | 'dark'"), 'desktop appearance preference type is missing')
  assert.ok(preferences.includes("appearance: 'system'"), 'desktop appearance must default to system')
  assert.ok(main.includes('nativeTheme.themeSource = desktopPreferences.appearance'), 'nativeTheme must use the persisted appearance')
  assert.ok(main.includes("ipcMain.handle('desktop:set-appearance'"), 'appearance IPC setter is missing')
  assert.ok(main.includes('backgroundColor: desktopWindowBackground()'), 'BrowserWindow must use theme-aware startup background')
  assert.ok(main.includes("nativeTheme.on('updated'"), 'BrowserWindow background must update when effective appearance changes')
})
