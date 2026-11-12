import Combine
import Photos
import SwiftUI
import UIKit

final class XDriveIOSUnifiedPhotoObserver: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
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
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let openBackup: () -> Void
    let priorityBackup: (String) -> Void
    let isTabActive: Bool
    // The parent presents the existing shared MapKit route as an overlay.
    // Keeping this Gallery mounted preserves its query, grid density and
    // real PhotoKit/Owner page cursor on the return from native MapKit.
    var onShowMap: ((XDriveIOSNativePhotoMapCaptureRange?, XDriveIOSNativePhotoMediaFilter, String) -> Void)? = nil
    @StateObject private var timeline = XDriveIOSNativeUnifiedPhotoTimeline()
    @StateObject private var wall = XDriveIOSNativeUnifiedPhotoWall()
    @StateObject private var photoObserver = XDriveIOSUnifiedPhotoObserver()
    @State private var selected: XDriveIOSNativeUnifiedGallerySelection?
    // Explicit child NavigationLink state is available before parent onDisappear.
    @State private var showingPeople = false
    @State private var showingThumbnailCache = false
    @State private var sourceFilter: XDriveIOSNativeGalleryPresence?
    @State private var wallDensity: XDriveIOSNativePhotoWallDensity = .standard
    @State private var query = XDriveIOSNativeUnifiedGalleryQuery()
    @State private var draft = XDriveIOSNativeUnifiedGalleryQuery()
    @State private var showFilters = false
    @State private var openMapAfterFilterDismiss = false
    @State private var openSourceMapAfterFilterDismiss = false
    @State private var showingSourceFilteredMap = false
    @State private var pendingMapCaptureRange: XDriveIOSNativePhotoMapCaptureRange?
    @State private var pendingMapMediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    @State private var pendingMapFilenameTerm = ""
    @State private var pairing: XDriveIOSNativeUnifiedPhoto?
    @State private var indexRequest = UUID()
    @State private var retryUnavailable = false
    @State private var explicitOriginalAudit = false
    @State private var viewerReturnAnchor: String?
    @State private var viewerReturnPage = 0
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var started = false
    @Environment(\.scenePhase) private var phase

    var body: some View {
        galleryContent
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("native-ios-unified-photo-gallery")
            .accessibilityValue(galleryWallGenerationDiagnostic)
            .task(id: indexRequest) {
                // Viewing thumbnails must never start a whole-library SHA-256
                // job. A user explicitly starts the optional read-only audit.
                guard explicitOriginalAudit, phase == .active, selected == nil else { return }
                let request = indexRequest
                await timeline.scanLocal(login: login, retryUnavailable: retryUnavailable)
                if indexRequest == request { explicitOriginalAudit = false }
            }
            .onAppear {
                photoObserver.start()
                if !started {
                    started = true
                    wall.reset()
                } else {
                    validateForegroundWall()
                }
            }
            .onDisappear {
                photoObserver.stop()
                // Child NavigationLinks (People and thumbnail cache) can hide
                // this wall without a Viewer selection. Preserve its verified
                // page index and return position; visible page tiles may retire
                // decoded media independently. Owner, scene and changed PhotoKit
                // epochs still invalidate on their own explicit boundaries.
                explicitOriginalAudit = false
                indexRequest = UUID()
            }
            .onChange(of: photoObserver.change) { _ in reset() }
            .onChange(of: login.owner) { _ in
                showingPeople = false; showingThumbnailCache = false
                sourceFilter = nil; query = .init(); draft = .init()
                openMapAfterFilterDismiss = false
                openSourceMapAfterFilterDismiss = false
                showingSourceFilteredMap = false
                pendingMapCaptureRange = nil
                pendingMapMediaFilter = .all
                pendingMapFilenameTerm = ""
                reset()
            }
            .onChange(of: sourceFilter) { _ in
                // A query/presence transition is not authority to reuse old
                // map markers while a full-screen source map is visible.
                showingSourceFilteredMap = false
                openSourceMapAfterFilterDismiss = false
                resetWall()
            }
            .onChange(of: query) { _ in
                showingSourceFilteredMap = false
                resetWall()
            }
            .onChange(of: timeline.indexRevision) { _ in resetWall() }
            .onChange(of: selected?.id) { _ in
                // Leaving the page for Viewer also retires any explicit
                // audit. A returned Viewer must never restart SHA reads.
                explicitOriginalAudit = false
                indexRequest = UUID()
            }
            .onChange(of: phase) { state in
                if state == .active {
                    // Same Owner, PhotoKit authorization and epoch: the
                    // visible 48-row pages and thumbnails are still valid.
                    validateForegroundWall()
                } else {
                    explicitOriginalAudit = false
                    selected = nil
                    indexRequest = UUID()
                    // Keep the bounded verified page state for a same-grant
                    // foreground return. Tiles hide pixels while inactive;
                    // any changed Owner/PhotoKit grant/epoch resets on return.
                }
            }
            .sheet(isPresented: $showFilters, onDismiss: {
                // UIKit cannot present the map while the filter editor sheet
                // is still being dismissed. The owning Gallery remains live
                // underneath; no source/page/filter state is rebuilt here.
                if openSourceMapAfterFilterDismiss {
                    openSourceMapAfterFilterDismiss = false
                    showingSourceFilteredMap = true
                    return
                }
                guard openMapAfterFilterDismiss else { return }
                openMapAfterFilterDismiss = false
                let selectedRange = pendingMapCaptureRange
                let selectedMedia = pendingMapMediaFilter
                let selectedFilename = pendingMapFilenameTerm
                pendingMapCaptureRange = nil
                pendingMapMediaFilter = .all
                pendingMapFilenameTerm = ""
                onShowMap?(selectedRange, selectedMedia, selectedFilename)
            }) { filterEditor }
            .sheet(item: $pairing) { row in
                XDriveIOSNativePhotoPairingDetails(
                    row: row, retry: { reset() }, backup: openBackup,
                    priorityBackup: priorityBackup
                )
            }
            .fullScreenCover(item: $selected) { selection in
                XDriveIOSNativeUnifiedPhotoViewer(login: login, wall: wall, selection: selection,
                    filter: sourceFilter, query: query,
                    onViewed: { page, id in viewerReturnPage = page; viewerReturnAnchor = id },
                    pairing: { _ in reset() })
            }
            .fullScreenCover(isPresented: $showingSourceFilteredMap) {
                if let presence = sourceFilter {
                    NavigationStack {
                        XDriveIOSNativeUnifiedSourcePhotoMapScreen(
                            login: login, presence: presence, query: query,
                            onClose: { showingSourceFilteredMap = false })
                    }
                } else {
                    Text("来源筛选已变化，请重新打开地图。")
                        .accessibilityIdentifier("native-ios-unified-source-map-invalidated")
                }
            }
    }

    private var galleryContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button { draft = query; showFilters = true } label: {
                    Label(query == .init() ? "搜索与筛选" : "已筛选", systemImage: "line.3.horizontal.decrease.circle")
                }
                .accessibilityIdentifier("native-ios-gallery-open-filters")
                // The native Photos-style menu applies the *committed* filter.
                // Unsubmitted sheet edits are never allowed to leak into it.
                if onShowMap != nil {
                    Menu {
                        Button("排序和筛选") {
                            draft = query
                            showFilters = true
                        }
                        Button {
                            showMapForAppliedQuery()
                        } label: {
                            Label("显示地图", systemImage: "map")
                        }
                        .disabled(mapUnavailableReason(for: query) != nil)
                        .accessibilityIdentifier("native-ios-gallery-sort-filter-show-map")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("排序和筛选")
                    .accessibilityIdentifier("native-ios-gallery-sort-filter-menu")
                }
                Spacer()
                if query != .init() { Button("清除") { query = .init() } }
                Menu {
                    xdrivePhotoWallDensityButtons($wallDensity)
                } label: {
                    Image(systemName: "square.grid.3x3")
                }
                .accessibilityLabel("缩略图大小")
                .accessibilityIdentifier("native-ios-unified-wall-density")
                NavigationLink(isActive: $showingThumbnailCache) {
                    XDriveIOSNativePhotoThumbnailCacheScreen(login: login)
                } label: {
                    Image(systemName: "internaldrive")
                }.accessibilityLabel("管理缩略图缓存")
                Menu {
                    Button("手动核对所有本机原件（耗时）") {
                        requestOriginalAudit(retryUnavailable: false)
                    }
                } label: {
                    Image(systemName: "checkmark.shield")
                }
                .accessibilityLabel("手动核对本机原件")
                .accessibilityIdentifier("native-ios-gallery-explicit-audit")
            }.padding(.horizontal, 12).padding(.vertical, 4)
            filters.padding(.horizontal, 12).padding(.vertical, 4)
            Divider()
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        galleryStatus.id("gallery-page-top")
                        if let owner = login.owner {
                            ForEach(wall.index.pages) { page in
                                XDriveIOSNativeUnifiedPhotoWallPage(page: page, wall: wall, login: login, owner: owner,
                                    filter: sourceFilter, query: query, density: wallDensity,
                                    displayActive: selected == nil && phase == .active && isTabActive,
                                     // A tab switch covers a loaded 48-row
                                     // window; ordinary off-screen scrolling
                                     // while the Gallery is active still evicts.
                                     retainWhileCovered: selected != nil ||
                                         showingPeople || showingThumbnailCache ||
                                         phase != .active || !isTabActive,
                                    open: { payload, position in
                                        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                                        selected = .init(owner: owner, page: payload, position: position)
                                    }, loaded: {
                                        if selected == nil, let anchor = viewerReturnAnchor, viewerReturnPage == page.id {
                                            scroll.scrollTo(anchor, anchor: .center)
                                            viewerReturnAnchor = nil
                                        }
                                    }, pairing: { pairing = $0 })
                                    .id("unified-page-\(page.id)")
                            }
                        }
                    }
                    .id(wall.generation)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
                .refreshable { reset() }
                .simultaneousGesture(
                    MagnificationGesture(minimumScaleDelta: 0.14).onEnded { scale in
                        guard selected == nil, phase == .active, !showFilters else { return }
                        wallDensity = wallDensity.applyingPinch(scale)
                    }
                )
                .onChange(of: selected?.id) { selection in
                    if selection == nil, viewerReturnAnchor != nil {
                        scroll.scrollTo("unified-page-\(viewerReturnPage)", anchor: .top)
                    }
                }
                .onChange(of: wall.generation) { _ in scroll.scrollTo("gallery-page-top", anchor: .top) }
            }
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                NavigationLink(isActive: $showingPeople) {
                    XDriveIOSNativeGalleryPeople(login: login)
                } label: { Label("人物", systemImage: "person.2") }
                .accessibilityIdentifier("native-ios-gallery-people")
                filterButton(nil, title: "全部")
                ForEach(XDriveIOSNativeGalleryPresence.allCases) { presence in filterButton(presence, title: presence.title) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-ios-unified-gallery-filters")
    }

    private func filterButton(_ value: XDriveIOSNativeGalleryPresence?, title: String) -> some View {
        Button { sourceFilter = value } label: {
            Text(title).font(.subheadline.weight(.medium)).padding(.vertical, 8).padding(.horizontal, 12)
                .background(sourceFilter == value ? Color.accentColor.opacity(0.18) : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain).accessibilityAddTraits(sourceFilter == value ? .isSelected : [])
    }

    @ViewBuilder private var galleryStatus: some View {
        if permission == .notDetermined {
            Button("允许查看本机照片") {
                Task { _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite); reset() }
            }.buttonStyle(.bordered)
        } else if permission != .authorized {
            HStack {
                Text("照片权限有限，无法确认的来源会显示「待核验」。").font(.footnote)
                Button("设置") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        }
        if let message = wall.failure ?? timeline.notice {
            XDriveIOSNativePhotoWallRetryMessage(
                message: message, buttonTitle: "重新读取",
                canRetry: selected == nil && phase == .active,
                systemImage: "info.circle"
            ) { reset() }
        }
        if let status = timeline.coverage, !status.finished {
            ProgressView("正在核对本机原件 \(status.checked) / \(status.total)",
                         value: Double(status.checked), total: Double(max(1, status.total))).font(.footnote)
        } else if let status = timeline.coverage, status.unavailable > 0 {
            Text("\(status.unavailable) 项本机原件暂不可读；其他已确认的匹配仍可浏览。").font(.footnote).foregroundStyle(.secondary)
            Button("重新核对暂不可读的原件") { requestOriginalAudit(retryUnavailable: true) }
        }
        if sourceFilter == .cloudOnly {
            Text("“仅云端”仅显示已确认本机没有相同原件的照片；想浏览全部云端照片，请使用上方“单独浏览 → 云端图库”。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        if query != .init() {
            Text("\(query.media.title)\(query.term.isEmpty ? "" : " · 文件名包含「\(query.term)」")")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var filterEditor: some View {
        NavigationStack {
            Form {
                Section("搜索本机与云端文件名") {
                    TextField("文件名", text: $draft.text).submitLabel(.search)
                        .onSubmit { applyQuery() }
                }
                Section("媒体类型") { Picker("类型", selection: $draft.media) {
                    ForEach(XDriveIOSNativeUnifiedGalleryQuery.Media.allCases) { Text($0.title).tag($0) }
                } }
                Section("拍摄日期") {
                    Toggle("限定日期范围", isOn: Binding(get: { draft.from != nil }, set: { enabled in
                        draft.from = enabled ? Calendar.current.date(byAdding: .year, value: -1, to: Calendar.current.startOfDay(for: Date())) : nil
                        draft.until = enabled ? Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())) : nil
                    }))
                    if draft.from != nil {
                        DatePicker("开始", selection: Binding(get: { draft.from ?? Date() }, set: { draft.from = Calendar.current.startOfDay(for: $0) }), displayedComponents: .date)
                        DatePicker("结束（含当天）", selection: Binding(get: {
                            (draft.until ?? Date()).addingTimeInterval(-1)
                        }, set: {
                            draft.until = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: $0))
                        }), displayedComponents: .date)
                    }
                    Text("两端匹配的照片按本机拍摄日期排列；日期未知的照片只在不限日期时显示。").font(.footnote)
                }
                if onShowMap != nil {
                    Section("地图") {
                        Button {
                            guard mapUnavailableReason == nil, draft.isValid
                            else { return }
                            // Commit any in-flight filter edits first so the
                            // Gallery shown after MapKit has the same date
                            // criteria as the map that was just opened.
                            query = draft
                            if sourceFilter != nil {
                                // A source filter cannot borrow the ordinary
                                // local/Owner map. Dismiss the editor before
                                // presenting the exact reconciled source map.
                                openSourceMapAfterFilterDismiss = true
                            } else {
                                pendingMapCaptureRange = representableMapCaptureRange
                                pendingMapMediaFilter = representableMapMediaFilter
                                pendingMapFilenameTerm = draft.term
                                openMapAfterFilterDismiss = true
                            }
                            showFilters = false
                        } label: {
                            Label("显示地图", systemImage: "map")
                        }
                        .disabled(mapUnavailableReason != nil || !draft.isValid)
                        .accessibilityIdentifier("native-ios-unified-gallery-show-map")
                        Text(mapUnavailableReason ??
                             (sourceFilter != nil
                                 ? "按当前已核验的来源成员显示地图；缺失证据时不显示未经验证的位置或数量。"
                                 : "地图在当前本机 PhotoKit 和 Owner 云端分别执行文件名、媒体类型及日期过滤，Owner 身份独立复核。"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-unified-gallery-map-scope")
                    }
                }
            }
            .navigationTitle("搜索与筛选").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { showFilters = false } }
                ToolbarItem(placement: .confirmationAction) { Button("应用") { applyQuery() }.disabled(!draft.isValid) }
            }
        }
    }

    // The unified photo wall can filter source identity, filenames, media
    // subtypes and arbitrary date criteria, while the existing native
    // MapKit routes have separate PhotoKit/Owner scopes. Refuse every
    // predicate that MapKit cannot represent *exactly*; never display an
    // unfiltered map under an actively filtered Gallery heading.
    private var mapUnavailableReason: String? { mapUnavailableReason(for: draft) }

    private func mapUnavailableReason(
        for criteria: XDriveIOSNativeUnifiedGalleryQuery
    ) -> String? {
        if sourceFilter != nil {
            guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                  login.owner != nil else {
                return "来源地图需完整本机照片权限与已登录的云端 Owner。"
            }
        }
        if !criteria.isValid {
            return "请先修正日期范围或搜索条件。"
        }
        if criteria.from != nil || criteria.until != nil {
            guard let from = criteria.from, let until = criteria.until,
                  XDriveIOSNativePhotoMapCaptureRange(
                    from: from, to: until, label: "当前图库日期筛选"
                  ).valid else {
                return "日期区间无效，请选择正确的开始和结束日期。"
            }
        }
        return nil
    }

    private func showMapForAppliedQuery() {
        guard mapUnavailableReason(for: query) == nil,
              onShowMap != nil else { return }
        if sourceFilter != nil {
            showingSourceFilteredMap = true
            return
        }
        let range: XDriveIOSNativePhotoMapCaptureRange?
        if let from = query.from, let until = query.until {
            let current = XDriveIOSNativePhotoMapCaptureRange(
                from: from, to: until, label: "当前图库日期筛选")
            guard current.valid else { return }
            range = current
        } else {
            range = nil
        }
        let media: XDriveIOSNativePhotoMediaFilter
        switch query.media {
        case .all: media = .all
        case .image: media = .photos
        case .video: media = .videos
        case .live: media = .livePhotos
        }
        onShowMap?(range, media, query.term)
    }

    private var representableMapMediaFilter: XDriveIOSNativePhotoMediaFilter {
        switch draft.media {
        case .all: return .all
        case .image: return .photos
        case .video: return .videos
        case .live: return .livePhotos
        }
    }

    private var representableMapCaptureRange: XDriveIOSNativePhotoMapCaptureRange? {
        guard let from = draft.from, let until = draft.until else { return nil }
        let range = XDriveIOSNativePhotoMapCaptureRange(
            from: from, to: until, label: "当前图库日期筛选")
        return range.valid ? range : nil
    }

    private func applyQuery() { guard draft.isValid else { return }; query = draft; showFilters = false }
    // Diagnostic identity for the real native foreground-return XCTest.
    // It reveals no PhotoKit IDs, credentials, or media content.
    private var galleryWallGenerationDiagnostic: String {
        #if DEBUG
        return wall.generation.uuidString
        #else
        return ""
        #endif
    }

    private func validateForegroundWall() {
        let currentGrant = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let grantChanged = currentGrant != permission
        let localReadAllowed = currentGrant == .authorized || currentGrant == .limited
        let epoch = wall.library
        let currentEpoch = epoch.map {
            XDriveIOSNativePhotoFingerprintIndex.isCurrent($0)
        } ?? false
        if XDriveIOSUnifiedGalleryScenePolicy.requiresResetOnReturn(
            permissionChanged: grantChanged,
            localAccessGranted: localReadAllowed,
            hasEpoch: epoch != nil,
            epochCurrent: currentEpoch
        ) {
            reset()
        } else {
            permission = currentGrant
        }
    }

    private func resetWall() { selected = nil; viewerReturnAnchor = nil; wall.reset() }
    private func requestOriginalAudit(retryUnavailable: Bool) {
        // An explicit diagnostic is independent from upload scheduling.
        self.retryUnavailable = retryUnavailable
        explicitOriginalAudit = true
        indexRequest = UUID()
    }
    private func reset() {
        pairing = nil
        resetWall()
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        timeline.reset()
        self.retryUnavailable = false
        explicitOriginalAudit = false
        indexRequest = UUID()
    }
}

