import Combine
import Foundation
import Photos
import UIKit

/// Read-only counters for the current Owner's local incremental PhotoKit
/// discovery queue. No source IDs, photo identifiers, bytes or upload rights
/// are sent to the Server. Counts must never be presented as backup coverage.
@MainActor
final class XDriveIOSNativePhotoQueueSummaryModel: ObservableObject {
    @Published private(set) var counts: XDriveIOSPhotoBackupChangeQueueStore.Counts?
    @Published private(set) var failedReasonCounts: [String: Int] = [:]

    var failedReasonDescription: String? {
        let details = failedReasonCounts.keys.sorted().compactMap { key -> String? in
            guard let reason = XDriveIOSPhotoBackupIssueReason(rawValue: key),
                  let number = failedReasonCounts[key], number > 0 else { return nil }
            return "\(reason.displayText) \(number)"
        }
        return details.isEmpty ? nil : details.joined(separator: "；")
    }
    @Published private(set) var busy = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var notice: String?
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func cancel() {
        job?.cancel()
        job = nil
        generation = UUID()
        counts = nil
        failedReasonCounts = [:]
        errorMessage = nil
        notice = nil
        busy = false
    }

    /// Requeue only failures that the original writer proved were item-local
    /// and pre-write safe. The queue actor revalidates Owner, authorization,
    /// PhotoKit baseline and each exact row revision before changing state.
    func retryFailed(login: XDriveIOSNativeOwnerLoginModel) {
        guard !busy, let selected = login.owner else { return }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "恢复失败项需要当前账户的照片访问权限。"
            return
        }
        job?.cancel()
        generation = UUID()
        let ticket = generation
        busy = true
        errorMessage = nil
        notice = nil
        job = Task { @MainActor [weak self, weak login] in
            guard let self, let login else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(verified.owner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: selected)
                let requeued = try await queue.retryFailedCandidates(
                    owner: selected, limit: 64
                )
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                let nextCounts = try await queue.summary(owner: selected)
                let reasons = try await queue.failureReasonCounts(owner: selected)
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else { return }
                self.counts = nextCounts
                self.failedReasonCounts = reasons
                if requeued > 0 {
                    _ = try? XDriveIOSPhotoAutoScheduleStore.shared
                        .expediteForLibraryChange(owner: selected)
                    self.notice = "已重新排队 \(requeued) 项安全失败的原件；下次前台自动检查会优先处理。"
                } else {
                    self.notice = "当前没有可安全重试的失败项。"
                }
            } catch is CancellationError {
                return
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.errorMessage = "无法安全恢复失败项；未改变不确定上传收据或服务器原件。"
            }
        }
    }

    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        guard let selected = login.owner else { return }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "读取照片变更队列需要当前账户的照片访问权限。"
            return
        }
        let ticket = generation
        busy = true
        job = Task { @MainActor [weak self, weak login] in
            guard let self, let login else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(verified.owner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: selected)
                let result = try await queue.summary(owner: selected)
                let reasons = try await queue.failureReasonCounts(owner: selected)
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.counts = result
                self.failedReasonCounts = reasons
            } catch is CancellationError {
                return
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.errorMessage = "无法读取当前账户的本机变更队列；不会推断任何照片已备份。"
            }
        }
    }
}


/// Reuses PhotoKit's existing bounded readers. Nothing here initiates a
/// transfer or infers complete cloud coverage from local queue ACKs.
@MainActor
final class XDriveIOSNativePhotoTaskListModel: ObservableObject {
    enum Mode: String, CaseIterable, Identifiable {
        case changes, library
        var id: String { rawValue }
        var title: String { self == .changes ? "新增变更" : "当前图库" }
    }

