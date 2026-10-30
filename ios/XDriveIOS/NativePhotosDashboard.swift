import CryptoKit
import Photos
import SwiftUI

private enum XDriveIOSNativeBottomTab: String {
    case launcher, dynamic, gallery, files, mine
}

private enum XDriveIOSNativeGallerySource: String, CaseIterable, Identifiable {
    case local, albums, cloud, map
    var id: String { rawValue }
    var title: String {
        switch self {
        case .local: return "本机照片"
        case .albums: return "相册"
        case .cloud: return "云端原件"
        case .map: return "地图"
        }
    }
}

private enum XDriveIOSNativeDynamicFeature: String, CaseIterable, Identifiable {
    case backup, transfers, sync, storage, devices, diagnostics
    var id: String { rawValue }
    var title: String {
        switch self {
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
        case .backup: return "icloud.and.arrow.up"
        case .transfers: return "arrow.up.arrow.down"
        case .sync: return "arrow.triangle.2.circlepath"
        case .storage: return "externaldrive"
        case .devices: return "iphone.gen3"
        case .diagnostics: return "waveform.path.ecg"
        }
    }
    var implemented: Bool { self == .backup }
}

private enum XDriveIOSNativeLauncherRoute: String, CaseIterable, Identifiable {
    case local, albums, cloud, map, files
    case backup, transfers, sync, storage, devices, diagnostics
    var id: String { rawValue }
    var title: String {
        switch self {
        case .local: return "本机照片"
        case .albums: return "相册"
        case .cloud: return "云端原件"
        case .map: return "地图"
        case .files: return "文件"
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
        case .cloud: return "icloud"
        case .map: return "map"
        case .files: return "folder"
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
        case .local, .albums, .cloud, .backup: return true
        default: return false
        }
    }
    var category: String {
        switch self {
        case .local, .albums, .cloud, .map, .files: return "内容浏览"
        case .backup, .devices, .sync: return "设备与备份"
        case .transfers, .storage, .diagnostics: return "任务与工具"
        }
    }
}