@MainActor
struct XDriveIOSNativePhotoPairingDetails: View {
    let row: XDriveIOSNativeUnifiedPhoto
    let retry: () -> Void
    var backup: (() -> Void)? = nil
    var priorityBackup: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section { Label(row.presence.title, systemImage: row.presence.symbol) }
                Section("核对说明") {
                    if row.presence == .both {
                        Text("已核对完整原件 SHA-256；实况照片同时核对静态照片和动态视频。默认优先使用本机，原件不可读时尝试已核验的云端副本。")
                    } else if row.presence == .unverified {
                        Text((row.reason ?? .checking).explanation)
                    } else if row.presence == .localOnly {
                        Text("当前云端图库没有相同完整原件。")
                    } else {
                        Text("已核对当前可访问的本机图库，没有发现相同完整原件。")
                    }
                }
                if let priorityBackup, let local = row.local {
                    Button("优先核验或备份此原件") {
                        dismiss()
                        priorityBackup(local.id)
                    }
                }
                if let backup, row.presence == .localOnly {
                    Button("打开相册备份") { dismiss(); backup() }
                }
                Button("重新读取来源状态") { dismiss(); retry() }
            }
            .navigationTitle("照片来源").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}

@MainActor
struct XDriveIOSUnifiedPhotoTile: View {
    let row: XDriveIOSNativeUnifiedPhoto
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let presentingOwner: XDriveNativeOwnerRoot
    let displayActive: Bool
    let retainWhileCovered: Bool
    @StateObject private var local = XDriveIOSPhotoImageLoader()
    @State private var remote: UIImage?
    @State private var fallback: Task<Void, Never>?
    // The local PhotoKit loader intentionally clears its own UIImage when
    // cancelled. Retain only this visible tile's last verified pixels while
    // a Viewer/child route covers the wall, never across media or Owner changes.
    @State private var retainedLocal: UIImage?
    @State private var retainedKey: String?
    @State private var loadGeneration = UUID()

