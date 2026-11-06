import Combine
import Photos
import SwiftUI
import UIKit

private final class XDriveIOSUnifiedPhotoObserver: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var change = UUID()
    private var observing = false

    func start() {
        guard !observing else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
    }

    func stop() {
        guard observing else { return }
        observing = false
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.observing else { return }
            self.change = UUID()
        }
    }

    deinit { stop() }
}

@MainActor
struct XDriveIOSNativeUnifiedPhotoGallery: View {
    private enum Selection: Identifiable {
        case local(XDrivePhotoKitScanCandidate, XDriveIOSNativeUnifiedPhoto, XDriveNativeOwnerRoot)
        case cloud(XDriveIOSNativeMediaItem, XDriveNativeOwnerRoot)

        var id: String {
            switch self {
            case .local(let asset, _, _): return "local:" + asset.id
            case .cloud(let item, _): return "cloud:\(item.id)"
            }
        }
    }

    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let openBackup: () -> Void
    @StateObject private var timeline = XDriveIOSNativeUnifiedPhotoTimeline()
    @StateObject private var photoObserver = XDriveIOSUnifiedPhotoObserver()
    @State private var selected: Selection?
    @State private var sourceFilter: XDriveIOSNativeGalleryPresence?
    @State private var cursor = XDriveIOSNativeGalleryCursor()
    @State private var history: [XDriveIOSNativeGalleryCursor] = []
    @State private var request = UUID()
    @State private var indexRequest = UUID()
    @State private var retryUnavailable = false
    @State private var viewerReturnAnchor: String?
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var cloudOpen: Task<Void, Never>?
    @State private var failure: String?
    @Environment(\.scenePhase) private var phase

    private var visibleRows: [XDriveIOSNativeUnifiedPhoto] {
        guard timeline.belongs(to: login.owner) else { return [] }
        return timeline.rows
    }

    var body: some View {
        galleryContent
        .accessibilityIdentifier("native-ios-unified-photo-gallery")
        .task(id: request) {
            guard phase == .active, selected == nil else { return }
            await timeline.load(from: cursor, filter: sourceFilter, login: login)
        }
        .task(id: indexRequest) {
            guard phase == .active, selected == nil else { return }
            await timeline.scanLocal(login: login, retryUnavailable: retryUnavailable)
        }
        .onAppear { photoObserver.start() }
        .onDisappear {
            photoObserver.stop()
            cloudOpen?.cancel()
        }
        .onChange(of: photoObserver.change) { _ in reset() }
        .onChange(of: login.owner) { _ in
            sourceFilter = nil
            reset()
        }
        .onChange(of: sourceFilter) { _ in
            cloudOpen?.cancel()
            selected = nil
            failure = nil
            resetPage()
        }
        .onChange(of: timeline.indexRevision) { _ in request = UUID() }
        .onChange(of: selected?.id) { _ in
            request = UUID()
            indexRequest = UUID()
        }
        .onChange(of: phase) { state in
            if state == .active { reset() }
            else {
                selected = nil
                cloudOpen?.cancel()
                timeline.reset()
                request = UUID()
                indexRequest = UUID()
            }
        }
        .fullScreenCover(item: $selected) { selection in
            NavigationStack {
                switch selection {
                case .local(let asset, let row, let owner):
                    XDriveIOSNativeLocalPhotoDetail(
                        candidate: asset, loadedItems: visibleRows.compactMap(\.local),
                        onViewed: { viewerReturnAnchor = "local:" + $0.id }
                    )
                        .toolbar {
                            if row.match != nil {
                                ToolbarItem(placement: .navigationBarTrailing) {
                                    Button { openCloud(row, expected: owner) } label: {
                                        Label("云端副本", systemImage: "icloud")
                                    }
                                }
                            }
                        }
                case .cloud(let item, let owner):
                    XDriveIOSNativeServerMediaPreview(item: item, login: login, openedOwner: owner)
                }
            }
        }
    }

