const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { app, BrowserWindow } = require('electron')

const samples = 7
const videoBase64 = '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'
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const sourcePath = path.join(
  repoRoot,
  'ui',
  'shared',
  'src',
  'mui',
  'MediaGalleryVideoPoster.ts',
)

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  let exitCode = 0
  const resultDir = path.join(desktopRoot, 'perf-results')
  fs.mkdirSync(resultDir, { recursive: true })
  const compiledPath = path.join(
    resultDir,
    'gallery-video-poster-performance-module.cjs',
  )
  const source = fs.readFileSync(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText
  fs.writeFileSync(compiledPath, compiled)

  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  try {
    await win.loadURL('data:text/html,<html><body></body></html>')
    const result = await win.webContents.executeJavaScript(
      `(async () => {
        const { xDriveCaptureVideoPosterBlob } = require(${JSON.stringify(compiledPath)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(videoBase64)}), (char) => char.charCodeAt(0))
        const cold = []
        const warm = []
        const posterBytes = []
        for (let sample = 0; sample < ${samples}; sample += 1) {
          const source = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
          try {
            let started = performance.now()
            const first = await xDriveCaptureVideoPosterBlob(source, 0, 96, 64, 512)
            cold.push(performance.now() - started)
            if (!first || first.size < 1) throw new Error('cold video poster decode returned no JPEG')
            posterBytes.push(first.size)

            started = performance.now()
            const second = await xDriveCaptureVideoPosterBlob(source, 0, 96, 64, 512)
            warm.push(performance.now() - started)
            if (!second || second.size < 1) throw new Error('warm video poster decode returned no JPEG')
            posterBytes.push(second.size)
          } finally {
            URL.revokeObjectURL(source)
          }
        }
        return { cold, warm, posterBytes }
      })()`,
      true,
    )

    const coldMedianMs = median(result.cold)
    const steadyColdMedianMs = median(result.cold.slice(1))
    const warmMedianMs = median(result.warm)
    const warmToColdRatio = warmMedianMs / Math.max(0.001, coldMedianMs)
    const warmToSteadyColdRatio = warmMedianMs / Math.max(0.001, steadyColdMedianMs)
    const metrics = {
      samples,
      videoBytes: Buffer.from(videoBase64, 'base64').length,
      firstProcessColdMs: result.cold[0],
      coldMedianMs,
      steadyColdMedianMs,
      coldMinMs: Math.min(...result.cold),
      coldMaxMs: Math.max(...result.cold),
      warmMedianMs,
      warmMinMs: Math.min(...result.warm),
      warmMaxMs: Math.max(...result.warm),
      warmToColdRatio,
      warmToSteadyColdRatio,
      posterBytesMedian: median(result.posterBytes),
    }
    fs.writeFileSync(
      path.join(resultDir, 'gallery-video-poster-performance.json'),
      JSON.stringify(metrics, null, 2) + '\n',
    )
    console.log('GALLERY_VIDEO_POSTER_DECODE_100K ' + JSON.stringify(metrics))
  } catch (error) {
    exitCode = 1
    console.error(error)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    app.exit(exitCode)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
