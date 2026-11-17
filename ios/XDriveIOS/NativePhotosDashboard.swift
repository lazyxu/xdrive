import CryptoKit
import MapKit
import Photos
import SwiftUI

private enum XDriveIOSNativeBottomTab: String {
    case launcher, dynamic, gallery, files, mine
}

private enum XDriveIOSNativeGallerySource: String, CaseIterable, Identifiable {
    case unified, local, albums, cloud, originals, map
    var id: String { rawValue }
    var title: String {
        switch self {
        case .unified: return "全部照片"
        case .local: return "本机照片"
        case .albums: return "相册"
        case .cloud: return "云端图库"
        case .originals: return "备份原件"
        case .map: return "地图"
        }
    }
}

private enum XDriveIOSNativeDynamicFeature: String, CaseIterable, Identifiable {
    case notes, clipboard, backup, transfers, sync, storage, devices, diagnostics
    var id: String { rawValue }
    var title: String {
        switch self {
        case .notes: return "笔记"
        case .clipboard: return "剪贴板"
        case .backup: return "相册备份"
        case .transfers: return "传输任务"
        case .sync: return "同步"
        case .storage: return "存储"
        case .devices: return "设备"
        case .diagnostics: return "诊断"
        }
    }
    var symbol: String {
        switch self {
        case .notes: return "note.text"
        case .clipboard: return "doc.on.clipboard"
        case .backup: return "icloud.and.arrow.up"
        case .transfers: return "arrow.up.arrow.down"
        case .sync: return "arrow.triangle.2.circlepath"
        case .storage: return "externaldrive"
        case .devices: return "iphone.gen3"
        case .diagnostics: return "waveform.path.ecg"
        }
    }
    var implemented: Bool { self == .backup || self == .notes || self == .clipboard || self == .transfers }
}

private enum XDriveIOSNativeLauncherRoute: String, CaseIterable, Identifiable {
    case local, albums, cloud, originals, map, files, notes, clipboard
    case backup, transfers, sync, storage, devices, diagnostics
    var id: String { rawValue }
    var title: String {
        switch self {
        case .local: return "本机照片"
        case .albums: return "相册"
        case .cloud: return "云端图库"
        case .originals: return "备份原件"
        case .map: return "地图"
        case .files: return "文件"
        case .notes: return "笔记"
        case .clipboard: return "剪贴板"
        case .backup: return "相册备份"
        case .transfers: return "传输"
        case .sync: return "同步"
        case .storage: return "存储"
        case .devices: return "设备"
        case .diagnostics: return "诊断"
        }
    }
    var symbol: String {
        switch self {
        case .local: return "photo.on.rectangle"
        case .albums: return "rectangle.stack"
        case .cloud: return "photo.stack"
        case .originals: return "icloud"
        case .map: return "map"
        case .files: return "folder"
        case .notes: return "note.text"
        case .clipboard: return "doc.on.clipboard"
        case .backup: return "icloud.and.arrow.up"
        case .transfers: return "arrow.up.arrow.down"
        case .sync: return "arrow.triangle.2.circlepath"
        case .storage: return "externaldrive"
        case .devices: return "iphone.gen3"
        case .diagnostics: return "waveform.path.ecg"
        }
    }
    var available: Bool {
        switch self {
        case .local, .albums, .cloud, .originals, .map, .files, .notes, .clipboard, .backup: return true
        case .transfers: return true
        default: return false
        }
    }
    var category: String {
        switch self {
        case .local, .albums, .cloud, .originals, .map, .files, .notes, .clipboard: return "内容浏览"
        case .backup, .devices, .sync: return "设备与备份"
        case .transfers, .storage, .diagnostics: return "任务与工具"
        }
    }
}

/// Collection covers are visible thumbnails from the currently granted
/// PhotoKit library, never guesses about People, Memories or Trips.
/// Only the latest bounded candidates are read. No original bytes, persistent
/// identifier, server Owner request or background backup operation is started.
private enum XDriveIOSNativePhotosCollectionCoverKind {
    case recent, videos, livePhotos

    var title: String {
        switch self {
        case .recent: return "最近的日子"
        case .videos: return "视频"
        case .livePhotos: return "实况照片"
        }
    }

    var symbol: String {
        switch self {
        case .recent: return "calendar"
        case .videos: return "video"
        case .livePhotos: return "livephoto"
        }
    }
}

private struct XDriveIOSNativePhotosCollectionCover: View {
    let kind: XDriveIOSNativePhotosCollectionCoverKind
    @StateObject private var loader = XDriveIOSPhotoImageLoader()
    @StateObject private var changes = XDriveIOSUnifiedPhotoObserver()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomLeading) {
                if let image = loader.image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                } else {
                    Rectangle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay {
                            Image(systemName: kind.symbol)
                                .font(.system(size: 34, weight: .light))
                                .foregroundStyle(.secondary)
                        }
                }
                LinearGradient(colors: [.clear, .black.opacity(0.65)],
                               startPoint: .center, endPoint: .bottom)
                Label(kind.title, systemImage: kind.symbol)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(14)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onAppear {
            changes.start()
            loadCurrentCover()
        }
        .onDisappear {
            changes.stop()
            loader.cancel()
        }
        .onChange(of: changes.change) { _ in loadCurrentCover() }
        .onChange(of: phase) { next in
            if next == .active { loadCurrentCover() }
            else { loader.cancel() }
        }
        .accessibilityLabel(kind.title)
    }

    private func loadCurrentCover() {
        loader.cancel()
        guard phase == .active,
              [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ) else { return }
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        // Live Photos may not be the newest item. A bounded sample is only
        // a cover candidate search, never a complete collection membership.
        options.fetchLimit = kind == .livePhotos ? 96 : 1
        let assets: PHFetchResult<PHAsset>
        switch kind {
        case .recent: assets = PHAsset.fetchAssets(with: options)
        case .videos: assets = PHAsset.fetchAssets(with: .video, options: options)
        case .livePhotos: assets = PHAsset.fetchAssets(with: .image, options: options)
        }
        let coverID: String?
        if kind == .livePhotos {
            var liveID: String?
            for index in 0..<min(assets.count, 96) {
                let asset = assets.object(at: index)
                if asset.mediaSubtypes.contains(.photoLive) {
                    liveID = asset.localIdentifier
                    break
                }
            }
            coverID = liveID
        } else {
            coverID = assets.firstObject?.localIdentifier
        }
        guard let coverID else { return }
        loader.load(coverID, size: CGSize(width: 400, height: 400),
                    contentMode: .aspectFill)
    }
}

/// The native Collections surface is intentionally a presentation layer over
/// existing authorized readers. Entries never manufacture Memories or Trips.
private enum XDriveIOSNativePhotosCollectionDestination: String, CaseIterable, Identifiable {
    case recentDays, people, albums, videos, livePhotos, trips

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recentDays: return "最近的日子"
        case .people: return "人物与宠物"
        case .albums: return "相簿"
        case .videos: return "视频"
        case .livePhotos: return "实况照片"
        case .trips: return "旅行"
        }
    }

    var symbol: String {
        switch self {
        case .recentDays: return "calendar"
        case .people: return "person.2.crop.square.stack"
        case .albums: return "rectangle.stack"
        case .videos: return "video"
        case .livePhotos: return "livephoto"
        case .trips: return "map"
        }
    }

    var accessibilityID: String {
        switch self {
        case .recentDays: return "native-ios-collections-recent-days"
        case .people: return "native-ios-collections-people"
        case .albums: return "native-ios-collections-albums"
        case .videos: return "native-ios-collections-videos"
        case .livePhotos: return "native-ios-collections-live"
        case .trips: return "native-ios-collections-trips"
        }
    }
}

