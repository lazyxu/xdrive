const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repoRoot = path.join(__dirname, '..', '..')

function loadTypeScriptModule(relativePath) {
  const filename = path.join(repoRoot, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

test(
  'FileExplorer VirtualCollection 100k scroll CPU baseline',
  { skip: process.env.XD_FILEEXPLORER_VIRTUAL_COLLECTION_PERF !== '1' },
  () => {
    const virtual = loadTypeScriptModule([
      'ui', 'shared', 'src', 'virtual-collection.ts',
    ])

    const totalCount = 100_000
    const viewportSize = 40
    const pageSize = virtual.XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE
    const requestOverscanPages = virtual.XDRIVE_VIRTUAL_COLLECTION_DEFAULT_OVERSCAN_PAGES
    const retentionOverscanPages = virtual.XDRIVE_VIRTUAL_COLLECTION_DEFAULT_RETENTION_OVERSCAN_PAGES

    const runWorkload = () => {
      let snapshot = virtual.xDriveCreateVirtualCollectionSnapshot('virtual-perf', 1)
      let pageLoads = 0
      let peakRetained = 0
      let viewportUpdates = 0

      for (let startIndex = 0; startIndex < totalCount; startIndex += viewportSize) {
        const endIndex = Math.min(totalCount - 1, startIndex + viewportSize - 1)
        const requestRanges = virtual.xDriveVirtualCollectionRangesForViewport({
          startIndex,
          endIndex,
          totalCount,
          pageSize,
          overscanPages: requestOverscanPages,
        })

        for (const range of requestRanges) {
          let loaded = true
          const end = Math.min(totalCount, range.offset + range.limit)
          for (let index = range.offset; index < end; index += 1) {
            if (!snapshot.items.has(index)) {
              loaded = false
              break
            }
          }
          if (loaded) continue

          const items = Array.from(
            { length: end - range.offset },
            (_, index) => range.offset + index,
          )
          snapshot = virtual.xDriveVirtualCollectionApplyPage(snapshot, 1, {
            items,
            offset: range.offset,
            limit: range.limit,
            totalCount,
          })
          pageLoads += 1
        }

        const retentionRanges = virtual.xDriveVirtualCollectionRangesForViewport({
          startIndex,
          endIndex,
          totalCount,
          pageSize,
          overscanPages: retentionOverscanPages,
        })
        snapshot = virtual.xDriveVirtualCollectionRetainRanges(snapshot, retentionRanges)
        peakRetained = Math.max(
          peakRetained,
          virtual.xDriveVirtualCollectionLoadedCount(snapshot),
        )
        viewportUpdates += 1
      }

      return {
        pageLoads,
        peakRetained,
        finalRetained: virtual.xDriveVirtualCollectionLoadedCount(snapshot),
        viewportUpdates,
      }
    }

    // Warm V8 and the TypeScript-transpiled module before timing.
    const warm = runWorkload()
    assert.equal(warm.pageLoads, totalCount / pageSize)
    assert.ok(warm.peakRetained <= pageSize * (retentionOverscanPages * 2 + 1))

    const sampleCount = 5
    const sweepsPerSample = 10
    const cpuSamples = []
    const wallSamples = []
    let lastResult
    for (let sample = 0; sample < sampleCount; sample += 1) {
      global.gc?.()
      const cpuStarted = process.cpuUsage()
      const wallStarted = process.hrtime.bigint()
      for (let sweep = 0; sweep < sweepsPerSample; sweep += 1) {
        lastResult = runWorkload()
      }
      const cpu = process.cpuUsage(cpuStarted)
      const cpuMsPerSweep = (cpu.user + cpu.system) / 1000 / sweepsPerSample
      const wallMsPerSweep = Number(process.hrtime.bigint() - wallStarted) / 1e6 / sweepsPerSample
      cpuSamples.push(cpuMsPerSweep)
      wallSamples.push(wallMsPerSweep)
    }
    cpuSamples.sort((left, right) => left - right)
    wallSamples.sort((left, right) => left - right)
    const medianCpuMs = cpuSamples[Math.floor(cpuSamples.length / 2)]
    const medianWallMs = wallSamples[Math.floor(wallSamples.length / 2)]
    const perViewportCpuUs = medianCpuMs * 1000 / lastResult.viewportUpdates

    assert.equal(lastResult.pageLoads, 500)
    assert.equal(lastResult.viewportUpdates, 2500)
    assert.ok(lastResult.peakRetained <= 1000)

    console.log(
      'FILEEXPLORER_VIRTUAL_COLLECTION_100K_CPU_BASELINE ' +
      `logical_count=${totalCount} viewport_size=${viewportSize} page_size=${pageSize} ` +
      `page_loads=${lastResult.pageLoads} peak_retained=${lastResult.peakRetained} ` +
      `final_retained=${lastResult.finalRetained} viewport_updates=${lastResult.viewportUpdates} ` +
      `median_cpu_ms_per_sweep=${medianCpuMs.toFixed(3)} ` +
      `per_viewport_cpu_us=${perViewportCpuUs.toFixed(3)} ` +
      `median_wall_ms_per_sweep=${medianWallMs.toFixed(3)} ` +
      `samples=${sampleCount} sweeps_per_sample=${sweepsPerSample}`,
    )
  },
)