    enum Filter: String, CaseIterable, Identifiable {
        case all, pending, waitingICloud, failed, confirmed, missingLocal
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: return "全部"
            case .pending: return "待处理"
            case .waitingICloud: return "iCloud"
            case .failed: return "失败"
            case .confirmed: return "曾确认"
            case .missingLocal: return "已删除"
            }
        }
        var queueState: XDriveIOSPhotoBackupChangeQueueStore.ItemState? {
            switch self {
            case .all: return nil
            case .pending: return .pending
            case .waitingICloud: return .waitingICloud
            case .failed: return .failed
            case .confirmed: return .confirmed
            case .missingLocal: return .missingLocal
            }
        }
    }

    struct Row: Identifiable {
        let id: String
        let state: String
        let failureReasonCode: String?
        let typeLabel: String
        let date: Date?
        let localAvailable: Bool
    }

    @Published private(set) var rows: [Row] = []
    @Published private(set) var loading = false
    @Published private(set) var notice: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var counts: XDriveIOSPhotoBackupChangeQueueStore.Counts?
    @Published private(set) var libraryTotal: Int?
    @Published private(set) var offset = 0
    @Published private(set) var hasNext = false

    private var ticket = UUID()
    private var job: Task<Void, Never>?
    private static let changePageSize = 32
    private static let libraryPageSize = XDrivePhotoKitBoundedSnapshotScanner.pageSize

    func cancel() {
        ticket = UUID()
        job?.cancel()
        job = nil
        loading = false
    }

    func reset() {
        cancel()
        rows = []
        counts = nil
        libraryTotal = nil
        offset = 0
        hasNext = false
        errorMessage = nil
        notice = nil
    }

    func reload(login: XDriveIOSNativeOwnerLoginModel, mode: Mode, filter: Filter) {
        load(login: login, mode: mode, filter: filter, at: 0, clearExisting: true)
    }

    func next(login: XDriveIOSNativeOwnerLoginModel, mode: Mode, filter: Filter) {
        guard hasNext, !loading else { return }
        load(login: login, mode: mode, filter: filter,
             at: offset + (mode == .changes ? Self.changePageSize : Self.libraryPageSize),
             clearExisting: false)
    }

    func previous(login: XDriveIOSNativeOwnerLoginModel, mode: Mode, filter: Filter) {
        guard offset > 0, !loading else { return }
        let size = mode == .changes ? Self.changePageSize : Self.libraryPageSize
        load(login: login, mode: mode, filter: filter, at: max(0, offset - size), clearExisting: false)
    }

    private func load(login: XDriveIOSNativeOwnerLoginModel, mode: Mode,
                      filter: Filter, at requestedOffset: Int,
                      clearExisting: Bool) {
        cancel()
        if clearExisting {
            rows = []
            counts = nil
            libraryTotal = nil
            offset = 0
            hasNext = false
        }
        errorMessage = nil
        notice = nil
        guard let owner = login.owner,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              UIApplication.shared.applicationState == .active else {
            notice = "需要已验证账户、App 前台与“所有照片”权限；未读取队列。"
            return
        }
        let id = ticket
        loading = true
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.ticket == id {
                    self.loading = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }

                var page: [Row] = []
                var more = false
                var totals: XDriveIOSPhotoBackupChangeQueueStore.Counts?
                var libraryCount: Int?
                var readNotice: String?
                if mode == .changes {
                    let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: owner)
                    // Extra item is used only to decide whether Next is real.
                    let records = try await queue.page(
                        owner: owner, state: filter.queueState,
                        offset: requestedOffset, limit: Self.changePageSize + 1
                    )
                    if let records {
                        more = records.count > Self.changePageSize
                        let selected = Array(records.prefix(Self.changePageSize))
                        let fetched = PHAsset.fetchAssets(
                            withLocalIdentifiers: selected.map(\.localIdentifier),
                            options: nil
                        )
                        var byID: [String: PHAsset] = [:]
                        fetched.enumerateObjects { asset, _, _ in
                            byID[asset.localIdentifier] = asset
                        }
                        page = selected.map { record in
                            let asset = byID[record.localIdentifier]
                            return Row(
                                id: record.localIdentifier,
                                state: record.state.rawValue,
                                failureReasonCode: record.failureReasonCode,
                                typeLabel: asset == nil ? "原件目前不可见" :
                                    asset!.mediaType == .video ? "视频" :
                                    asset!.mediaSubtypes.contains(.photoLive) ? "实况照片" : "照片",
                                date: asset?.creationDate,
                                localAvailable: asset != nil && record.state != .missingLocal
                            )
                        }
                        totals = try await queue.summary(owner: owner)
                    } else {
                        readNotice = "本机增量历史尚未同步到当前 PhotoKit 版本；此时不能显示旧状态，请先在备份设置中核对或恢复。"
                    }
                } else {
                    let scanner = XDrivePhotoKitBoundedSnapshotScanner()
                    defer { Task { await scanner.reset() } }
                    let total = try await scanner.start(atOffset: requestedOffset)
                    let scanned = try await scanner.nextPage()
                    libraryCount = total
                    more = !scanned.finished
                    page = scanned.items.map { item in
                        Row(id: item.id, state: "unverified",
                            failureReasonCode: nil,
                            typeLabel: item.isLive ? "实况照片" :
                                item.kind == "video" ? "视频" : "照片",
                            date: item.capturedAt, localAvailable: item.kind != "unsupported")
                    }
                    readNotice = "这是授权图库的待核验清单，未读取云端原件收据；不能把未核验判为未备份或备份成功。"
                }
                try Task.checkCancellation()
                guard self.ticket == id,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                      UIApplication.shared.applicationState == .active else { return }
                self.rows = page
                self.hasNext = more
                self.offset = requestedOffset
                self.counts = totals
                self.libraryTotal = libraryCount
                self.notice = readNotice
            } catch is CancellationError {
            } catch {
                guard self.ticket == id else { return }
                self.rows = []
                self.hasNext = false
                self.errorMessage = "读取任务列表失败；没有改变任何照片、队列或上传收据。请恢复权限并重试。"
            }
        }
    }
}