/// The Pinned section contains only real, navigable destinations. Its on-device
/// preference is a list of fixed route names, never a PhotoKit asset ID, a
/// server Owner ID or a cached membership claim.
struct XDriveIOSNativePhotosCollectionsScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Binding var savedAlbumOffset: Int
    // Same proven MapKit route used by the main Photo Library, no new reader.
    let onOpenMap: () -> Void
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("xdrive.native.photos.pinned-collection-routes.v1")
    private var pinnedRoutesRaw = "recentDays,people,albums"
    @State private var recentOffset = 0
    @State private var recentFilter: XDriveIOSNativePhotoMediaFilter = .all
    @State private var videoOffset = 0
    @State private var videoFilter: XDriveIOSNativePhotoMediaFilter = .videos
    @State private var liveOffset = 0
    @State private var liveFilter: XDriveIOSNativePhotoMediaFilter = .livePhotos

    private var cardWidth: CGFloat {
        horizontalSizeClass == .regular ? 200 : 160
    }

    private var pinnedRoutes: [XDriveIOSNativePhotosCollectionDestination] {
        let requested = pinnedRoutesRaw.split(separator: ",")
            .compactMap { XDriveIOSNativePhotosCollectionDestination(rawValue: String($0)) }
        var visited = Set<XDriveIOSNativePhotosCollectionDestination>()
        return requested.filter { visited.insert($0).inserted }
    }

    private func togglePin(_ route: XDriveIOSNativePhotosCollectionDestination) {
        let current = pinnedRoutes
        let updated = current.contains(route) ? current.filter { $0 != route } :
            current + [route]
        pinnedRoutesRaw = updated.map(\.rawValue).joined(separator: ",")
    }

    @ViewBuilder
    private func destination(for route: XDriveIOSNativePhotosCollectionDestination) -> some View {
        switch route {
        case .recentDays:
            XDriveIOSNativeLocalPhotoTimelineContainer(
                savedOffset: $recentOffset, mediaFilter: $recentFilter
            )
        case .people:
            XDriveIOSNativeGalleryPeople(login: login)
        case .albums:
            XDriveIOSNativePhotoAlbumsScreen(savedOffset: $savedAlbumOffset)
        case .videos:
            XDriveIOSNativeLocalPhotoTimelineContainer(
                savedOffset: $videoOffset, mediaFilter: $videoFilter
            )
        case .livePhotos:
            XDriveIOSNativeLocalPhotoTimelineContainer(
                savedOffset: $liveOffset, mediaFilter: $liveFilter
            )
        case .trips:
            // The existing screen admits only current, server-verified Owner
            // GPS-calendar trip members. There is no inferred local "trip".
            XDriveIOSNativeExactTripsScreen(login: login)
        }
    }

    @ViewBuilder
    private func cover(for route: XDriveIOSNativePhotosCollectionDestination) -> some View {
        switch route {
        case .recentDays:
            XDriveIOSNativePhotosCollectionCover(kind: .recent)
        case .videos:
            XDriveIOSNativePhotosCollectionCover(kind: .videos)
        case .livePhotos:
            XDriveIOSNativePhotosCollectionCover(kind: .livePhotos)
        case .people, .albums, .trips:
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
                Image(systemName: route.symbol)
                    .font(.system(size: 36, weight: .ultraLight))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityHidden(true)
                LinearGradient(colors: [.clear, .black.opacity(0.38)],
                               startPoint: .center, endPoint: .bottom)
                Label(route.title, systemImage: route.symbol)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(12)
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func collectionLink(
        _ route: XDriveIOSNativePhotosCollectionDestination, pinned: Bool = false
    ) -> some View {
        NavigationLink {
            destination(for: route)
        } label: {
            cover(for: route)
                .frame(width: cardWidth, height: cardWidth)
                .contentShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                togglePin(route)
            } label: {
                Label(pinnedRoutes.contains(route) ? "取消固定" : "固定到精选集",
                      systemImage: pinnedRoutes.contains(route) ? "pin.slash" : "pin")
            }
        }
        .accessibilityLabel(route.title)
        .accessibilityHint("长按可固定或取消固定")
        .accessibilityIdentifier(
            pinned ? "native-ios-collections-pinned-" + route.rawValue :
                route.accessibilityID
        )
    }

    private func collectionSection(
        _ title: String, routes: [XDriveIOSNativePhotosCollectionDestination],
        isPinned: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.title2.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if isPinned {
                    Menu {
                        ForEach(XDriveIOSNativePhotosCollectionDestination.allCases) { route in
                            Button {
                                togglePin(route)
                            } label: {
                                Label(route.title, systemImage: pinnedRoutes.contains(route)
                                      ? "checkmark.circle.fill" : "circle")
                            }
                        }
                    } label: {
                        Text("编辑").font(.subheadline.weight(.medium))
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityIdentifier("native-ios-collections-edit-pinned")
                }
            }
            .padding(.horizontal, 16)
            if routes.isEmpty {
                Text("可从其他精选集的长按菜单中添加")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(routes) { route in
                            collectionLink(route, pinned: isPinned)
                                .frame(width: cardWidth)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .accessibilityIdentifier(
                    isPinned ? "native-ios-collections-pinned-strip" :
                        "native-ios-collections-section-" + title
                )
            }
        }
    }

    // Native Photos → Collections → Utilities → Map (one existing route).
    // The presentation control owns no PhotoKit scope, Owner, GPS or cursor.
    private var mapUtilitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("实用工具")
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                Button(action: onOpenMap) {
                    ZStack(alignment: .bottomLeading) {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        Image(systemName: "map")
                            .font(.system(size: 38, weight: .ultraLight))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityHidden(true)
                        LinearGradient(colors: [.clear, .black.opacity(0.38)],
                                       startPoint: .center, endPoint: .bottom)
                        Label("地图", systemImage: "map")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(12)
                    }
                    .frame(width: cardWidth, height: cardWidth)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("地图")
                .accessibilityHint("查看照片位置地图")
                .accessibilityIdentifier("native-ios-collections-map")
                .padding(.horizontal, 16)
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                collectionSection("最近的日子", routes: [.recentDays])
                collectionSection("人物与宠物", routes: [.people])
                collectionSection("固定精选集", routes: pinnedRoutes, isPinned: true)
                collectionSection("相簿", routes: [.albums])
                collectionSection("旅行", routes: [.trips])
                collectionSection("媒体类型", routes: [.videos, .livePhotos])
                mapUtilitySection
            }
            .padding(.vertical, 16)
        }
        .accessibilityIdentifier("native-ios-photos-collections")
    }
}

