import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// Deterministic 100k *synthetic metadata* benchmark on the CI macOS host.
/// This is NOT a 100k PhotoKit/iCloud runtime or physical iPhone benchmark.
/// The native app separately logs actual PhotoKit metadata page counts,
/// elapsed milliseconds and bounded empirical P50/P95 for real sessions.
@main
struct NativeLocalMap100kBenchmark {
    static func main() {
        typealias Policy = XDriveIOSNativeLocalMapSpatialPolicy
        typealias Auto = XDriveIOSNativeLocalMapAutoRefinePolicy
        // CI-host spatial-index benchmark only; NOT real iPhone PhotoKit
        // scanning, iCloud latency, MapKit frame rate or provider RTT.
        for amount in [1, 10, 1_000, 10_000] {
            var milliseconds: [Double] = []
            for trial in 0..<5 {
                let started = ProcessInfo.processInfo.systemUptime
                var sample = XDriveIOSNativeLocalMapSpatialIndex<Int>()
                for id in 0..<amount {
                    let latitude = Double((id * 17 + trial) % 18000) / 100 - 90
                    let longitude = Double((id * 79 + trial) % 36000) / 100 - 180
                    precondition(sample.add(latitude: latitude,
                        longitude: longitude, representative: id))
                }
                precondition(sample.locatedCount == amount)
                precondition(sample.cells.count <= Policy.maximumCells)
                precondition(sample.cells.reduce(0) { $0 + $1.count } == amount)
                milliseconds.append(max(0,
                    (ProcessInfo.processInfo.systemUptime - started) * 1000))
            }
            let timing = Auto.scanPercentiles(milliseconds)!
            print("IOS_MAP_SYNTHETIC_SCALE n=\(amount) p50_ms=\(Int(timing.p50)) p95_ms=\(Int(timing.p95))")
        }
        let repeats = 5
        var durationMs: [Double] = []
        for run in 0..<repeats {
            let started = ProcessInfo.processInfo.systemUptime
            var index = XDriveIOSNativeLocalMapSpatialIndex<Int>()
            for offset in 0..<100_000 {
                let latitude = Double((offset * 37 + run * 7) % 18000) / 100 - 90
                let longitude = Double((offset * 79 + run * 11) % 36000) / 100 - 180
                precondition(index.add(
                    latitude: latitude, longitude: longitude,
                    representative: offset))
            }
            precondition(index.locatedCount == 100_000)
            precondition(index.cells.count <= Policy.maximumCells)
            precondition(index.cells.reduce(0) { $0 + $1.count } == 100_000)
            durationMs.append(max(0,
                (ProcessInfo.processInfo.systemUptime - started) * 1000))
        }
        guard let timings = Auto.scanPercentiles(durationMs)
        else { preconditionFailure("invalid 100k test timing sample") }
        let camera = Policy.viewportBounds(
            latitude: 37, longitude: -122, latitudeSpan: 4,
            longitudeSpan: 6)!
        let scanned = Auto.expandedViewport(
            latitude: 37, longitude: -122, latitudeSpan: 4,
            longitudeSpan: 6)!
        precondition(Auto.canReuse(cached: scanned, camera: camera))
        print("IOS_MAP_SYNTHETIC_100K trials=\(repeats) rows_per_trial=100000 max_cells=64 p50_ms=\(Int(timings.p50)) p95_ms=\(Int(timings.p95))")
        #if canImport(Darwin)
        var usage = rusage()
        if getrusage(RUSAGE_SELF, &usage) == 0 {
            // Darwin ru_maxrss is the high-water resident set size in bytes.
            print("IOS_MAP_SYNTHETIC_100K peak_rss_bytes=\(usage.ru_maxrss)")
        }
        #endif
    }
}