/// Native Photos-first five-slot shell. All routes are native SwiftUI/UIKit;
/// unfinished domains remain explicitly unavailable rather than embedded browser
/// fallbacks or fake success. No separate Owner session or upload runner.
struct XDriveIOSNativePhotosDashboard: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var backup: XDriveIOSNativePhotoBackupController
    @Environment(\.dismiss) private var dismiss
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var tab: XDriveIOSNativeBottomTab = .gallery
    @State private var gallerySource: XDriveIOSNativeGallerySource = .local
    @State private var dynamicFeature: XDriveIOSNativeDynamicFeature?
    @State private var recentDynamic: [XDriveIOSNativeDynamicFeature] = []
    @State private var launcherQuery = ""
    @State private var showRecentPicker = false
    @State private var routeRestoreScopeKey: String?
    private let navigationRouteStore = XDriveIOSNativeNavigationRouteStore()

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
        TabView(selection: $tab) {
            NavigationStack {
                launcher
                    .navigationTitle("全部")
            }
            .tabItem { Label("全部", systemImage: "square.grid.2x2") }
            .tag(XDriveIOSNativeBottomTab.launcher)

            NavigationStack {
                dynamicPage
                    .navigationTitle(dynamicFeature?.title ?? "最近")
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
                Label(dynamicFeature?.title ?? "最近",
                      systemImage: dynamicFeature?.symbol ?? "clock.arrow.circlepath")
            }
            .tag(XDriveIOSNativeBottomTab.dynamic)

            NavigationStack {
                gallery
                    .navigationTitle("图库")
                    .navigationBarTitleDisplayMode(.inline)
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
            nativeBottomBar
        }
        .id(ownerScopeKey)
        .navigationBarBackButtonHidden(true)
        .sheet(isPresented: $showRecentPicker) {
            NavigationStack {
                List {
                    if recentDynamic.isEmpty {
                        Text("还没有打开过其他功能。可以从「全部」启动相册备份。")
                            .foregroundStyle(.secondary)
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
        .onAppear {
            restoreNavigationIfNeeded()
            backup.refresh(owner: login.owner)
        }
        .onChange(of: ownerScopeKey) { _ in
            // TabView .id does not reset this parent's @State. Revoke the old
            // Owner's saved UI route even if switching A -> B -> A in one scene.
            routeRestoreScopeKey = nil
            navigationRouteStore.clear()
            if login.owner != nil { routeRestoreScopeKey = ownerScopeKey }
            // The app-root durable original/receipt runner is never touched.
            resetNavigation()
        }
        .onChange(of: login.owner) { owner in
            if owner == nil {
                navigationRouteStore.clear()
                resetNavigation()
                dismiss()
            }
        }
        .onChange(of: tab) { _ in saveNavigationIfReady() }
        .onChange(of: gallerySource) { _ in saveNavigationIfReady() }
        .onChange(of: dynamicFeature) { _ in saveNavigationIfReady() }
        .onChange(of: recentDynamic) { _ in saveNavigationIfReady() }
    }

    // L1 native bottom bar. The system safe-area inset remains managed by
    // SwiftUI; 48/56pt here is visual height, not the home-indicator inset.
    // Unlike a TabView tabItem, these buttons support an actual context menu.
    private var nativeBottomBar: some View {
        HStack(spacing: 0) {
            navigationButton(.launcher, title: "全部", symbol: "square.grid.2x2")

            navigationButton(
                .dynamic,
                title: dynamicFeature?.title ?? "最近",
                symbol: dynamicFeature?.symbol ?? "clock.arrow.circlepath"
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
        .accessibilityIdentifier("native-ios-five-slot-bar")
    }

    private func navigationButton(
        _ destination: XDriveIOSNativeBottomTab, title: String, symbol: String
    ) -> some View {
        let selected = tab == destination
        return Button {
            tab = destination
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

    private var gallery: some View {
        VStack(spacing: 0) {
            Picker("图库来源", selection: $gallerySource) {
                ForEach(XDriveIOSNativeGallerySource.allCases) { source in
                    Text(source.title).tag(source)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Group {
                switch gallerySource {
                case .local:
                    XDriveIOSNativeLocalGalleryScreen()
                case .albums:
                    XDriveIOSNativePhotoAlbumsScreen()
                case .cloud:
                    XDriveIOSNativeCloudOriginalGallery(login: login)
                case .map:
                    unavailable(
                        title: "图库地图尚在原生迁移",
                        detail: "地图归属于图库，不占动态位置；当前版本未接入原生地图和照片聚合。"
                    )
                }
            }
        }
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
            case .backup:
                XDriveIOSNativePhotoBackupScreen(login: login, controller: backup)
            default:
                unavailable(
                    title: "\(feature.title)尚未接通",
                    detail: "该功能在其他平台存在，但 iOS 原生数据与权限接口尚未实现，不能显示模拟结果。"
                )
            }
        } else {
            VStack(spacing: 15) {
                Label("最近功能", systemImage: "clock.arrow.circlepath")
                    .font(.headline)
                Text("从「全部」选择相册备份、设备或任务。这里会记住最近打开的非固定功能。")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("打开相册备份") { openDynamic(.backup) }
                    .buttonStyle(.borderedProminent)
            }
            .padding(24)
        }
    }

    private var files: some View {
        unavailable(
            title: "原生文件管理正在迁移",
            detail: "目前只能通过「图库 → 云端原件」安全查看这台 iPhone 已备份的原件；它不是完整文件树。"
        )
        .safeAreaInset(edge: .bottom) {
            Button("查看云端已备份原件") {
                gallerySource = .cloud
                tab = .gallery
            }
            .buttonStyle(.bordered)
            .padding(10)
        }
    }

    private var mine: some View {
        Form {
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
                Button("返回服务器与账号管理") { dismiss() }
                    .accessibilityIdentifier("native-ios-mine-server-account")
            }
            Section("iPhone 相册") {
                let granted = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                Text(granted == .authorized ? "完整照片权限" :
                    granted == .limited ? "部分照片权限" : "照片权限尚未授予或不可用")
                Button("相册与照片墙") {
                    gallerySource = .local
                    tab = .gallery
                }
            }
            Section("界面和管理") {
                Text("账户切换和退出请在服务器账号页按现有安全流程执行。")
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
        case .map:
            openGallery(.map)
        case .files:
            tab = .files
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
        gallerySource = source
        tab = .gallery
        // Gallery/map/Viewer are never dynamic feature-slot destinations.
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
        gallerySource = XDriveIOSNativeGallerySource(rawValue: snapshot.gallerySource) ?? .local
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
            recentDynamic: recentDynamic.filter { $0.implemented }.map { $0.rawValue }
        )
    }

    private func resetNavigation() {
        gallerySource = .local
        dynamicFeature = nil
        recentDynamic = []
        tab = .gallery
        launcherQuery = ""
        showRecentPicker = false
    }
}