    private var galleryContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            filters.padding(.horizontal, 12).padding(.vertical, 4)
            Divider()
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        galleryStatus.id("gallery-page-top")
                        photoGrid
                        paging
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .refreshable { reset(retryUnavailable: true) }
                .onChange(of: cursor) { _ in
                    scroll.scrollTo("gallery-page-top", anchor: .top)
                }
                .onChange(of: timeline.loading) { loading in
                    if !loading, selected == nil, let anchor = viewerReturnAnchor,
                       visibleRows.contains(where: { $0.id == anchor }) {
                        scroll.scrollTo(anchor, anchor: .center)
                        viewerReturnAnchor = nil
                    }
                }
            }
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                filterButton(nil, title: "全部")
                ForEach(XDriveIOSNativeGalleryPresence.allCases) { presence in
                    filterButton(presence, title: presence.title)
                }
            }
        }
        .accessibilityIdentifier("native-ios-unified-gallery-filters")
    }

    private func filterButton(_ value: XDriveIOSNativeGalleryPresence?, title: String) -> some View {
        Button {
            sourceFilter = value
        } label: {
            Text(title).font(.subheadline.weight(.medium))
                .padding(.vertical, 8).padding(.horizontal, 12)
                .background(sourceFilter == value ? Color.accentColor.opacity(0.18) : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(sourceFilter == value ? .isSelected : [])
    }

    @ViewBuilder
    private var galleryStatus: some View {
        if permission == .notDetermined {
            Button("允许查看本机照片") {
                Task {
                    _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                    reset()
                }
            }
            .buttonStyle(.bordered)
        } else if permission != .authorized {
            Text("本机照片权限有限，无法确认的来源会显示「待核验」。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        if let message = failure ?? timeline.notice {
            Label(message, systemImage: "info.circle")
                .font(.footnote).foregroundStyle(.secondary)
        }
        if let status = timeline.coverage, !status.finished {
            ProgressView("正在核对本机原件 (status.checked) / (status.total)",
                         value: Double(status.checked), total: Double(max(1, status.total)))
                .font(.footnote)
        } else if let status = timeline.coverage, status.unavailable > 0 {
            Text("\(status.unavailable) 项本机原件暂不可读。原件可用后可下拉重新核对。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        if timeline.loading {
            ProgressView(sourceFilter == nil ? "读取并核对照片…" : "查找符合条件的照片…")
                .font(.footnote)
        }
    }

    private var photoGrid: some View {
        let groups = Dictionary(grouping: visibleRows) { row in
            row.capturedAt.map { Calendar.current.startOfDay(for: $0) }
        }
        let days = groups.keys.sorted { ($0 ?? .distantPast) > ($1 ?? .distantPast) }
        let presentingOwner = login.owner
        return ForEach(days, id: \.self) { day in
            VStack(alignment: .leading, spacing: 6) {
                Text(day?.formatted(date: .abbreviated, time: .omitted) ?? "拍摄日期未知")
                    .font(.headline)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)], spacing: 4) {
                    if let presentingOwner {
                        ForEach(groups[day] ?? []) { row in
                            tile(row, owner: presentingOwner)
                                .id(row.id)
                        }
                    }
                }
            }
        }
    }

    private func tile(_ row: XDriveIOSNativeUnifiedPhoto, owner: XDriveNativeOwnerRoot) -> some View {
        Button {
            guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
            viewerReturnAnchor = row.id
            if let local = row.local { selected = .local(local, row, owner) }
            else { openCloud(row, expected: owner) }
        } label: {
            XDriveIOSUnifiedPhotoTile(row: row, login: login, presentingOwner: owner)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(row.isLive ? "实况照片" : row.isVideo ? "视频" : "照片")，\(row.presence.title)")
        .contextMenu {
            if row.local != nil && row.match != nil {
                Button { openCloud(row, expected: owner) } label: {
                    Label("查看云端副本", systemImage: "icloud")
                }
            }
            if row.presence == .localOnly {
                Button(action: openBackup) {
                    Label("打开相册备份", systemImage: "icloud.and.arrow.up")
                }
            }
        }
    }

    private var paging: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !timeline.loading && visibleRows.isEmpty {
                Text(timeline.next == nil ? "暂无更多符合条件的照片" : "这段时间暂无符合条件的照片")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Button("较新") {
                    if let previous = history.popLast() {
                        cursor = previous
                        request = UUID()
                    }
                }
                .disabled(history.isEmpty || timeline.loading)
                Spacer()
                Button("回到最新") { reset() }.disabled(cursor == XDriveIOSNativeGalleryCursor())
                Spacer()
                Button(visibleRows.isEmpty && sourceFilter != nil ? "继续查找" : "更早") {
                    guard let next = timeline.next else { return }
                    history.append(cursor)
                    if history.count > 128 { history.removeFirst() }
                    cursor = next
                    request = UUID()
                }
                .disabled(timeline.next == nil || timeline.loading)
            }
            .buttonStyle(.bordered)
        }
    }

    private func reset(retryUnavailable: Bool = false) {
        cloudOpen?.cancel()
        selected = nil
        failure = nil
        viewerReturnAnchor = nil
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        timeline.reset()
        self.retryUnavailable = retryUnavailable
        indexRequest = UUID()
        resetPage()
    }

    private func resetPage() {
        history = []
        cursor = XDriveIOSNativeGalleryCursor()
        request = UUID()
    }

    private func openCloud(_ row: XDriveIOSNativeUnifiedPhoto, expected: XDriveNativeOwnerRoot) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
        cloudOpen?.cancel()
        viewerReturnAnchor = row.id
        let started = request
        cloudOpen = Task {
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else { return }
                let item: XDriveIOSNativeMediaItem
                if let match = row.match {
                    item = try await XDriveIOSNativeMediaGalleryReader(
                        owner: expected, accessToken: auth.accessToken
                    ).matchedMedia(match)
                } else if let current = row.cloud {
                    item = current
                } else { return }
                try Task.checkCancellation()
                guard request == started, XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                selected = .cloud(item, expected)
            } catch is CancellationError {
            } catch {
                guard request == started, XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                failure = "当前云端副本无法确认，请刷新图库后重试。"
            }
        }
    }
}

