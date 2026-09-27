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

  const web = text('web/index.html')
  assert.ok(web.includes('href="/xdrive-icon-master.svg"'), 'Web must use the shared master SVG favicon')
  assert.ok(text('web/vite.config.ts').includes("publicDir: '../assets/icon/master'"), 'Vite must serve the shared icon source')

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
