import Foundation
import UIKit
import QuartzCore
import Darwin

#if DEBUG
/// Opt-in measurements from the *real application process*. Enabled only by
/// -xdrive-map-100k-perf in Debug builds. No PHAsset ID, filename, GPS, image
/// data or Owner credential is written to the report.
final class XDriveIOSMapRealPerformanceProbe: NSObject {
    static let shared = XDriveIOSMapRealPerformanceProbe()
    static let enabled = ProcessInfo.processInfo.arguments.contains("-xdrive-map-100k-perf")

    struct ScanToken {
        let started: CFTimeInterval
        let cpuStart: Double?
        var sampledPeakResidentBytes: UInt64?
        let stage: String
    }

    private final class FrameWindow {
        let stage: String
        let started = CACurrentMediaTime()
        let cpuStart = XDriveIOSMapRealPerformanceProbe.cpuSeconds()
        var sampledPeakResidentBytes = XDriveIOSMapRealPerformanceProbe.residentBytes()
        var previousTimestamp: CFTimeInterval?
        var gaps: [Double] = []
        var ticks = 0

        init(stage: String) { self.stage = stage }
    }

    private var entries: [[String: Any]] = []
    private var windows: [String: FrameWindow] = [:]
    private var displayLink: CADisplayLink?
    // Independent XCTest stages share a real Simulator library but never
    // overwrite one another's numeric app-process evidence.
    private static let runStage: String = {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-xdrive-map-perf-stage"),
              index + 1 < args.count else { return "unknown" }
        let stage = args[index + 1]
        return ["scan", "wall", "zoom"].contains(stage) ? stage : "invalid"
    }()
    private lazy var outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("ios-map-100k-\(Self.runStage)-metrics.json")

    private(set) var completedScanCount = 0
    private(set) var cacheHits = 0

    private override init() {
        super.init()
        if Self.enabled { try? FileManager.default.removeItem(at: outputURL) }
    }

    private static func cpuSeconds() -> Double? {
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0 else { return nil }
        let user = Double(usage.ru_utime.tv_sec) +
            Double(usage.ru_utime.tv_usec) / 1_000_000
        let system = Double(usage.ru_stime.tv_sec) +
            Double(usage.ru_stime.tv_usec) / 1_000_000
        return user + system
    }

