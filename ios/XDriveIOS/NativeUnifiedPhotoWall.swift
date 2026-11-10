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
    @Published private(set) var failure: String?
    private(set) var library: Data?

    func reset() {
        generation = UUID()
        index = .init(start: .init())
        library = (try? XDriveIOSPhotoKitLibraryEpoch.capture())?.serialized
        failure = nil
    }

    func accept(_ model: XDriveIOSNativeUnifiedPhotoTimeline, page: Int) -> Bool {
        guard model.completed else { return false }
        guard index.commit(page: page, count: model.rows.count, next: model.next) else {
            failure = "图库排序或配对结果已变化，请刷新以继续浏览。"
            return false
        }
        return true
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
    let displayActive: Bool
    let retainWhileCovered: Bool
    let open: (XDriveIOSNativeUnifiedGalleryPage, Int) -> Void
    let loaded: () -> Void
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
        queueHistoryCurrent = false
        // The unified wall holds at most 48 current rows; only read local IDs.
        let ids = model.rows.compactMap { $0.local?.id }
        guard ids.count <= 48, visible, displayActive,
              XDriveIOSNativePhotoOwnerScope.matches(backupBadgeOwner, owner),
              !ids.isEmpty else {
            queueBadges = [:]
            return
        }
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
        } catch {
            if badgeReadEpoch == epoch { queueBadges = [:] }
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
                    loaded()
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
                    loaded()
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
            let groups = Dictionary(grouping: model.rows) { $0.capturedAt.map { Calendar.current.startOfDay(for: $0) } }
            let days = groups.keys.sorted { ($0 ?? .distantPast) > ($1 ?? .distantPast) }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(days, id: \.self) { day in
                    XDriveIOSNativePhotoWallDayHeader(title: day?.formatted(date: .abbreviated, time: .omitted) ?? "拍摄日期未知")
                    XDriveIOSNativePhotoWallGrid(density: density) {
                        ForEach(groups[day] ?? []) { row in
                            Button {
                                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                                      let position = model.rows.firstIndex(where: { $0.id == row.id }) else { return }
                                open(.init(number: page.id, rows: model.rows), position)
                            } label: {
                                ZStack(alignment: .topLeading) {
                                    XDriveIOSUnifiedPhotoTile(
                                        row: row, login: login, presentingOwner: owner,
                                        displayActive: displayActive,
                                        retainWhileCovered: retainWhileCovered
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
