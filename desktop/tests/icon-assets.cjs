const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative))
const text = (relative) => read(relative).toString('utf8')
const gitBlobSha = (buffer) => crypto
  .createHash('sha1')
  .update(`blob ${buffer.length}\0`)
  .update(buffer)
  .digest('hex')

test('application icon has one SVG source of truth and platform wiring', () => {
  const master = text('assets/icon/master/xdrive-icon-master.svg')
  assert.ok(master.includes('viewBox="0 0 1024 1024"'), 'master icon must use the approved 1024 viewBox')
  assert.ok(master.includes('<linearGradient id="bg"'), 'master icon must retain the approved blue gradient')
  assert.ok(master.includes('x/infinity symbol'), 'master icon description should identify the xDrive mark')
  assert.equal((master.match(/<rect x="0" y="0" width="1024" height="1024" rx="242"/g) || []).length, 2,
    'master blue backgrounds must fully occupy the 1024 canvas')
  assert.ok(!master.includes('<rect x="48" y="48" width="928" height="928"'),
    'the old 48px transparent margin caused undersized app icons')

  const builder = text('desktop/electron-builder.yml')
  const masterRef = '../assets/icon/master/xdrive-icon-master.svg'
  assert.equal(builder.split(masterRef).length - 1, 1, 'Linux Desktop must use the master SVG directly')
  assert.ok(builder.includes('icon: ../assets/icon/windows/app.ico'), 'Windows Desktop executable must use the generated multi-size app.ico')

  const desktopRenderer = text('desktop/src/renderer/App.tsx')
  assert.ok(
    desktopRenderer.includes("import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'"),
    'Desktop brand lockups must import the approved master SVG directly',
  )
  const desktopBrandUses = desktopRenderer.match(/iconSrc=\{xDriveBrandIcon\}/g) || []
  assert.equal(desktopBrandUses.length, 2, 'Desktop titlebar and login identity must both reuse the same master SVG')

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
  assert.equal((webRenderer.match(/iconSrc=\{xDriveBrandIcon\}/g) || []).length, 3, 'Web shared brand lockups must all receive the master icon')
  assert.ok(text('deploy/Caddy.Dockerfile').includes('COPY web/dist/ /srv/'), 'Merged Caddy/Web image must copy the CI-built Web dist')

  const linuxDesktop = text('packaging/linux/xdrive.desktop')
  assert.ok(linuxDesktop.includes('\nIcon=xdrive\n'), 'Linux launcher must resolve the installed xDrive icon')
  assert.ok(text('scripts/build-linux-deb.sh').includes('hicolor/scalable/apps/xdrive.svg'), 'Linux package must install the master SVG')

  const installer = text('packaging/windows/xdrive.iss')
  assert.ok(installer.includes('SetupIconFile={#SourceDir}\\icons\\app.ico'), 'Windows installer must use the generated app.ico')
  assert.ok(installer.includes('UninstallDisplayIcon={app}\\desktop\\xdrive-desktop.exe'), 'Windows Apps & Features must use the Desktop app icon')
  assert.ok(text('scripts/build-windows-installer.ps1').includes('assets\\icon\\windows\\app.ico'), 'Windows packaging must copy the generated app.ico')
  assert.ok(
    text('packaging/windows/xdrive-agent-winres.json').includes('../../assets/icon/windows/app.ico'),
    'Windows background agent must embed the generated app.ico',
  )
  assert.ok(
    text('scripts/build-client-core.sh').includes('go run github.com/tc-hib/go-winres@v0.3.3'),
    'prebuilt Windows agent must generate icon resources before go build',
  )
  assert.ok(
    text('scripts/build-windows-installer.ps1').includes('go run github.com/tc-hib/go-winres@v0.3.3'),
    'direct Windows installer builds must generate agent icon resources before go build',
  )

  assert.ok(builder.includes('../assets/icon/web/pwa-192.png'), 'Desktop package must include the cross-platform PNG runtime icon')
  assert.ok(builder.includes('../assets/icon/windows/app.ico'), 'Desktop package must include the Windows ICO runtime icon')
  assert.ok(builder.includes('to: app-icon.ico'), 'Windows runtime ICO must be copied beside packaged resources')
  const desktopMain = text('desktop/src/main/index.cts')
  assert.ok(desktopMain.includes("path.join(process.resourcesPath, 'app-icon.ico')"), 'Packaged Windows Desktop window must use the packaged ICO')
  assert.ok(desktopMain.includes("'assets', 'icon', 'windows', 'app.ico'"), 'Development Windows Desktop window must use the generated ICO')
  assert.ok(desktopMain.includes("path.join(process.resourcesPath, 'app-icon.png')"), 'Non-Windows packaged Desktop window must retain the PNG runtime icon')
  assert.ok(desktopMain.includes('nativeImage.createFromPath(assetPath)'), 'Desktop must keep a native runtime icon handle')
  assert.ok(desktopMain.includes('mainWindow.setIcon(desktopRuntimeIcon())'), 'Windows taskbar decoration updates must restore the xDrive window icon')
})

