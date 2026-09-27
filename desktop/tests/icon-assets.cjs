const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative))
const text = (relative) => read(relative).toString('utf8')

test('application icon has one SVG source of truth and platform wiring', () => {
  const master = text('assets/icon/master/xdrive-icon-master.svg')
  assert.ok(master.includes('viewBox="0 0 1024 1024"'), 'master icon must use the approved 1024 viewBox')
  assert.ok(master.includes('<linearGradient id="bg"'), 'master icon must retain the approved blue gradient')
  assert.ok(master.includes('x/infinity symbol'), 'master icon description should identify the xDrive mark')

  const builder = text('desktop/electron-builder.yml')
  const masterRef = '../assets/icon/master/xdrive-icon-master.svg'
  assert.equal(builder.split(masterRef).length - 1, 2, 'Windows and Linux Desktop builds must both use the master SVG')

  const desktopRenderer = text('desktop/src/renderer/App.tsx')
  assert.ok(
    desktopRenderer.includes("import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'"),
    'Desktop brand lockups must import the approved master SVG directly',
  )
  const desktopBrandUses = desktopRenderer.match(/src=\{xDriveBrandIcon\}/g) || []
  assert.ok(desktopBrandUses.length >= 4, 'Desktop auth/sidebar brand lockups must use the shared master icon')

  const web = text('web/index.html')
  assert.ok(web.includes('href="/favicon.svg"'), 'Web must expose the generated SVG favicon')
  assert.ok(web.includes('href="/favicon.ico"'), 'Web must expose the multi-size ICO favicon')
  assert.ok(web.includes('href="/apple-touch-icon.png"'), 'Web must expose the Apple Touch icon')
  assert.ok(web.includes('href="/site.webmanifest"'), 'Web must expose the manifest')
  assert.ok(text('web/vite.config.ts').includes("publicDir: '../assets/icon/web'"), 'Vite must serve generated Web icon derivatives')
  assert.ok(read('assets/icon/web/favicon.svg').equals(read('assets/icon/master/xdrive-icon-master.svg')), 'Web SVG favicon must remain byte-identical to the master SVG')
  const webRenderer = text('web/src/App.tsx')
  assert.ok(
    webRenderer.includes("import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'"),
    'Web brand lockups must import the approved master SVG directly',
  )
  assert.equal((webRenderer.match(/src=\{xDriveBrandIcon\}/g) || []).length, 3, 'Web brand lockups must all use the master icon')
  assert.ok(text('web/Dockerfile').includes('COPY assets/icon/ /app/assets/icon/'), 'Web Docker build must copy shared icon assets')

  const linuxDesktop = text('packaging/linux/xdrive.desktop')
  assert.ok(linuxDesktop.includes('\nIcon=xdrive\n'), 'Linux launcher must resolve the installed xDrive icon')
  assert.ok(text('scripts/build-linux-deb.sh').includes('hicolor/scalable/apps/xdrive.svg'), 'Linux package must install the master SVG')

  const installer = text('packaging/windows/xdrive.iss')
  assert.ok(installer.includes('SetupIconFile={#SourceDir}\\icons\\app.ico'), 'Windows installer must use the generated app.ico')
  assert.ok(installer.includes('UninstallDisplayIcon={app}\\desktop\\xdrive-desktop.exe'), 'Windows Apps & Features must use the Desktop app icon')
  assert.ok(text('scripts/build-windows-installer.ps1').includes('assets\\icon\\windows\\app.ico'), 'Windows packaging must copy the generated app.ico')
})

test('generated Windows ICO contains the required icon frames', () => {
  const ico = read('assets/icon/windows/app.ico')
  assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved field')
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type')
  const count = ico.readUInt16LE(4)
  assert.ok(count >= 5, 'app.ico should contain at least 5 frames')

  const sizes = []
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    const width = ico[offset] === 0 ? 256 : ico[offset]
    const height = ico[offset + 1] === 0 ? 256 : ico[offset + 1]
    assert.equal(width, height, 'ICO frames must be square')
    const bytesInRes = ico.readUInt32LE(offset + 8)
    const imageOffset = ico.readUInt32LE(offset + 12)
    assert.ok(imageOffset >= 6 + count * 16, 'ICO frame payload must start after the directory')
    assert.ok(imageOffset + bytesInRes <= ico.length, `ICO ${width}x${height} frame exceeds file length`)
    sizes.push(width)
  }
  for (const size of [16, 32, 48, 64, 256]) {
    assert.ok(sizes.includes(size), `app.ico missing ${size}x${size} frame`)
  }
})
