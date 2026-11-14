import Combine
import Foundation
import SwiftUI

struct XDriveIOSNativeUnifiedGalleryPage {
    let number: Int
    let rows: [XDriveIOSNativeUnifiedPhoto]
}

@MainActor
final class XDriveIOSNativeUnifiedPhotoWall: ObservableObject {
    @Published private(set) var index = XDriveIOSNativeUnifiedPageIndex(start: XDriveIOSNativeGalleryCursor())
    @Published private(set) var generation = UUID()
    @Published private(set) var pageDateBoundaries: [Int: XDriveIOSNativeUnifiedPageDateBoundary] = [:]
    @Published private(set) var failure: String?
    private(set) var library: Data?

    func reset() {
        generation = UUID()
        pageDateBoundaries = [:]
        index = .init(start: .init())
        library = (try? XDriveIOSPhotoKitLibraryEpoch.capture())?.serialized
        failure = nil
    }

    func accept(_ model: XDriveIOSNativeUnifiedPhotoTimeline, page: Int) -> Bool {
        guard model.completed else { return false }
        guard index.commit(page: page, count: model.rows.count, next: model.next) else {
            failure = "图库排序或配对结果已变化，请刷新以继续浏览。"
            pageDateBoundaries = [:]
            return false
        }
        // Only keep four *accepted* date tails, never any photo IDs, original
        // bytes, or additional PhotoKit/Owner query capabilities.
        pageDateBoundaries[page] = .init(
            page: page, count: model.rows.count,
            lastCapturedAt: model.rows.last?.capturedAt
        )
        if pageDateBoundaries.count > 4,
           let farthest = pageDateBoundaries.keys.max(by: {
               abs($0 - page) < abs($1 - page)
           }) {
            pageDateBoundaries.removeValue(forKey: farthest)
        }
        return true
    }

    func continuesPreviousDate(page: Int, firstCapturedAt: Date?,
                               scale: XDriveIOSNativePhotoWallTimeScale) -> Bool {
        guard page > 0, index.pages.indices.contains(page),
              index.pages[page - 1].end == index.pages[page].start,
              let previous = pageDateBoundaries[page - 1] else { return false }
        return previous.continues(nextPage: page,
                                  firstCapturedAt: firstCapturedAt, scale: scale)
    }

    func measure(page: Int, height: Double) {
        guard index.pages.indices.contains(page), abs(index.pages[page].height - height) > 1 else { return }
        index.measure(page: page, height: height)
    }

    func read(page: Int, login: XDriveIOSNativeOwnerLoginModel, owner: XDriveNativeOwnerRoot,
              filter: XDriveIOSNativeGalleryPresence?, query: XDriveIOSNativeUnifiedGalleryQuery)
        async throws -> XDriveIOSNativeUnifiedGalleryPage {
        guard failure == nil, index.pages.indices.contains(page),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        let ticket = generation
        let model = XDriveIOSNativeUnifiedPhotoTimeline()
        await model.load(from: index.pages[page].start, filter: filter, login: login, query: query, library: library)
        try Task.checkCancellation()
        guard generation == ticket, XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
              accept(model, page: page) else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return .init(number: page, rows: model.rows)
    }
}

private struct XDriveUnifiedPageHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Each visible range owns at most 48 reconciled rows. SwiftUI may retain a
/// view's State after scrolling away, so explicitly release its model too.
@MainActor
struct XDriveIOSNativeUnifiedPhotoWallPage: View {
    let page: XDriveIOSNativeUnifiedPageIndex<XDriveIOSNativeGalleryCursor>.Page
    @ObservedObject var wall: XDriveIOSNativeUnifiedPhotoWall
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let owner: XDriveNativeOwnerRoot
    let filter: XDriveIOSNativeGalleryPresence?
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let density: XDriveIOSNativePhotoWallDensity
    let framing: XDriveIOSNativePhotoWallFraming
    let timeScale: XDriveIOSNativePhotoWallTimeScale
    let displayActive: Bool
    let retainWhileCovered: Bool
    let open: (XDriveIOSNativeUnifiedGalleryPage, Int) -> Void
    let loaded: ([String]) -> Void
    let pairing: (XDriveIOSNativeUnifiedPhoto) -> Void
    @StateObject private var model = XDriveIOSNativeUnifiedPhotoTimeline()
    @State private var visible = false
    @State private var retry = UUID()
    @State private var acceptedGeneration: UUID?
    @State private var queueBadges: [String: XDriveIOSPhotoKitPersistentBackupQueue.VisibleItemStatus] = [:]
    @State private var badgeReadEpoch = UUID()
    @State private var queueHistoryCurrent = false
    @Environment(\.xdriveNativePhotoQueueBadgeOwner) private var backupBadgeOwner
    @Environment(\.xdriveNativePhotoProcessingID) private var activeProcessingID
    @Environment(\.xdriveNativePhotoOnlyNewSince) private var onlyNewSince
    @Environment(\.xdriveNativePhotoQueueBadgeRefresh) private var badgeRefresh
    @Environment(\.xdriveNativePhotoPriorityAction) private var priorityAction