test('generated icon derivatives match the recorded source contract', () => {
  const contract = JSON.parse(text('assets/icon/generated-assets.json'))
  assert.equal(contract.version, 2, 'unexpected generated icon contract version')
  assert.equal(contract.source.path, 'assets/icon/master/xdrive-icon-master.svg')
  assert.equal(
    contract.source.git_blob_sha,
    gitBlobSha(read(contract.source.path)),
    'master icon changed without regenerating derivatives; run make icons',
  )

  const expectedPaths = [
    'assets/icon/web/favicon.svg',
    'assets/icon/web/favicon.ico',
    'assets/icon/web/apple-touch-icon.png',
    'assets/icon/web/pwa-192.png',
    'assets/icon/web/pwa-512.png',
    'assets/icon/web/site.webmanifest',
    'assets/icon/windows/app.ico',
    'assets/icon/tray/tray-normal.png',
    'assets/icon/tray/tray-syncing.png',
    'assets/icon/tray/tray-paused.png',
    'assets/icon/tray/tray-conflict.png',
    'assets/icon/tray/tray-offline.png',
  ]
  assert.deepEqual(Object.keys(contract.generated), expectedPaths, 'generated icon contract file list changed unexpectedly')
  for (const relative of expectedPaths) {
    assert.equal(
      contract.generated[relative],
      gitBlobSha(read(relative)),
      `${relative} drifted from the generated icon contract; run make icons`,
    )
  }
})

test('generated tray icons are 16x16 master-derived contract assets', () => {
  for (const kind of ['normal', 'syncing', 'paused', 'conflict', 'offline']) {
    const data = read(`assets/icon/tray/tray-${kind}.png`)
    assert.ok(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `tray-${kind}.png: invalid PNG signature`)
    assert.equal(data.readUInt32BE(16), 16, `tray-${kind}.png: expected 16px width`)
    assert.equal(data.readUInt32BE(20), 16, `tray-${kind}.png: expected 16px height`)
  }

  const generator = text('scripts/generate-icon-assets.mjs')
  assert.ok(generator.includes('function trayVariantSvg'), 'tray variants must be produced by the shared icon generator')
  assert.ok(generator.includes("const trayKinds = ['normal', 'syncing', 'paused', 'conflict', 'offline']"), 'generator must own all tray states')
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

test('icon derivatives have one-command regeneration tooling', () => {
  const generator = text('scripts/generate-icon-assets.mjs')
  assert.ok(generator.includes("['inkscape', 'rsvg-convert', 'magick']"), 'icon generator must provide portable renderer fallbacks')
  assert.ok(generator.includes('rendererCompatibleSvg'), 'icon generator must preserve the master while normalizing renderer compatibility')
  assert.ok(generator.includes('opaqueLauncherSvg'), 'iOS/PWA icons must remove rounded transparent source corners before rasterization')
  assert.ok(generator.includes('[180, 192, 512].includes(size) ? opaqueSourceSvg : sourceSvg'),
    'Apple Touch and PWA PNGs must use an opaque full-bleed source, other platforms the rounded master')
  assert.ok(generator.includes('[16, 32, 48, 64, 180, 192, 256, 512]'), 'icon generator must render every required derivative size')
  assert.ok(generator.includes("[16, 32, 48, 64, 256]"), 'icon generator must build every Windows ICO frame')
  assert.ok(generator.includes("[16, 32, 48]"), 'icon generator must build every favicon ICO frame')
  assert.ok(generator.includes('generated-assets.json'), 'icon generator must write the generated asset drift contract')
  assert.ok(generator.includes('trayVariantSvg'), 'icon generator must derive tray variants from the master')
  assert.ok(text('Makefile').includes('icons:\n\tnode scripts/generate-icon-assets.mjs'), 'Makefile must expose the one-command icon generator')
})