@MainActor
private struct XDriveIOSUnifiedPhotoTile: View {
    let row: XDriveIOSNativeUnifiedPhoto
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let presentingOwner: XDriveNativeOwnerRoot
    @StateObject private var local = XDriveIOSPhotoImageLoader()
    @State private var remote: UIImage?
    @State private var fallback: Task<Void, Never>?

    var body: some View {
        Rectangle().fill(.quaternary)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image = local.image ?? remote {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: row.isVideo ? "play.rectangle" : "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .overlay(alignment: .bottomLeading) {
                Label(row.presence.title, systemImage: row.presence.symbol)
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .font(.caption2.weight(.semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 3)
                    .background(.black.opacity(0.72), in: Capsule())
                    .padding(4)
            }
            .task(id: "\(row.id):\(row.match?.node_id ?? 0):\(row.cloud?.node.revision ?? 0):\(row.cloud?.metadata.thumbnail_version ?? "")") {
                remote = nil
                if let asset = row.local {
                    local.load(asset.id, size: CGSize(width: 280, height: 280), allowICloud: false)
                } else if let item = row.cloud {
                    await loadCloud(item, match: nil)
                }
            }
            .onChange(of: local.isLoading) { loading in
                if !loading, local.image == nil, row.cloud != nil || row.match != nil {
                    fallback?.cancel()
                    fallback = Task { await loadCloud(row.cloud, match: row.match) }
                }
            }
            .onDisappear {
                fallback?.cancel()
                local.cancel()
                remote = nil
            }
    }

    private func loadCloud(_ item: XDriveIOSNativeMediaItem?, match: XDriveIOSNativeExactPhotoMatch?) async {
        let owner = presentingOwner
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
              let auth = try? await login.verifiedAuthorization(),
              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        let reader = XDriveIOSNativeMediaGalleryReader(owner: owner, accessToken: auth.accessToken)
        let image = try? await XDriveIOSNativeFilesThumbnailSlots.shared.perform {
            if let item { return try await reader.cachedGalleryThumbnail(item) }
            guard let match else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
            let matched = try await reader.matchedMedia(match)
            return try await reader.cachedGalleryThumbnail(matched)
        }
        guard let image,
              !Task.isCancelled,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        remote = image
    }
}
