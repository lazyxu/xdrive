import Combine
import Darwin
import Foundation
import Photos
import UIKit

/// User-triggered, read-only measurement on the *physical device*. It walks
/// the production stable 256-slot/64-page PhotoKit reader, retains no IDs,
/// and never opens originals, UploadSessions or a backup writer. Running it
/// in Simulator is not a 10k/100k iPhone performance acceptance result.
@MainActor
final class XDriveIOSPhotoKitReadOnlyPerformanceModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var scanned = 0
    @Published private(set) var total = 0
    @Published private(set) var sample: XDriveIOSPhotoKitReadOnlyPerformanceSample?
    @Published private(set) var failure: String?

    private enum ProbeError: Error { case changedLibrary, invalidWindow }
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func cancel() {
        generation = UUID()
        job?.cancel()
        job = nil
        busy = false
        scanned = 0
        total = 0
        sample = nil
        failure = nil
    }

    private static func processPeakResidentBytes() -> Int64? {
        // Darwin ru_maxrss is the whole process's historical high-water mark.
        // It is NOT attributed solely to PhotoKit or a per-page allocation.
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0 else { return nil }
        return max(0, Int64(usage.ru_maxrss))
    }

    func run() {
        cancel()
        guard UIApplication.shared.applicationState == .active,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
            failure = "真机性能实测需要 App 前台及“所有照片”访问权限。"
            return
        }
        let ticket = generation
        busy = true
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            let startedAt = ProcessInfo.processInfo.systemUptime
            do {
                let initial = try XDriveIOSPhotoKitLibraryEpoch.capture()
                let initialScanner = XDrivePhotoKitBoundedSnapshotScanner()
                let count: Int
                do {
                    count = try await initialScanner.start()
                    await initialScanner.reset()
                } catch {
                    await initialScanner.reset()
                    throw error
                }
                try Task.checkCancellation()
                guard self.generation == ticket, count >= 0,
                      UIApplication.shared.applicationState == .active else {
                    throw ProbeError.changedLibrary
                }
                self.total = count

                var windows = 0
                var pages = 0
                var firstPageMS = 0.0
                var slowestPageMS = 0.0
                var peakBytes = Self.processPeakResidentBytes()
                for window in 0..<XDrivePhotoBackupScanWindow.count(visibleTotal: count) {
                    try Task.checkCancellation()
                    guard self.generation == ticket,
                          UIApplication.shared.applicationState == .active,
                          PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                          let offset = XDrivePhotoBackupScanWindow.offset(for: window)
                    else { throw ProbeError.changedLibrary }
                    let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
                    guard XDriveIOSPhotoKitLibraryEpoch.matches(
                        initial.serialized, as: epoch.token
                    ) else { throw ProbeError.changedLibrary }

                    let required = XDrivePhotoBackupScanWindow.capacity(
                        visibleTotal: count, offset: offset
                    )
                    let reader = XDrivePhotoKitBoundedSnapshotScanner()
                    do {
                        let found = try await reader.start(
                            atOffset: offset, requireStableResume: true
                        )
                        guard found == count else { throw ProbeError.changedLibrary }
                        var inWindow = 0
                        while inWindow < required {
                            try Task.checkCancellation()
                            let pageStart = ProcessInfo.processInfo.systemUptime
                            let page = try await reader.nextPage()
                            let pageMS = max(0, (ProcessInfo.processInfo.systemUptime - pageStart) * 1000)
                            guard page.startOffset == offset + inWindow,
                                  page.totalAccessibleAssets == count,
                                  !page.items.isEmpty,
                                  page.nextOffset == page.startOffset + page.items.count,
                                  page.items.count <= XDrivePhotoKitBoundedSnapshotScanner.pageSize,
                                  inWindow + page.items.count <= required
                            else { throw ProbeError.invalidWindow }
                            if pages == 0 { firstPageMS = pageMS }
                            slowestPageMS = max(slowestPageMS, pageMS)
                            pages += 1
                            inWindow += page.items.count
                            self.scanned += page.items.count
                        }
                    } catch {
                        await reader.reset()
                        throw error
                    }
                    await reader.reset()
                    windows += 1
                    if let resident = Self.processPeakResidentBytes() {
                        peakBytes = max(peakBytes ?? 0, resident)
                    }
                    let after = try XDriveIOSPhotoKitLibraryEpoch.capture()
                    guard self.generation == ticket,
                          UIApplication.shared.applicationState == .active,
                          XDriveIOSPhotoKitLibraryEpoch.matches(
                              initial.serialized, as: after.token
                          ) else { throw ProbeError.changedLibrary }
                    // Allow the native UI and cancellation to progress between
                    // every bounded scan window, including large libraries.
                    await Task.yield()
                }
                try Task.checkCancellation()
                let candidate = XDriveIOSPhotoKitReadOnlyPerformanceSample(
                    total: count, scanned: self.scanned, windows: windows,
                    pages: pages,
                    elapsedMS: max(0, (ProcessInfo.processInfo.systemUptime - startedAt) * 1000),
                    firstPageMS: firstPageMS, slowestPageMS: slowestPageMS,
                    peakResidentBytes: peakBytes, measuredAt: Date()
                )
                guard self.generation == ticket, candidate.complete,
                      UIApplication.shared.applicationState == .active
                else { throw ProbeError.changedLibrary }
                self.sample = candidate
            } catch is CancellationError {
                // Cancellation, Owner/UI exit or lock never yields a result.
            } catch {
                guard self.generation == ticket else { return }
                self.sample = nil
                self.failure = "图库或访问权限发生变化，或有一段未读取完整。本次测量作废，请重新启动。"
            }
        }
    }
}