/// Native Photos-style Gallery shell with separate xDrive feature navigation. All routes are native SwiftUI/UIKit;
/// unfinished domains remain explicitly unavailable rather than embedded browser
/// fallbacks or fake success. No separate Owner session or upload runner.
struct XDriveIOSNativePhotosDashboard: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var backup: XDriveIOSNativePhotoBackupController
    let signingOut: Bool
    let logoutWarning: String?
    let onSignOut: (XDriveNativeOwnerRoot) -> Void
    @StateObject private var transfers = XDriveIOSNativeTransferStore()
    @State private var showSignOutConsent = false
    @State private var signOutConsentOwner: XDriveNativeOwnerRoot?
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var phase
    @State private var photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var tab: XDriveIOSNativeBottomTab = .gallery
    @State private var gallerySource: XDriveIOSNativeGallerySource = .unified
    // Opening a Photos map should include every currently authorized GPS photo,
    // not just the current 64-slot Timeline page; the user can still select
    // the bounded Current Page mode explicitly.
    @State private var localMapScope: XDriveIOSNativeLocalMapScope = .library
    @State private var localMapPageOffset = 0
    // Keep map source and cloud camera during native Gallery re-entry.
    // Never persist camera/GPS coordinates with the navigation snapshot.
    @State private var mapSource: XDriveIOSNativePhotoMapSource = .local
    // Session-only return destination; never persist an Owner or GPS identity.
    // UI-only origin to select the correct Photos tab while on Map.
    // No Owner, PhotoKit ID, coordinate or media membership is stored.
    @State private var mapOpenedFromCollections = false
    @State private var mapReturnGallerySource: XDriveIOSNativeGallerySource?
    @State private var mapReturnOwnerScopeKey: String?
    @State private var cloudMapCamera: MKCoordinateRegion?
    // Session-only local WGS84 camera; never stored with navigation snapshot.
    @State private var localMapCamera: MKCoordinateRegion?
    @State private var localMapJump: XDriveIOSNativeLocalMapJump?
    // Calendar dates are transient inherited photo membership filters, not
    // persisted map coordinates or independently authorized photo IDs.
    @State private var galleryMapCaptureRange: XDriveIOSNativePhotoMapCaptureRange?
    // The default merged Gallery owns its own filter/wall state. Presenting
    // the existing native map over it keeps its loaded pages, zoom density
    // and Viewer return anchor alive instead of switching Gallery sources.
    @State private var presentingUnifiedMap = false
    // Defer a Photos destination change until the UIKit full-screen MapKit
    // dismissal ends. Otherwise the Gallery re-creates its source during
    // the map's disappearance and can reveal an unrelated frame.
    // The pending route is transient, and scoped to this exact Owner root.
    @State private var pendingUnifiedMapDestination: XDriveIOSNativeGallerySource?
    @State private var pendingUnifiedMapSearch = false
    @State private var pendingUnifiedMapOwnerScope: String?
    @State private var unifiedMapCaptureRange: XDriveIOSNativePhotoMapCaptureRange?
    @State private var unifiedMapMediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    @State private var unifiedMapFilenameTerm = ""
    // A bounded navigation position; never holds a PhotoKit asset identity.
    @State private var localGalleryPageOffset = 0
    // Keep the active local Photos filter when a Viewer opens the map route.
    @State private var localGalleryMediaFilter: XDriveIOSNativePhotoMediaFilter = .all
    // Restore only the coarse 32-slot album directory, never album IDs.
    @State private var localAlbumDirectoryOffset = 0
    private struct ClipboardViewerIntent: Identifiable {
        let node: XDriveIOSNativeFilesNode
        let owner: XDriveNativeOwnerRoot
        var id: UInt64 { node.id }
    }
    @State private var clipboardViewerIntent: ClipboardViewerIntent?
    @State private var dynamicFeature: XDriveIOSNativeDynamicFeature?
    @State private var recentDynamic: [XDriveIOSNativeDynamicFeature] = []
    @State private var launcherQuery = ""
    @State private var showRecentPicker = false
    @State private var showingLocalPhotoSearch = false
    // Native Photos bottom search opens the unified PhotoKit + Owner filter/search sheet.
    @State private var requestUnifiedPhotoSearch = false
    // iOS Photos changes its lower-left floating control to year/month/all
    // while browsing the Library time line. Never store media identities.
    @State private var galleryTimelineExpanded = false
    @State private var galleryTimeScale: XDriveIOSNativePhotoWallTimeScale = .all
    @State private var galleryFocused = false
    // Default photo maps are immersive even during L2/Sheet lifecycle races.
    // Only the current map's explicit action can reveal the five-slot bar.
    @State private var mapNavigationExplicitlyShown = false
    private var galleryPresentationFocused: Bool {
        gallerySource == .map ? !mapNavigationExplicitlyShown : galleryFocused
    }
    @State private var backupLaunchAction = XDriveIOSNativePhotoBackupLaunch.overview
    @State private var backupLaunchNonce = UUID()
    @State private var showThumbnailCacheFromBackup = false
    @State private var priorityItemID: String?
    @State private var priorityItemOwner: XDriveNativeOwnerRoot?
    @State private var priorityIsRetry = false
    @State private var showPriorityConsent = false
    // A source/tab/scene navigation creates a new focus owner even when
    // the user returns to the same source later (cloud -> map -> cloud).
    @State private var galleryFocusGeneration = UUID()
    @State private var routeRestoreScopeKey: String?
    private let navigationRouteStore = XDriveIOSNativeNavigationRouteStore()

    // The Dynamic slot is a map shortcut until the verified Owner has used
    // a real dynamic feature. Never store Gallery Map as a dynamic recent.
    private var emptyDynamicMapFallback: Bool {
        dynamicFeature == nil && recentDynamic.isEmpty
    }
    private var dynamicSlotTitle: String {
        dynamicFeature?.title ?? (emptyDynamicMapFallback ? "地图" : "最近")
    }
    private var dynamicSlotSymbol: String {
        dynamicFeature?.symbol ?? (emptyDynamicMapFallback ? "map" : "clock.arrow.circlepath")
    }

    private var ownerScopeKey: String {
        guard let owner = login.owner else { return "signed-out" }
        return "\(owner.origin.absoluteString)|\(owner.instanceID)|\(owner.ownerID)|\(owner.rootNodeID)"
    }

    // Only a non-secret SHA-256 scope identifier is written with route hints.
    // Credentials, PhotoKit identifiers and signed media URLs never enter it.
    private var navigationScopeHash: String? {
        guard login.owner != nil else { return nil }
        return SHA256.hash(data: Data(ownerScopeKey.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    var body: some View {
        let expectedRouteOwnerKey = ownerScopeKey
        return TabView(selection: $tab) {
            NavigationStack {
                launcher
                    .navigationTitle("全部")
            }
            .tabItem { Label("全部", systemImage: "square.grid.2x2") }
            .tag(XDriveIOSNativeBottomTab.launcher)

            NavigationStack {
                dynamicPage
                    .navigationTitle(dynamicSlotTitle)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button {
                                showRecentPicker = true
                            } label: {
                                Label("最近功能", systemImage: "clock.arrow.circlepath")
                            }
                        }
                    }
            }
            .tabItem {
                Label(dynamicSlotTitle,
                      systemImage: dynamicSlotSymbol)
            }
            .tag(XDriveIOSNativeBottomTab.dynamic)

            NavigationStack {
                gallery
                    .navigationTitle(
                        gallerySource == .albums ? "精选集" :
                        gallerySource == .unified ? "图库" : gallerySource.title
                    )
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        // The iOS Photos toolbar is primarily Gallery chrome.
                        // xDrive-specific sources, backup and other app destinations
                        // live behind ONE secondary menu, not permanent rows.
                        ToolbarItem(placement: .topBarLeading) {
                            galleryMoreMenu
                        }
                    }
            }
            .tabItem { Label("图库", systemImage: "photo.on.rectangle") }
            .tag(XDriveIOSNativeBottomTab.gallery)

            NavigationStack {
                files
                    .navigationTitle("文件")
            }
            .tabItem { Label("文件", systemImage: "folder") }
            .tag(XDriveIOSNativeBottomTab.files)

            NavigationStack {
                mine
                    .navigationTitle("我的")
            }
            .tabItem { Label("我的", systemImage: "person.crop.circle") }
            .tag(XDriveIOSNativeBottomTab.mine)
        }
        // SwiftUI's TabView keeps native feature-local NavigationStacks, but
        // the system tab strip is hidden in favor of an explicit 5-slot bar.
        // This guarantees a compact horizontal label in iPhone landscape and
        // gives the dynamic slot a real long-press/context-menu surface.
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if XDriveIOSNativeFocusVisibilityPolicy.showsBar(
                tab: tab.rawValue,
                gallerySource: gallerySource.rawValue,
                focused: galleryPresentationFocused,
                ownerVerified: login.owner != nil
            ) {
                // One Photos-native bar throughout Library, Collections and Map.
                // Never display the xDrive five-slot bar over a Photos map.
                if tab == .gallery {
                    nativePhotosBottomBar
                } else {
                    nativeBottomBar
                }
            }
        }
        .id(ownerScopeKey)
        .environment(\.xdriveNativeTransfers, transfers)
        // Visible local/paired Gallery tiles only; no background writes.
        .environment(\.xdriveNativePhotoQueueBadgeOwner,
                     backup.schedule?.enabled == true ? login.owner : nil)
        .environment(\.xdriveNativePhotoProcessingID,
                     backup.busy ? backup.progress?.activeLocalIdentifier : nil)
        .environment(\.xdriveNativePhotoQueueBadgeRefresh,
                     XDriveIOSNativePhotoQueueBadgeRefresh(
                        busy: backup.busy,
                        confirmedID: backup.confirmedOriginalUpdate?.id
                     ))
        .environment(\.xdriveNativePhotoOnlyNewSince,
                     backup.schedule?.enabled == true &&
                     backup.schedule?.backupStartRule == .onlyNew
                        ? backup.schedule?.newOnlySince : nil)
        .environment(\.xdriveNativePhotoPriorityAction, { id, failed in
            requestPriorityBackup(id: id, failed: failed)
        })
        .environment(\.xdriveNativeLocalMapJump, localMapJump)
        .environment(\.xdriveOpenNativeLocalMap, { jump in
            guard ownerScopeKey == expectedRouteOwnerKey, login.owner != nil,
                  phase == .active,
                  [.authorized, .limited].contains(
                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                  ) else { return }
            // Reuse the existing Gallery map; never spawn another map stack.
            // Capture the Gallery source before installing this verified jump.
            openGallery(.map)
            localMapJump = jump
            localMapCamera = jump.camera
            localMapScope = .library
            mapSource = .local
        })
        .navigationBarBackButtonHidden(true)
        .fullScreenCover(item: $clipboardViewerIntent) { selected in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected.owner) {
                XDriveIOSNativeFilesViewer(
                    initial: selected.node, loadedItems: [selected.node],
                    openedOwner: selected.owner, login: login,
                    onNavigate: { _ in false }
                )
            } else {
                Text("账号或服务器已变化，不能打开之前的文件引用。")
            }
        }
        .sheet(isPresented: $showThumbnailCacheFromBackup) {
            NavigationStack {
                XDriveIOSNativePhotoThumbnailCacheScreen(login: login)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("完成") { showThumbnailCacheFromBackup = false }
                                .accessibilityIdentifier("native-ios-backup-cache-sheet-close")
                        }
                    }
            }
        }
        .sheet(isPresented: $showingLocalPhotoSearch) {
            XDriveIOSNativePhotoSearchScreen()
        }
        .sheet(isPresented: $showRecentPicker) {
            NavigationStack {
                List {
                    if recentDynamic.isEmpty {
                        Button {
                            showRecentPicker = false
                            openGallery(.map)
                        } label: {
                            Label("地图（默认）", systemImage: "map")
                        }
                        .accessibilityIdentifier("native-ios-dynamic-map-fallback")
                    }
                    ForEach(recentDynamic) { feature in
                        Button {
                            openDynamic(feature)
                            showRecentPicker = false
                        } label: {
                            Label(feature.title, systemImage: feature.symbol)
                        }
                    }
                }
                .navigationTitle("最近功能")
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("完成") { showRecentPicker = false }
                    }
                }
            }
        }
        .confirmationDialog(
            priorityIsRetry ? "安全重试失败原件？" : "优先备份所选照片原件？",
            isPresented: $showPriorityConsent, titleVisibility: .visible
        ) {
            Button("确认核验并处理原件") {
                guard let expected = priorityItemOwner, let id = priorityItemID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      phase == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                else { return }
                priorityItemID = nil
                priorityItemOwner = nil
                backup.startSingle(
                    login: login, expectedOwner: expected,
                    localIdentifier: id, allowICloud: false
                )
                openBackup(.overview)
            }
            .accessibilityIdentifier("native-ios-gallery-single-backup-confirm")
        } message: {
            Text("仅处理当前 Owner 所选原件；保留受管目标、收据核验与未知 ACK 阻断。不自动下载 iCloud 原件。")
        }
        .confirmationDialog(
            "确认退出当前服务器和账户？",
            isPresented: $showSignOutConsent,
            titleVisibility: .visible
        ) {
            Button("停止本机自动备份并退出", role: .destructive) {
                guard let expected = signOutConsentOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    signOutConsentOwner = nil
                    return
                }
                signOutConsentOwner = nil
                onSignOut(expected)
            }
            .accessibilityIdentifier("native-ios-login-signout")
        } message: {
            Text("退出会停止本机原件自动计划并尝试撤销后台授权；已备份的云端文件和不确定上传收据不会被删除。")
        }
        .onAppear {
            restoreNavigationIfNeeded()
            transfers.selectOwner(login.owner)
            photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            backup.refresh(owner: login.owner)
        }
        .onChange(of: phase) { state in
            guard state == .active else {
                pendingUnifiedMapDestination = nil
                pendingUnifiedMapSearch = false
                pendingUnifiedMapOwnerScope = nil
                galleryFocusGeneration = UUID()
                galleryFocused = false
                mapNavigationExplicitlyShown = false
                localMapJump = nil
                localMapCamera = nil
                return
            }
            // Settings may revoke PhotoKit permission or a BGTask may pause
            // the durable plan without changing the logged-in Owner.
            photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            backup.refresh(owner: login.owner)
            // Native Photos map is immersive by default after foregrounding.
            // The map's explicit "显示底部导航" action can still reveal chrome.
            if tab == .gallery && gallerySource == .map {
                galleryFocused = true
                mapNavigationExplicitlyShown = false
            }
        }
        .onChange(of: ownerScopeKey) { _ in
            transfers.selectOwner(login.owner)
            // TabView .id does not reset this parent's @State. Revoke the old
            // Owner's saved UI route even if switching A -> B -> A in one scene.
            routeRestoreScopeKey = nil
            clipboardViewerIntent = nil
            navigationRouteStore.clear()
            if login.owner != nil { routeRestoreScopeKey = ownerScopeKey }
            // The app-root durable original/receipt runner is never touched.
            resetNavigation()
        }
        .onChange(of: login.owner) { owner in
            // Revoke old-Owner map return before any delayed Done callback.
            mapReturnGallerySource = nil
            mapReturnOwnerScopeKey = nil
            galleryMapCaptureRange = nil
            photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            // No push-route account card: parent root owns signed-out state.
            showSignOutConsent = false
            signOutConsentOwner = nil
            showingLocalPhotoSearch = false
            priorityItemID = nil
            priorityItemOwner = nil
            showPriorityConsent = false
            showThumbnailCacheFromBackup = false
            if owner == nil {
                navigationRouteStore.clear()
                resetNavigation()
            }
        }
        .onChange(of: tab) { _ in saveNavigationIfReady() }
        .onChange(of: tab) { next in
            if next == .dynamic && emptyDynamicMapFallback {
                openGallery(.map)
            }
        }
        .onChange(of: localGalleryMediaFilter) { _ in
            // A changed PhotoKit predicate invalidates the old calendar GPS
            // selection, including when switching between map sources.
            galleryMapCaptureRange = nil
        }
        .onChange(of: gallerySource) { _ in saveNavigationIfReady() }
        .onChange(of: dynamicFeature) { _ in saveNavigationIfReady() }
        .onChange(of: recentDynamic) { _ in saveNavigationIfReady() }
        .onChange(of: localMapScope) { _ in saveNavigationIfReady() }
        .onChange(of: localMapPageOffset) { _ in saveNavigationIfReady() }
        .onChange(of: localGalleryPageOffset) { _ in saveNavigationIfReady() }
        .onChange(of: localAlbumDirectoryOffset) { _ in saveNavigationIfReady() }
        // Rotation does not change focus; changing the owning route does.
        .onChange(of: tab) { next in
            galleryFocusGeneration = UUID()
            if next != .gallery {
                pendingUnifiedMapDestination = nil
                pendingUnifiedMapSearch = false
                pendingUnifiedMapOwnerScope = nil
                galleryFocused = false
                mapNavigationExplicitlyShown = false
            }
        }
        .onChange(of: gallerySource) { _ in
            galleryFocusGeneration = UUID()
            // Ordinary photo walls retain the full dashboard chrome, but
            // opening the native photo map must not sandwich the MapKit canvas
            // between backup/source strips and the five-slot tab bar.
            galleryFocused = gallerySource == .map
            mapNavigationExplicitlyShown = false
        }
    }

    // iOS 26 Photos-style Library / Collections / Search chrome while in the
    // Gallery. xDrive's five-slot bar remains available in other app modules.
    // The extra global routes are reachable from galleryMoreMenu, not stacked
    // into a second, competing row below the native Photos controls.
    private var photosChromeCollectionsSelected: Bool {
        gallerySource == .map ? mapOpenedFromCollections : gallerySource == .albums
    }

    private func navigatePhotosChrome(
        to destination: XDriveIOSNativeGallerySource, search: Bool = false
    ) {
        guard phase == .active else { return }
        if presentingUnifiedMap {
            pendingUnifiedMapDestination = destination
            pendingUnifiedMapSearch = search
            pendingUnifiedMapOwnerScope = ownerScopeKey
            presentingUnifiedMap = false
            return
        }
        if gallerySource != destination { openGallery(destination) }
        if search { requestUnifiedPhotoSearch = true }
    }

    private var nativePhotosBottomBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 2) {
                if gallerySource == .unified && galleryTimelineExpanded &&
                   !presentingUnifiedMap {
                    ForEach([
                        XDriveIOSNativePhotoWallTimeScale.year,
                        .month, .all
                    ]) { scale in
                        Button {
                            galleryTimeScale = scale
                        } label: {
                            Text(scale.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(
                                    galleryTimeScale == scale ? Color.accentColor : Color.primary
                                )
                                .frame(minWidth: 54, minHeight: 44)
                                .background(
                                    galleryTimeScale == scale
                                        ? Color.accentColor.opacity(0.12) : Color.clear,
                                    in: Capsule()
                                )
                        }
                        .accessibilityIdentifier("native-ios-photos-time-" + scale.rawValue)
                        .accessibilityAddTraits(galleryTimeScale == scale ? .isSelected : [])
                    }
                } else {
                Button {
                    navigatePhotosChrome(to: .unified)
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: "photo.on.rectangle")
                            .font(.body.weight(.semibold))
                        Text("图库").font(.caption2.weight(.semibold))
                    }
                        .foregroundStyle(!photosChromeCollectionsSelected ? Color.accentColor : Color.primary)
                        .frame(minWidth: 68, minHeight: 50)
                        .background(!photosChromeCollectionsSelected ? Color.accentColor.opacity(0.12) : Color.clear,
                                    in: Capsule())
                }
                .accessibilityIdentifier("native-ios-photos-library-tab")
                .accessibilityAddTraits(!photosChromeCollectionsSelected ? .isSelected : [])
                Button {
                    navigatePhotosChrome(to: .albums)
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: "rectangle.stack.fill")
                            .font(.body.weight(.semibold))
                        Text("精选集").font(.caption2.weight(.semibold))
                    }
                        .foregroundStyle(photosChromeCollectionsSelected ? Color.accentColor : Color.primary)
                        .frame(minWidth: 74, minHeight: 50)
                        .background(photosChromeCollectionsSelected ? Color.accentColor.opacity(0.12) : Color.clear,
                                    in: Capsule())
                }
                .accessibilityIdentifier("native-ios-photos-collections-tab")
                .accessibilityAddTraits(photosChromeCollectionsSelected ? .isSelected : [])
                }
            }
            .padding(3)
            .background(.regularMaterial, in: Capsule())
            Spacer(minLength: 0)
            Button {
                // The unified editor searches both authorized local and
                // current Owner media; switching from Collections carries an
                // ephemeral request, never an old Owner's search result.
                navigatePhotosChrome(to: .unified, search: true)
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.body.weight(.semibold))
                    .frame(width: 50, height: 50)
                    .background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("搜索照片")
            .accessibilityIdentifier("native-ios-photos-search")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .accessibilityIdentifier("native-ios-photos-bottom-bar")
    }

    // Keep a critical permission or receipt warning discoverable without a
    // permanent backup strip shrinking the native Photos grid.
    private var galleryBackupStatus: String? {
        if backup.busy { return "正在检查相册备份" }
        guard let state = backup.schedule, state.enabled else { return nil }
        if state.pausedForReview { return "自动备份已暂停：需核对收据" }
        if photoAuthorization != .authorized && photoAuthorization != .limited {
            return "备份计划已保存：照片权限不可用"
        }
        if photoAuthorization == .limited && state.backupStartRule == .onlyNew {
            return "仅新增备份已暂停：需要所有照片权限"
        }
        if photoAuthorization == .limited {
            return "自动备份只覆盖当前选定的照片"
        }
        return nil
    }

    private var galleryMoreMenu: some View {
        Menu {
            Section("图库来源") {
                Button("全部照片") { openGallery(.unified) }
                if gallerySource == .local || gallerySource == .albums {
                    Button("搜索本机照片") { showingLocalPhotoSearch = true }
                        .disabled(photoAuthorization != .authorized &&
                                  photoAuthorization != .limited)
                        .accessibilityIdentifier("native-ios-gallery-local-photo-search")
                }
                Button("本机照片") { openGallery(.local) }
                Button("云端图库") { openGallery(.cloud) }
                Button("备份原件") { openGallery(.originals) }
                Button("地图") { openGallery(.map) }
            }
            Section("备份与管理") {
                if let status = galleryBackupStatus {
                    Button(status) { openBackup(.overview) }
                        .accessibilityIdentifier("native-ios-gallery-backup-status")
                }
                backupMenuItems
            }
            Section("xDrive") {
                Button("全部功能") { tab = .launcher }
                Button("文件") { tab = .files }
                Button("我的") { tab = .mine }
            }
        } label: {
            Image(systemName: backup.schedule?.pausedForReview == true
                ? "exclamationmark.circle" : "ellipsis.circle")
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel("图库来源、备份与 xDrive")
        .accessibilityValue(galleryBackupStatus ?? "备份设置")
        .accessibilityIdentifier("native-ios-gallery-more-menu")
    }

    // L1 native bottom bar. The system safe-area inset remains managed by
    // SwiftUI; 48/56pt here is visual height, not the home-indicator inset.
    // Unlike a TabView tabItem, these buttons support an actual context menu.
    private var nativeBottomBar: some View {
        HStack(spacing: 0) {
            navigationButton(.launcher, title: "全部", symbol: "square.grid.2x2")

            navigationButton(
                .dynamic,
                title: dynamicSlotTitle,
                symbol: dynamicSlotSymbol
            )
            .contextMenu {
                Button {
                    showRecentPicker = true
                } label: {
                    Label("最近功能", systemImage: "clock.arrow.circlepath")
                }
                ForEach(recentDynamic) { feature in
                    Button {
                        openDynamic(feature)
                    } label: {
                        Label(
                            feature.implemented ? feature.title : "\(feature.title)（未接入）",
                            systemImage: feature.symbol
                        )
                    }
                }
            }
            .accessibilityAction(named: Text("最近功能")) {
                showRecentPicker = true
            }

            navigationButton(.gallery, title: "图库", symbol: "photo.on.rectangle")
            navigationButton(.files, title: "文件", symbol: "folder")
            navigationButton(.mine, title: "我的", symbol: "person.crop.circle")
        }
        .padding(.horizontal, 4)
        .frame(height: verticalSizeClass == .compact ? 48 : 56)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-ios-five-slot-bar")
    }

    private func navigationButton(
        _ destination: XDriveIOSNativeBottomTab, title: String, symbol: String
    ) -> some View {
        let selected = tab == destination
        return Button {
            if destination == .dynamic && emptyDynamicMapFallback {
                openGallery(.map)
            } else {
                tab = destination
            }
        } label: {
            Group {
                if verticalSizeClass == .compact {
                    // iPhone landscape: label beside icon, not below it.
                    HStack(spacing: 5) {
                        Image(systemName: symbol).font(.body)
                        Text(title).font(.caption).lineLimit(1)
                    }
                } else {
                    VStack(spacing: 3) {
                        Image(systemName: symbol).font(.body)
                        Text(title).font(.caption2).lineLimit(1)
                    }
                }
            }
            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("native-ios-tab-\(destination.rawValue)")
    }


    @ViewBuilder
    private var backupMenuItems: some View {
        Button("查看备份任务队列") { openBackup(.queue) }
        Button("集中备份（需确认）") { openBackup(.focused) }
        Button("备份设置") { openBackup(.settings) }
        Button("逐项核验当前云端原件") { openBackup(.audit) }
        Button("释放本机缓存空间（不删除照片原件）") { showThumbnailCacheFromBackup = true }
    }

    private func openBackup(_ action: XDriveIOSNativePhotoBackupLaunch) {
        backupLaunchAction = action
        backupLaunchNonce = UUID()
        openDynamic(.backup)
    }

    private func requestPriorityBackup(id: String, failed: Bool) {
        guard let owner = login.owner, phase == .active,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              !backup.busy, !id.isEmpty, id.utf8.count <= 1024,
              !id.contains("\u{0}") else { return }
        priorityItemID = id
        priorityItemOwner = owner
        priorityIsRetry = failed
        showPriorityConsent = true
    }

    private var gallery: some View {
        // Capture the presenting Owner when this source's focus callback is
        // built; a disappearing view must not affect a later Owner's Gallery.
        let focusOwnerKey = ownerScopeKey
        let focusGeneration = galleryFocusGeneration
        return Group {
            switch gallerySource {
                case .unified:
                    XDriveIOSNativeUnifiedPhotoGallery(
                        login: login, openBackup: { openBackup(.overview) },
                        requestSearch: $requestUnifiedPhotoSearch,
                        wallTimeScale: $galleryTimeScale,
                        showTimelineNavigator: $galleryTimelineExpanded,
                        priorityBackup: { id in requestPriorityBackup(id: id, failed: false) },
                        // A different tab covers, but does not scroll-evict,
                        // this bounded verified Gallery wall.
                        isTabActive: tab == .gallery,
                        onShowMap: { range, media, filename in
                            // A dismissed filter sheet may invoke this later.
                            // It cannot present an old Owner's map on a new
                            // tab, after another source or after scene loss.
                            guard phase == .active, tab == .gallery,
                                  gallerySource == .unified,
                                  focusOwnerKey == ownerScopeKey,
                                  focusGeneration == galleryFocusGeneration
                            else { return }
                            unifiedMapCaptureRange = range
                            unifiedMapMediaFilter = media
                            unifiedMapFilenameTerm = filename
                            // The default unified wall represents its full
                            // bounded Gallery, not a previously selected
                            // 64-photo local-map page or stale Viewer GPS.
                            localMapScope = .library
                            localMapJump = nil
                            mapSource = .local
                            presentingUnifiedMap = true
                        }
                    )
                case .local:
                    XDriveIOSNativeLocalPhotoTimelineContainer(
                        savedOffset: $localGalleryPageOffset,
                        mediaFilter: $localGalleryMediaFilter,
                        onMapDateScope: { galleryMapCaptureRange = $0 }
                    )
                    .environment(
                        \.xdriveNativePhotoQueueBadgeOwner,
                        backup.schedule?.enabled == true ? login.owner : nil
                    )
                    .environment(
                        \.xdriveNativePhotoQueueBadgeRefresh,
                        XDriveIOSNativePhotoQueueBadgeRefresh(
                            busy: backup.busy,
                            confirmedID: backup.confirmedOriginalUpdate?.id
                        )
                    )
                case .albums:
                    XDriveIOSNativePhotosCollectionsScreen(
                        login: login, savedAlbumOffset: $localAlbumDirectoryOffset,
                        onOpenMap: { openGallery(.map) }
                    )
                case .cloud:
                    XDriveIOSNativeServerMediaWall(
                        login: login, album: nil,
                        onFocusChange: {
                            updateGalleryFocus(
                                $0, from: .cloud, expectedOwnerKey: focusOwnerKey,
                                expectedGeneration: focusGeneration
                            )
                        }
                    )
                case .originals:
                    XDriveIOSNativeCloudOriginalGallery(
                        login: login,
                        confirmedOriginalUpdate: backup.confirmedOriginalUpdate,
                        isTabActive: tab == .gallery
                    )
                case .map:
                    XDriveIOSNativePhotoMapsScreen(
                        login: login,
                        localMapScope: $localMapScope,
                        localMapPageOffset: $localMapPageOffset,
                        source: $mapSource,
                        cloudMapCamera: $cloudMapCamera,
                        localMapCamera: $localMapCamera,
                        onFocusChange: {
                            updateGalleryFocus(
                                $0, from: .map, expectedOwnerKey: focusOwnerKey,
                                expectedGeneration: focusGeneration
                            )
                        },
                        onClose: { closeGalleryMap() },
                        mediaFilter: localGalleryMediaFilter,
                        inheritedCaptureRange: galleryMapCaptureRange
                    )
                }
        }
        .fullScreenCover(isPresented: $presentingUnifiedMap, onDismiss: {
            unifiedMapCaptureRange = nil
            unifiedMapMediaFilter = .all
            unifiedMapFilenameTerm = ""
            let destination = pendingUnifiedMapDestination
            let wantedSearch = pendingUnifiedMapSearch
            let requestScope = pendingUnifiedMapOwnerScope
            pendingUnifiedMapDestination = nil
            pendingUnifiedMapSearch = false
            pendingUnifiedMapOwnerScope = nil
            // Never execute a stale close callback after an Owner/root change,
            // logout, background transition, or switch to a non-Gallery tab.
            guard let destination, requestScope == ownerScopeKey,
                  phase == .active, tab == .gallery else { return }
            if gallerySource != destination { openGallery(destination) }
            if wantedSearch { requestUnifiedPhotoSearch = true }
        }) {
            // This is the SAME native local/cloud MapKit component used by
            // Gallery's normal Map source, not a second map or media reader.
            // Present it modally so the unified wall remains mounted below.
            NavigationStack {
                XDriveIOSNativePhotoMapsScreen(
                    login: login,
                    localMapScope: $localMapScope,
                    localMapPageOffset: $localMapPageOffset,
                    source: $mapSource,
                    cloudMapCamera: $cloudMapCamera,
                    localMapCamera: $localMapCamera,
                    onClose: { presentingUnifiedMap = false },
                    mediaFilter: unifiedMapMediaFilter,
                    filenameTerm: unifiedMapFilenameTerm,
                    cloudSourceAllowed: true,
                    inheritedCaptureRange: unifiedMapCaptureRange
                )
            }
            // A full-screen source-filtered map is above the Gallery TabView.
            // Give it the SAME floating Photos bar, not a second xDrive tab.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                nativePhotosBottomBar
            }
        }
    }

    /// L2 callbacks may be delivered by a departing cloud/map child after the
    /// user has changed source, tab, or verified Owner. The old callback owns
    /// neither the new source's focus nor its native bottom-bar visibility.
    private func updateGalleryFocus(
        _ focused: Bool,
        from source: XDriveIOSNativeGallerySource,
        expectedOwnerKey: String,
        expectedGeneration: UUID
    ) {
        guard phase == .active, expectedOwnerKey == ownerScopeKey,
              expectedGeneration == galleryFocusGeneration,
              XDriveIOSNativeFocusVisibilityPolicy.acceptsFocusUpdate(
                tab: tab.rawValue, gallerySource: gallerySource.rawValue,
                callbackSource: source.rawValue, ownerVerified: login.owner != nil
              )
        else { return }
        if source == .map {
            // The current admitted map controls this override; a dismissed
            // Gallery child or stale Owner cannot reveal hidden navigation.
            mapNavigationExplicitlyShown = !focused
        }
        galleryFocused = focused
    }

    private var launcher: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                TextField("搜索功能", text: $launcherQuery)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("native-ios-launcher-search")
                if !recentDynamic.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("最近使用").font(.headline)
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(recentDynamic) { feature in
                                    Button {
                                        openDynamic(feature)
                                    } label: {
                                        Label(feature.title, systemImage: feature.symbol)
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                }
                ForEach(["内容浏览", "设备与备份", "任务与工具"], id: \.self) { category in
                    let candidates = XDriveIOSNativeLauncherRoute.allCases.filter {
                        $0.category == category &&
                        (launcherQuery.isEmpty || $0.title.localizedCaseInsensitiveContains(launcherQuery))
                    }
                    if !candidates.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(category).font(.headline)
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 78, maximum: 115), spacing: 12)],
                                spacing: 14
                            ) {
                                ForEach(candidates) { route in
                                    Button { open(route) } label: {
                                        VStack(spacing: 7) {
                                            Image(systemName: route.symbol)
                                                .font(.title2)
                                                .frame(width: 54, height: 54)
                                                .background(
                                                    Color(uiColor: .secondarySystemGroupedBackground),
                                                    in: RoundedRectangle(cornerRadius: 13)
                                                )
                                            Text(route.title).font(.caption).lineLimit(1)
                                            if !route.available {
                                                Text("未接入").font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("native-ios-launcher-\(route.rawValue)")
                                }
                            }
                        }
                    }
                }
                Text("服务器管理员入口只在真实验证 Server 管理员角色后开放；当前原生会话未建立管理权限。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(14)
        }
    }

    @ViewBuilder
    private var dynamicPage: some View {
        if let feature = dynamicFeature {
            switch feature {
            case .notes:
                XDriveIOSNativeNotesScreen(login: login)
            case .clipboard:
                XDriveIOSNativeClipboardScreen(login: login) { openedOwner, node in
                    guard tab == .dynamic, dynamicFeature == .clipboard,
                          phase == .active,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner),
                          node.type == "file", node.id > 0, node.revision > 0
                    else { return }
                    clipboardViewerIntent = ClipboardViewerIntent(node: node, owner: openedOwner)
                }
            case .backup:
                XDriveIOSNativePhotoBackupScreen(
                    login: login, controller: backup,
                    launchAction: backupLaunchAction, launchNonce: backupLaunchNonce
                ) {
                    // Navigation only: never infer that a pending receipt is backed up.
                    guard login.owner != nil else { return }
                    openGallery(.originals)
                }
            case .transfers:
                XDriveIOSNativeTransfersScreen(
                    transfers: transfers, backup: backup, owner: login.owner,
                    openFiles: { tab = .files },
                    openBackup: { openDynamic(.backup) }
                )
            default:
                unavailable(
                    title: "\(feature.title)尚未接通",
                    detail: "该功能在其他平台存在，但 iOS 原生数据与权限接口尚未实现，不能显示模拟结果。"
                )
            }
        } else {
            VStack(spacing: 15) {
                Label("地图", systemImage: "map")
                    .font(.headline)
                Text("尚无最近动态功能，地图作为默认入口。")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("打开地图") { openGallery(.map) }
                    .buttonStyle(.borderedProminent)
            }
            .padding(24)
        }
    }

    private var files: some View {
        XDriveIOSNativeFilesBrowser(login: login)
    }

    private var mine: some View {
        Form {
            Section("本机存储") {
                NavigationLink("缩略图缓存") { XDriveIOSNativePhotoThumbnailCacheScreen(login: login) }
                    .disabled(login.owner == nil)
            }
            Section("当前服务器和账户") {
                if let owner = login.owner {
                    LabeledContent("服务器", value: owner.origin.host ?? owner.origin.absoluteString)
                    LabeledContent("用户", value: owner.username)
                    LabeledContent("Owner", value: String(owner.ownerID))
                    LabeledContent("根目录", value: String(owner.rootNodeID))
                    Label("已验证原生 Owner 身份", systemImage: "checkmark.shield")
                } else {
                    Text("尚未登录").foregroundStyle(.secondary)
                }
                if let logoutWarning {
                    Text(logoutWarning)
                        .foregroundStyle(.orange)
                        .font(.footnote)
                        .accessibilityIdentifier("native-ios-mine-logout-warning")
                }
                if signingOut { ProgressView("正在安全退出当前账户…") }
                Button("退出并切换服务器或账户", role: .destructive) {
                    signOutConsentOwner = login.owner
                    showSignOutConsent = signOutConsentOwner != nil
                }
                .disabled(signingOut || login.owner == nil)
                .accessibilityIdentifier("native-ios-mine-server-account")
            }
            Section("iPhone 相册") {
                let granted = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                Text(granted == .authorized ? "完整照片权限" :
                    granted == .limited ? "部分照片权限" : "照片权限尚未授予或不可用")
                Button("相册与照片墙") {
                    gallerySource = .unified
                    tab = .gallery
                }
            }
            Section("界面和管理") {
                Text("账户退出及服务器切换直接在「我的」完成；若正在上传原件，先在相册备份页取消本轮，再退出。")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("主题、完整文件管理、服务器管理员功能仍待原生实现和授权验证。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func unavailable(title: String, detail: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "info.circle")
                .font(.largeTitle).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail).font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    private func open(_ route: XDriveIOSNativeLauncherRoute) {
        switch route {
        case .local:
            openGallery(.local)
        case .albums:
            openGallery(.albums)
        case .cloud:
            openGallery(.cloud)
        case .originals:
            openGallery(.originals)
        case .map:
            openGallery(.map)
        case .files:
            tab = .files
        case .notes:
            openDynamic(.notes)
        case .clipboard:
            openDynamic(.clipboard)
        case .backup:
            openDynamic(.backup)
        case .transfers:
            openDynamic(.transfers)
        case .sync:
            openDynamic(.sync)
        case .storage:
            openDynamic(.storage)
        case .devices:
            openDynamic(.devices)
        case .diagnostics:
            openDynamic(.diagnostics)
        }
    }

    private func openGallery(_ source: XDriveIOSNativeGallerySource) {
        if source == .map {
            if gallerySource != .map {
                mapOpenedFromCollections = tab == .gallery && gallerySource == .albums
                // Only an active, authenticated Gallery supplies return state.
                // Launcher and dynamic shortcuts use the default.
                mapReturnGallerySource = tab == .gallery && login.owner != nil
                    ? gallerySource : nil
                mapReturnOwnerScopeKey = mapReturnGallerySource != nil
                    ? ownerScopeKey : nil
            }
        } else {
            mapOpenedFromCollections = false
            mapReturnGallerySource = nil
            mapReturnOwnerScopeKey = nil
        }
        galleryFocusGeneration = UUID()
        // Preserve the same map instance/camera. Only the surrounding
        // Dashboard chrome changes; no PhotoKit/Owner Reader restarts.
        galleryFocused = source == .map
        mapNavigationExplicitlyShown = false
        if source == .map || source == .local { localMapJump = nil }
        gallerySource = source
        tab = .gallery
        // Gallery/map/Viewer are never dynamic feature-slot destinations.
    }

    private func closeGalleryMap() {
        // Local PhotoKit MapKit also works while signed out; only the
        // captured return source stays strictly Server Owner scoped.
        guard gallerySource == .map else { return }
        // New unified Photos is the default when present; legacy builds
        // safely return to the local Gallery without a captured entry.
        let fallback = XDriveIOSNativeGallerySource(rawValue: "unified") ?? .local
        let prior = mapReturnOwnerScopeKey == ownerScopeKey
            ? mapReturnGallerySource : nil
        // The signed-out local PhotoKit map still remembers a Collections
        // entry without inventing an Owner return lease.
        openGallery(mapOpenedFromCollections ? .albums : (prior ?? fallback))
    }

    private func openDynamic(_ feature: XDriveIOSNativeDynamicFeature) {
        dynamicFeature = feature
        recentDynamic.removeAll { $0 == feature }
        recentDynamic.insert(feature, at: 0)
        if recentDynamic.count > 6 { recentDynamic.removeLast() }
        tab = .dynamic
    }

    private func restoreNavigationIfNeeded() {
        guard login.owner != nil, routeRestoreScopeKey != ownerScopeKey else { return }
        routeRestoreScopeKey = ownerScopeKey
        guard let scopeHash = navigationScopeHash,
              let snapshot = navigationRouteStore.restore(scopeHash: scopeHash)
        else { return }

        // Only known, implemented routes are restored. Child PhotoKit pages
        // re-query their own permission and Owner-signed Server data.
        let savedGallery = XDriveIOSNativeGallerySource(rawValue: snapshot.gallerySource)
        gallerySource = savedGallery == .local || savedGallery == .cloud ? .unified : (savedGallery ?? .unified)
        // Migrate legacy page-only map routes to the full authorized Photos map.
        localMapScope = .library
        // Legacy page offsets are no longer a user-visible map destination.
        localMapPageOffset = 0
        localGalleryPageOffset = snapshot.localGalleryPageOffset ?? 0
        localAlbumDirectoryOffset = snapshot.localAlbumDirectoryOffset ?? 0
        dynamicFeature = snapshot.activeDynamic.flatMap {
            XDriveIOSNativeDynamicFeature(rawValue: $0)
        }
        recentDynamic = snapshot.recentDynamic.compactMap {
            XDriveIOSNativeDynamicFeature(rawValue: $0)
        }
        tab = XDriveIOSNativeBottomTab(rawValue: snapshot.selectedTab) ?? .gallery
    }

    private func saveNavigationIfReady() {
        guard login.owner != nil, routeRestoreScopeKey == ownerScopeKey,
              let scopeHash = navigationScopeHash else { return }
        navigationRouteStore.save(
            scopeHash: scopeHash,
            selectedTab: tab.rawValue,
            gallerySource: gallerySource.rawValue,
            activeDynamic: dynamicFeature?.implemented == true ? dynamicFeature?.rawValue : nil,
            recentDynamic: recentDynamic.filter { $0.implemented }.map { $0.rawValue },
            mapScope: localMapScope.rawValue,
            mapPageOffset: localMapPageOffset,
            localGalleryPageOffset: localGalleryPageOffset,
            localAlbumDirectoryOffset: localAlbumDirectoryOffset
        )
    }

    private func resetNavigation() {
        galleryFocusGeneration = UUID()
        galleryFocused = false
        galleryTimelineExpanded = false
        galleryTimeScale = .all
        mapNavigationExplicitlyShown = false
        mapOpenedFromCollections = false
        mapReturnGallerySource = nil
        mapReturnOwnerScopeKey = nil
        gallerySource = .unified
        localMapScope = .library
        localMapPageOffset = 0
        localMapJump = nil
        galleryMapCaptureRange = nil
        presentingUnifiedMap = false
        pendingUnifiedMapDestination = nil
        pendingUnifiedMapSearch = false
        pendingUnifiedMapOwnerScope = nil
        unifiedMapCaptureRange = nil
        unifiedMapMediaFilter = .all
        unifiedMapFilenameTerm = ""
        mapSource = .local
        cloudMapCamera = nil
        localMapCamera = nil
        localAlbumDirectoryOffset = 0
        localGalleryPageOffset = 0
        dynamicFeature = nil
        recentDynamic = []
        tab = .gallery
        launcherQuery = ""
        showRecentPicker = false
    }
}