    private static func residentBytes() -> UInt64? {
        var info = mach_task_basic_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info_data_t>.size /
                MemoryLayout<integer_t>.size
        )
        let result: kern_return_t = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO),
                          $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        return UInt64(info.resident_size)
    }

    private static func percentile(_ values: [Double], _ fraction: Double) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return 0 }
        let index = min(sorted.count - 1,
                        Int(ceil(Double(sorted.count) * fraction)) - 1)
        return sorted[max(0, index)]
    }

    private static func jsonNumber(_ value: Double?) -> Any {
        if let value { return value }
        return NSNull()
    }

    private static func jsonMemory(_ value: UInt64?) -> Any {
        if let value { return value }
        return NSNull()
    }

    func beginScan(stage: String) -> ScanToken? {
        guard Self.enabled else { return nil }
        beginFrameWindow("scan_ui_\(stage)")
        return ScanToken(
            started: CACurrentMediaTime(), cpuStart: Self.cpuSeconds(),
            sampledPeakResidentBytes: Self.residentBytes(), stage: stage
        )
    }

    func sampleScan(_ token: inout ScanToken?) {
        guard Self.enabled, var current = token else { return }
        if let sampled = Self.residentBytes() {
            current.sampledPeakResidentBytes = max(
                current.sampledPeakResidentBytes ?? 0, sampled)
        }
        token = current
    }

    func finishScan(
        _ token: ScanToken?, succeeded: Bool,
        total: Int, metadataItems: Int, metadataPages: Int, located: Int
    ) {
        guard Self.enabled, let token else { return }
        endFrameWindow("scan_ui_\(token.stage)")
        let cpuEnd = Self.cpuSeconds()
        let memoryEnd = Self.residentBytes()
        let peak = max(token.sampledPeakResidentBytes ?? 0, memoryEnd ?? 0)
        let elapsed = max(0, CACurrentMediaTime() - token.started) * 1_000
        if succeeded { completedScanCount += 1 }
        record([
            "kind": "scan", "stage": token.stage,
            "completed": succeeded,
            "elapsed_ms": elapsed,
            "total_assets": total, "metadata_items": metadataItems,
            "metadata_pages": metadataPages, "located_items": located,
            "process_cpu_ms": Self.jsonNumber(cpuEnd.flatMap { end in
                token.cpuStart.map { max(0, end - $0) * 1_000 }
            }),
            "sampled_peak_resident_bytes": Self.jsonMemory(peak > 0 ? peak : nil),
        ])
    }

    /// A reused viewport must have ZERO new PhotoKit enumeration. This event
    /// is emitted only from the existing verified-window cache-hit branch.
    func recordCacheHit(elapsedMilliseconds: Double, total: Int, located: Int) {
        guard Self.enabled else { return }
        cacheHits += 1
        record([
            "kind": "cache", "stage": "verified_viewport_reuse",
            "elapsed_ms": max(0, elapsedMilliseconds),
            "total_assets": total, "located_items": located,
            "metadata_items": 0, "metadata_pages": 0,
            "sampled_peak_resident_bytes": Self.residentBytes() ?? 0
        ])
    }

    func beginFrameWindow(_ stage: String) {
        guard Self.enabled, windows[stage] == nil else { return }
        windows[stage] = FrameWindow(stage: stage)
        if displayLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(onDisplayTick(_:)))
            link.add(to: .main, forMode: .common)
            displayLink = link
        }
    }

    @objc private func onDisplayTick(_ link: CADisplayLink) {
        for window in windows.values {
            if let last = window.previousTimestamp, link.timestamp > last {
                window.gaps.append((link.timestamp - last) * 1_000)
            }
            window.previousTimestamp = link.timestamp
            window.ticks += 1
            if window.ticks % 12 == 0, let resident = Self.residentBytes() {
                window.sampledPeakResidentBytes = max(
                    window.sampledPeakResidentBytes ?? 0, resident)
            }
        }
    }

    func endFrameWindow(_ stage: String) {
        guard Self.enabled, let window = windows.removeValue(forKey: stage) else {
            return
        }
        if windows.isEmpty {
            displayLink?.invalidate()
            displayLink = nil
        }
        let duration = max(0, CACurrentMediaTime() - window.started) * 1_000
        let gaps = window.gaps
        let sum = gaps.reduce(0, +)
        let maxRefresh = max(1, UIScreen.main.maximumFramesPerSecond)
        let longerThanOneAndHalfRefresh = gaps.filter {
            $0 > 1_500 / Double(maxRefresh)
        }.count
        let cpuEnd = Self.cpuSeconds()
        record([
            "kind": "frame", "stage": stage,
            // CADisplayLink measures main-runloop callback cadence. It is NOT
            // a GPU-presented-frame counter or a 120Hz physical device claim.
            "measurement": "CADisplayLink_callback_cadence",
            "duration_ms": duration,
            "display_callback_intervals": gaps.count,
            // Exact numeric intervals permit true aggregate P50/P95 across
            // all measured gestures. No IDs, coordinates or media enter data.
            "callback_intervals_ms": gaps,
            "observed_callback_fps": sum > 0 ? Double(gaps.count) * 1_000 / sum : 0,
            "frame_interval_p50_ms": Self.percentile(gaps, 0.50),
            "frame_interval_p95_ms": Self.percentile(gaps, 0.95),
            "long_callback_gaps": longerThanOneAndHalfRefresh,
            "screen_max_fps": maxRefresh,
            "process_cpu_ms": Self.jsonNumber(cpuEnd.flatMap { end in
                window.cpuStart.map { max(0, end - $0) * 1_000 }
            }),
            "sampled_peak_resident_bytes":
                Self.jsonMemory(window.sampledPeakResidentBytes)
        ])
    }

    private func record(_ entry: [String: Any]) {
        entries.append(entry)
        let report: [String: Any] = [
            "schema": "xdrive.ios.map.real-photokit-perf.v1",
            "run_stage": Self.runStage,
            "source": "Debug app, genuine PHAsset scan + MapKit + CADisplayLink",
            "memory_kind": "sampled app resident size, NOT exact system peak",
            "frame_kind": "main-runloop callback cadence, NOT presented GPU FPS",
            "events": entries
        ]
        do {
            let bytes = try JSONSerialization.data(
                withJSONObject: report, options: [.sortedKeys, .prettyPrinted])
            try bytes.write(to: outputURL, options: .atomic)
            print("IOS_MAP_REAL_PERF kind=\(entry["kind"] ?? "unknown") stage=\(entry["stage"] ?? "unknown") events=\(entries.count)")
        } catch {
            print("IOS_MAP_REAL_PERF_WRITE_FAILED \(error)")
        }
    }
}
#endif
