const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const rendererMain = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')

test('desktop renderer follows the operating-system color scheme', () => {
  assert.ok(rendererMain.includes("useMediaQuery('(prefers-color-scheme: dark)'"), 'missing system dark-mode media query')
  assert.ok(rendererMain.includes('<ThemeProvider theme={theme}>'), 'missing MUI ThemeProvider')
  assert.ok(rendererMain.includes('<CssBaseline />'), 'missing MUI CssBaseline')
  assert.ok(rendererMain.includes("mode: prefersDark ? 'dark' : 'light'"), 'MUI palette must follow system appearance')
})

test('legacy desktop CSS uses theme variables for both schemes', () => {
  assert.ok(styles.includes('@media (prefers-color-scheme: dark)'), 'missing dark CSS media query')
  assert.ok(styles.includes('--page-bg: #0f141d'), 'missing dark page surface')
  assert.ok(styles.includes('--surface: #171d27'), 'missing dark panel surface')
  assert.ok(styles.includes('--text: #e7edf7'), 'missing dark primary text')
  assert.ok(styles.includes('background: var(--surface);'), 'legacy surfaces must use theme variables')
  assert.equal(styles.includes('background: white;'), false, 'hard-coded white surfaces would break dark mode')
})

test('native Electron window follows system appearance before renderer paint', () => {
  assert.ok(main.includes("nativeTheme.themeSource = 'system'"), 'nativeTheme must follow the OS')
  assert.ok(main.includes('backgroundColor: desktopWindowBackground()'), 'BrowserWindow must use theme-aware startup background')
  assert.ok(main.includes("nativeTheme.on('updated'"), 'BrowserWindow background must update when OS appearance changes')
})