    private func displayedBackupState(for row: XDriveIOSNativeUnifiedPhoto) -> String {
        guard let local = row.local else { return "unverified" }
        if activeProcessingID == local.id { return "processing" }
        let queued = queueBadges[local.id]?.state
        // A pending newer edit or failure takes precedence over a previously
        // matched original. A fresh same-content Gallery match is stronger
        // than the queue's historical confirmed receipt, but still not a
        // promise that the cloud Node will exist indefinitely.
        if let queued, queued != "confirmed" { return queued }
        if row.presence == .both { return "matched" }
        if queued == "confirmed" { return "confirmed" }
        guard queueHistoryCurrent, let since = onlyNewSince else { return "unverified" }
        switch XDriveIOSPhotoAutoSchedulePolicy.newOnlyCandidate(
            capturedAt: local.capturedAt, modifiedAt: local.modifiedAt, since: since
        ) {
        case .olderThanStart: return "excluded"
        default: return "unverified"
        }
    }

    private func readVisibleQueueBadges() async {
        let epoch = UUID()
        badgeReadEpoch = epoch
        // The unified wall holds at most 48 current rows; only read local IDs.
        let ids = model.rows.compactMap { $0.local?.id }
        let sameOwner = XDriveIOSNativePhotoOwnerScope.matches(backupBadgeOwner, owner) &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
        guard ids.count <= 48, visible, displayActive, sameOwner, !ids.isEmpty else {
            // A Viewer/People/tab cover must not remove verified badge pixels
            // only to reinsert them after the asynchronous return read.
            // True offscreen eviction, disabled backup, changed Owner or empty
            // range still clears the old statuses before they can be displayed.
            if !retainWhileCovered || !sameOwner || ids.isEmpty || ids.count > 48 {
                queueBadges = [:]
                queueHistoryCurrent = false
            }
            return
        }
        // A same-Owner visible refresh keeps its last verified badges until
        // the current epoch finishes; the async result below atomically
        // updates both the state and caught-up flag.
        do {
            let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: owner)
            let fetched = try await queue.visibleStatusDetails(
                owner: owner, localIdentifiers: ids
            )
            let isCurrent = try await queue.isCaughtUp(owner: owner)
            try Task.checkCancellation()
            guard badgeReadEpoch == epoch, visible, displayActive,
                  XDriveIOSNativePhotoOwnerScope.matches(backupBadgeOwner, owner),
                  model.rows.compactMap({ $0.local?.id }) == ids else { return }
            queueBadges = fetched
            queueHistoryCurrent = isCurrent
        } catch is CancellationError {
            // Covering a verified page cancels its in-flight queue read.
            // Cancellation alone is not evidence that the last committed
            // same-Owner badges expired; keep them until the next visible read.
            // Revoked Owner or true offscreen eviction must still clear them.
            if badgeReadEpoch == epoch &&
                (!retainWhileCovered ||
                 !XDriveIOSNativePhotoOwnerScope.matches(backupBadgeOwner, owner) ||
                 !XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)) {
                queueBadges = [:]
                queueHistoryCurrent = false
            }
        } catch {
            if badgeReadEpoch == epoch {
                queueBadges = [:]
                queueHistoryCurrent = false
            }
        }
    }

    var body: some View {
        content
            .background(GeometryReader { geometry in
                Color.clear.preference(key: XDriveUnifiedPageHeight.self, value: geometry.size.height)
            })
            .onPreferenceChange(XDriveUnifiedPageHeight.self) { height in
                if model.completed { wall.measure(page: page.id, height: Double(height)) }
            }
            .onAppear { visible = true }
            .onDisappear {
                visible = false
                if !retainWhileCovered {
                    acceptedGeneration = nil
                    queueBadges = [:]
                    queueHistoryCurrent = false
                    badgeReadEpoch = UUID()
                    model.reset()
                }
            }
            .onChange(of: backupBadgeOwner) { _ in
                Task { await readVisibleQueueBadges() }
            }
            .onChange(of: badgeRefresh) { _ in
                // Refresh only this mounted 48-row page after a shared writer
                // completes. Preserve Gallery generation and scroll anchor.
                Task { await readVisibleQueueBadges() }
            }
            .onChange(of: onlyNewSince) { _ in
                Task { await readVisibleQueueBadges() }
            }
            .task(id: "\(visible):\(displayActive):\(retry)") {
                guard visible, displayActive, wall.failure == nil,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else {
                    if !retainWhileCovered {
                        acceptedGeneration = nil
                        model.reset()
                    }
                    return
                }
                let ticket = wall.generation
                // Keep only an exact previously verified 48-row range on
                // child/Viewer return; ordinary scroll eviction still drops it.
                if acceptedGeneration == ticket, model.completed,
                   model.belongs(to: login.owner) {
                    loaded(model.rows.map(\.id))
                    await readVisibleQueueBadges()
                    return
                }
                await model.load(from: page.start, filter: filter, login: login, query: query, library: wall.library)
                guard !Task.isCancelled, visible, displayActive, wall.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else {
                    if !retainWhileCovered {
                        acceptedGeneration = nil
                        model.reset()
                    }
                    return
                }
                if wall.accept(model, page: page.id) {
                    acceptedGeneration = ticket
                    loaded(model.rows.map(\.id))
                    await readVisibleQueueBadges()
                }
            }
    }

    @ViewBuilder private var content: some View {
        // Unverified thumbnails are browsable before local/remote sources
        // reconcile. Never treat provisional tiles as proven paired, or
        // advance mixed cursor pagination until the bounded window commits.
        if model.belongs(to: login.owner) &&
            (model.completed || (!model.rows.isEmpty && filter == nil && query == .init())) {
            let sections = xdriveIOSNativePhotoWallVisibleSections(
                model.rows, scale: timeScale
            ) { timeScale.key(for: $0.capturedAt) }
            VStack(alignment: .leading, spacing: 10) {
                XDriveIOSNativePhotoWallSectionList(
                    sections: sections, density: density,
                    title: { section in
                        guard timeScale != .all else { return nil }
                        // Only the current generation's adjacent *completed*
                        // pages may suppress the repeated first heading.
                        if section.id == 0 && model.completed &&
                           wall.continuesPreviousDate(
                               page: page.id,
                               firstCapturedAt: section.items.first?.capturedAt,
                               scale: timeScale
                           ) { return nil }
                        return timeScale.label(for: section.key)
                    },
                    items: { $0.items }
                ) { row in
                            Button {
                                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                                      let position = model.rows.firstIndex(where: { $0.id == row.id }) else { return }
                                open(.init(number: page.id, rows: model.rows), position)
                            } label: {
                                ZStack(alignment: .topLeading) {
                                    XDriveIOSUnifiedPhotoTile(
                                        row: row, login: login, presentingOwner: owner,
                                        displayActive: displayActive,
                                        retainWhileCovered: retainWhileCovered,
                                        framing: framing
                                    )
                                    if let local = row.local, backupBadgeOwner != nil,
                                       let badge = XDriveIOSNativeVisiblePhotoQueueBadgePolicy.badge(
                                        for: displayedBackupState(for: row),
                                        failureReasonCode: queueBadges[local.id]?.failureReasonCode
                                       ) {
                                        Label(badge.title, systemImage: badge.symbol)
                                            .font(.system(size: 9, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 3)
                                            .background(Color.black.opacity(0.7), in: Capsule())
                                            .padding(3)
                                            .accessibilityHidden(true)
                                    }
                                }
                            }
                            .buttonStyle(.plain).id(row.id)
                            .accessibilityLabel("\(row.isLive ? "实况照片" : row.isVideo ? "视频" : "照片")，\(row.presence.title)")
                            .contextMenu {
                                Button("来源与核对详情") { pairing(row) }
                                if let local = row.local, let priorityAction {
                                    Button(queueBadges[local.id]?.state == "failed"
                                        ? "核对并重试失败原件" : "优先备份此原件") {
                                        priorityAction(
                                            local.id, queueBadges[local.id]?.state == "failed"
                                        )
                                    }
                                }
                            }
                }
                if model.rows.isEmpty {
                    XDriveIOSNativePhotoWallStatusMessage(
                        message: model.next == nil ? "已浏览到底，没有更多符合条件的照片" : "正在查找符合条件的照片…",
                        minHeight: 36
                    )
                }
                if !model.completed {
                    XDriveIOSNativePhotoWallLoadingMessage(
                        message: "正在加载当前页面与来源状态…",
                        accessibilityID: "native-ios-gallery-visible-proof"
                    )
                }
                if let message = model.notice {
                    XDriveIOSNativePhotoWallStatusMessage(message: message)
                }
            }
        } else {
            VStack(spacing: 8) {
                if let message = model.notice {
                    XDriveIOSNativePhotoWallRetryMessage(
                        message: message,
                        buttonTitle: "重新读取",
                        canRetry: visible && displayActive && wall.failure == nil &&
                            XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                    ) { retry = UUID() }
                } else if visible && displayActive {
                    XDriveIOSNativePhotoWallLoadingMessage(message: "正在读取照片与缩略图…")
                }
            }
            .frame(maxWidth: .infinity, minHeight: page.height)
        }
    }
}