    private var thumbnailKey: String {
        // Explicit String operands avoid expensive inference over nested
        // optionals and preserve exact Owner/PhotoKit/Node cache identity.
        let ownerOrigin: String = presentingOwner.origin.absoluteString
        let ownerInstance: String = presentingOwner.instanceID
        let ownerIdentity: String = String(presentingOwner.ownerID)
        let photoIdentity: String = row.id
        let localIdentity: String = row.local?.id ?? ""
        let localModified: String = String(describing: row.local?.modifiedAt)
        let localCaptured: String = String(describing: row.local?.capturedAt)
        let matchedNode: String = String(row.match?.node_id ?? 0)
        let cloudRevision: String = String(row.cloud?.node.revision ?? 0)
        let cloudThumbnail: String = row.cloud?.metadata.thumbnail_version ?? ""
        let parts: [String] = [
            ownerOrigin, ownerInstance, ownerIdentity, photoIdentity,
            localIdentity, localModified, localCaptured, matchedNode,
            cloudRevision, cloudThumbnail
        ]
        return parts.joined(separator: "|")
    }

    var body: some View {
        XDriveIOSNativePhotoWallTileShell(
            isVideo: row.isVideo, isLive: row.isLive,
            badgeAlignment: .topTrailing
        ) {
        Rectangle().fill(.quaternary)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if displayActive,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, presentingOwner),
                   retainedKey == thumbnailKey,
                   let image = local.image ?? retainedLocal ?? remote {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: row.isVideo ? "play.rectangle" : "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
        }
            .overlay(alignment: .bottomLeading) {
                Label(row.presence.title, systemImage: row.presence.symbol)
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .font(.caption2.weight(.semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 3)
                    .background(.black.opacity(0.72), in: Capsule())
                    .padding(4)
            }
            .task(id: "\(displayActive):\(thumbnailKey)") {
                let key = thumbnailKey
                let ownerValid = XDriveIOSNativePhotoOwnerScope.matches(
                    login.owner, presentingOwner
                )
                if retainedKey != key || !ownerValid {
                    // A different Node revision, PhotoKit mutation or Owner
                    // can never display the previous thumbnail during a swap.
                    loadGeneration = UUID()
                    fallback?.cancel()
                    fallback = nil
                    local.cancel()
                    retainedLocal = nil
                    remote = nil
                    retainedKey = ownerValid ? key : nil
                }
                guard ownerValid else { return }

                if !displayActive {
                    // Viewer/child overlay: stop decoding and network work,
                    // but do not replace already displayed pixels with blank
                    // placeholders when the exact same wall returns.
                    retainedLocal = local.image ?? retainedLocal
                    loadGeneration = UUID()
                    fallback?.cancel()
                    fallback = nil
                    local.cancel()
                    return
                }
                if let asset = row.local {
                    // Do not re-request an unchanged local thumbnail after
                    // Viewer dismissal; the hidden wall retained its image.
                    if local.image == nil && retainedLocal == nil {
                        local.load(asset.id, size: CGSize(width: 280, height: 280),
                                   allowICloud: false)
                    }
                } else if let item = row.cloud, remote == nil {
                    // Likewise, reuse the same Owner + revision cloud image.
                    await loadCloud(item, match: nil)
                }
            }
            .onChange(of: local.isLoading) { loading in
                if displayActive, retainedKey == thumbnailKey, !loading,
                   local.image == nil, retainedLocal == nil,
                   (row.cloud != nil || row.match != nil) {
                    fallback?.cancel()
                    fallback = Task { await loadCloud(row.cloud, match: row.match) }
                }
            }
            .onChange(of: login.owner) { _ in
                // Parent invalidation is asynchronous; fail closed even before
                // a recycled SwiftUI tile is removed from the hierarchy.
                loadGeneration = UUID()
                fallback?.cancel()
                fallback = nil
                local.cancel()
                retainedLocal = nil
                remote = nil
                retainedKey = nil
            }
            .onDisappear {
                loadGeneration = UUID()
                fallback?.cancel()
                fallback = nil
                if retainWhileCovered, retainedKey == thumbnailKey,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, presentingOwner) {
                    retainedLocal = local.image ?? retainedLocal
                    local.cancel()
                } else {
                    // Normal off-screen scrolling must not retain decoded
                    // thumbnails for an unbounded number of lazy cells.
                    local.cancel()
                    retainedLocal = nil
                    remote = nil
                    retainedKey = nil
                }
            }
    }

    private func loadCloud(_ item: XDriveIOSNativeMediaItem?, match: XDriveIOSNativeExactPhotoMatch?) async {
        let owner = presentingOwner
        let expectedKey = thumbnailKey
        let ticket = loadGeneration
        guard displayActive, retainedKey == expectedKey,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
              let auth = try? await login.verifiedAuthorization(),
              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        let reader = XDriveIOSNativeMediaGalleryReader(owner: owner, accessToken: auth.accessToken)
        let image = try? await XDriveIOSNativeFilesThumbnailSlots.shared.perform {
            if let item { return try await reader.thumbnail(item) }
            guard let match else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
            let matched = try await reader.matchedMedia(match)
            return try await reader.thumbnail(matched)
        }
        guard let image,
              !Task.isCancelled, loadGeneration == ticket,
              displayActive, retainedKey == expectedKey,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        remote = image
    }
}
