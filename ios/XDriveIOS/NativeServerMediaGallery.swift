import AVKit
import Combine
import SwiftUI
import UIKit

/// Only one 48-item logical PhotoAsset range is held at a time.
@MainActor
final class XDriveIOSNativeMediaWallModel: ObservableObject {
    @Published private(set) var page: XDriveIOSNativeMediaRange?
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var failedOffset: Int?

    private var pageScope: XDriveNativeOwnerRoot?
    private var pageAlbumID: String?
    private var pageSearch = ""
    private var epoch = UUID()
    private var job: Task<Void, Never>?
    private var currentReader: XDriveIOSNativeMediaGalleryReader?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        currentReader = nil
        page = nil
        pageScope = nil
        pageAlbumID = nil
        pageSearch = ""
        failedOffset = nil
        busy = false
        error = nil
    }

    func suspendForViewer() {
        // A Viewer or an album child route can temporarily cover the wall.
        // Keep its 48-item page and exact source anchor for the return path.
        // Retire the request generation so a cancelled URLSession error
        // cannot overwrite the returned page after navigation.
        epoch = UUID()
        job?.cancel()
        job = nil
        busy = false
    }

    func suspendForNavigation() {
        suspendForViewer()
    }

    /// Retain a previously verified page only for a transient transport
    /// problem. Access revocation, missing albums, invalid responses, TLS
    /// trust failures and malformed media must immediately clear old rows.
    private static func canRetainPage(after error: Error) -> Bool {
        if let failure = error as? XDriveIOSNativeMediaReadFailure {
            switch failure {
            case .response(let status):
                return XDriveIOSNativeMediaPageRetryPolicy
                    .permitsRetainingPreviousPage(httpStatus: status)
            case .invalidScope, .invalidPage, .unsupported,
                 .malformed, .tooLarge:
                return false
            }
        }
        guard let network = error as? URLError else { return false }
        return XDriveIOSNativeMediaPageRetryPolicy
            .permitsRetainingPreviousPage(urlError: network.code)
    }

    func load(login: XDriveIOSNativeOwnerLoginModel,
              albumID: String?, offset: Int = 0, search: String = "") {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.unicodeScalars.count <= 200 else {
            error = "搜索关键词最多 200 个字符。"
            return
        }
        guard let expected = login.owner else {
            invalidate()
            error = "当前尚未建立经过验证的服务器账户。"
            return
        }
        // Only the same verified Owner AND album may retain an earlier page
        // while the requested range loads. A different scope clears it first.
        let keepOldPage = pageScope.map {
            XDriveIOSNativePhotoOwnerScope.matches(expected, $0)
        } == true && pageAlbumID == albumID && pageSearch == query
        epoch = UUID()
        job?.cancel()
        job = nil
        if !keepOldPage {
            page = nil
            currentReader = nil
            pageScope = nil
            pageAlbumID = nil
            pageSearch = ""
        }
        failedOffset = nil
        error = nil
        let ticket = epoch
        busy = true
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.busy = false
                    self?.job = nil
                }
            }
            do {
                // Reverify Owner/root before retaining any previous page. A
                // revoked/expired native account cannot keep cached filenames.
                let auth: (owner: XDriveNativeOwnerRoot, accessToken: String)
                do {
                    auth = try await login.verifiedAuthorization()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    guard self?.epoch == ticket else { return }
                    self?.invalidate()
                    self?.error = "当前账户身份验证失败，已隐藏旧云端照片；请重新登录或重试。"
                    return
                }
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    self?.invalidate()
                    self?.error = "当前服务器或 Owner 已变化，旧图库已清除。"
                    return
                }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let result = try await reader.page(
                    offset: offset, albumID: albumID, search: query
                )
                try Task.checkCancellation()
                guard self?.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self?.currentReader = reader
                self?.page = result
                self?.pageScope = expected
                self?.pageAlbumID = albumID
                self?.pageSearch = query
                self?.failedOffset = nil
            } catch is CancellationError {
            } catch {
                guard self?.epoch == ticket else { return }
                // A verified Server can still revoke access or delete an
                // album between page requests. Never show cached rows after
                // a definitive 4xx/invalid response, even if the Owner was
                // verified immediately before this request.
                guard XDriveIOSNativeMediaWallModel.canRetainPage(after: error) else {
                    self?.invalidate()
                    self?.error = "云端照片访问权限已变化或内容无效；旧页面已清除。"
                    return
                }
                // Only transient network/rate-limit/server failures may
                // preserve the old verified page and retry the exact offset.
                self?.failedOffset = offset
                self?.error = "云端 PhotoAsset 读取失败；已保留当前浏览页，可重试刚才的分页请求。"
            }
        }
    }

    func thumbnail(_ item: XDriveIOSNativeMediaItem,
                   login: XDriveIOSNativeOwnerLoginModel) async throws -> UIImage {
        let ticket = epoch
        guard let reader = currentReader,
              page?.items.contains(where: {
                $0.id == item.id && $0.node.revision == item.node.revision
              }) == true,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        let image = try await reader.thumbnail(item)
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        return image
    }
}

private struct XDriveIOSNativeMediaWallTile: View {
    let item: XDriveIOSNativeMediaItem
    @ObservedObject var model: XDriveIOSNativeMediaWallModel
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 112).clipped()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay {
                        Image(systemName: item.isVideo ? "video" : "photo")
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 112)
            }
            if item.isVideo || item.isLive {
                Image(systemName: item.isVideo ? "play.circle.fill" : "livephoto")
                    .foregroundStyle(.white).padding(6).shadow(radius: 2)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel(
            item.isLive ? "实况媒体：\(item.node.name)" :
                item.isVideo ? "视频：\(item.node.name)" : "照片：\(item.node.name)"
        )
        .task(id: "\(item.id)-\(item.node.revision)") {
            do {
                let result = try await model.thumbnail(item, login: login)
                try Task.checkCancellation()
                image = result
            } catch {
                // No thumbnail derivative does NOT mean the original is absent.
            }
        }
        .onDisappear { image = nil }
    }
}

/// Fullscreen media View. Playback is dismissed immediately when the verified
/// Owner changes; cloud Live motion is not faked from the representative still.
struct XDriveIOSNativeServerMediaPreview: View {
    let item: XDriveIOSNativeMediaItem
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var previewRequestID = UUID()
    @State private var image: UIImage?
    @State private var player: AVPlayer?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if let player {
                    VideoPlayer(player: player)
                        .onAppear { player.play() }
                } else if let image {
                    XDriveIOSNativeZoomablePhotoView(image: image)
                } else if let failure {
                    Text(failure).foregroundStyle(.secondary).padding()
                } else {
                    ProgressView("正在验证并打开云端媒体…")
                }
                if item.isLive {
                    Text("此项属于云端 Live Photo；目前只支持静态预览，原件动态配对播放尚未接通。")
                        .font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                }
            }
            .navigationTitle(item.node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task(id: previewRequestID) {
            // Signed previews must not survive a scene/Owner generation.
            guard phase == .active, let expected = login.owner else { return }
            let requestID = previewRequestID
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                let media = try await XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).preview(item)
                try Task.checkCancellation()
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                image = media.image
                if let url = media.videoURL { player = AVPlayer(url: url) }
            } catch is CancellationError {
                // The generation has retired. Do not display a stale error.
            } catch {
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                failure = "该云端媒体预览暂不可用，未读取其他账户的数据。"
            }
        }
        .onChange(of: phase) { _ in
            // iOS app switcher must not expose the previous signed still/video.
            // A fresh active generation re-verifies the Owner before loading.
            retirePreview()
        }
        .onChange(of: login.owner) { _ in
            retirePreview()
            dismiss()
        }
        .onDisappear { retirePreview() }
    }

    private func retirePreview() {
        // Also cancels the .task(id:) network/decoder generation.
        previewRequestID = UUID()
        player?.pause()
        player = nil
        image = nil
        failure = nil
    }
}

/// Root and album-specific media wall share one Owner-verified ranged source.
struct XDriveIOSNativeServerMediaWall: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let album: XDriveIOSNativeMediaAlbum?
    // Focus visibility belongs to the owning native five-tab shell.
    var onFocusChange: ((Bool) -> Void)? = nil
    @StateObject private var model = XDriveIOSNativeMediaWallModel()
    @Environment(\.scenePhase) private var phase
    @State private var selected: XDriveIOSNativeMediaItem?
    @State private var searchDraft = ""
    @State private var appliedSearch = ""
    @State private var lastOpenedMediaID: UInt64?
    @State private var focusedBrowsing = false

    var body: some View {
        ScrollViewReader { returnScroll in
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text(album == nil ?
                    "服务器 PhotoAsset 全库照片墙（非仅 iPhone 备份目录）。" :
                    "已验证的云端相册成员，按服务器分页读取。")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    TextField("搜索当前云端图库", text: $searchDraft)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { applySearch() }
                        .accessibilityIdentifier("native-ios-server-gallery-search")
                    Button("搜索") { applySearch() }
                        .disabled(model.busy || searchDraft.unicodeScalars.count > 200)
                    if !appliedSearch.isEmpty {
                        Button("清除") {
                            searchDraft = ""
                            appliedSearch = ""
                            model.load(login: login, albumID: album?.id, search: "")
                        }
                        .disabled(model.busy)
                    }
                }
                if searchDraft.unicodeScalars.count > 200 {
                    Text("搜索词不能超过 200 个字符。")
                        .font(.caption).foregroundStyle(.red)
                }
                if let page = model.page {
                    Text(page.total_count == 0 ?
                        "当前没有已索引且可访问的云端媒体；这不代表服务器没有原件。" :
                        "照片 \(page.offset + 1)–\(page.offset + page.items.count) / \(page.total_count)")
                        .font(.caption).foregroundStyle(.secondary)
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 90, maximum: 145), spacing: 3)],
                        spacing: 3
                    ) {
                        ForEach(page.items) { item in
                            Button { selected = item } label: {
                                XDriveIOSNativeMediaWallTile(
                                    item: item, model: model, login: login
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(!item.supportsPreview)
                            .accessibilityIdentifier("native-ios-server-media-tile")
                            .id(item.id)
                        }
                    }
                    HStack {
                        Button("上一页") {
                            model.load(login: login, albumID: album?.id,
                                       offset: max(0, page.offset - 48), search: appliedSearch)
                        }
                        .disabled(model.busy || page.offset == 0)
                        Spacer()
                        Button("下一页") {
                            model.load(login: login, albumID: album?.id,
                                       offset: page.offset + page.items.count, search: appliedSearch)
                        }
                        .disabled(model.busy || page.offset + page.items.count >= page.total_count)
                    }.buttonStyle(.bordered)
                }
                if model.busy { ProgressView("读取云端图库…") }
                if let message = model.error {
                    Text(message).foregroundStyle(.red)
                    Button("重试读取") {
                        model.load(login: login, albumID: album?.id,
                                   offset: model.failedOffset ?? model.page?.offset ?? 0,
                                   search: appliedSearch)
                    }
                }
                Text("每次最多保留 48 个逻辑媒体；只有当前可见图片申请授权缩略图。缩略图缺失不代表原件丢失。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(12)
        }
        .onChange(of: selected?.id) { selectedID in
            if let selectedID {
                lastOpenedMediaID = selectedID
            } else if let anchor = lastOpenedMediaID,
                      model.page?.items.contains(where: { $0.id == anchor }) == true {
                // Return to the exact logical item, not the first page.
                returnScroll.scrollTo(anchor, anchor: .center)
            }
        }
        .navigationTitle(album?.name ?? "云端图库")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if album == nil {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        XDriveIOSNativeServerMediaAlbums(
                            login: login, onFocusChange: onFocusChange
                        )
                    } label: {
                        Label("云端相册", systemImage: "rectangle.stack")
                    }
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    focusedBrowsing.toggle()
                    onFocusChange?(focusedBrowsing)
                } label: {
                    Label(
                        focusedBrowsing ? "显示底部导航" : "专注浏览",
                        systemImage: focusedBrowsing ?
                            "arrow.down.right.and.arrow.up.left" :
                            "arrow.up.left.and.arrow.down.right"
                    )
                }
                .accessibilityIdentifier("native-ios-gallery-focus-toggle")
            }
        }
        // The owning five-tab shell controls its custom bar; never show a
        // second system strip through a child toolbar override.
        .fullScreenCover(item: $selected) {
            XDriveIOSNativeServerMediaPreview(item: $0, login: login)
        }
        .onAppear {
            if model.page == nil, !model.busy {
                model.load(login: login, albumID: album?.id, search: appliedSearch)
            }
        }
        .onChange(of: login.owner) { _ in
            focusedBrowsing = false
            onFocusChange?(false)
            lastOpenedMediaID = nil
            selected = nil
            model.invalidate()
            if login.owner != nil && phase == .active {
                model.load(login: login, albumID: album?.id, search: appliedSearch)
            }
        }
        .onChange(of: phase) { state in
            if state != .active {
                focusedBrowsing = false
                onFocusChange?(false)
                selected = nil
                model.invalidate()
            } else if model.page == nil {
                model.load(login: login, albumID: album?.id, search: appliedSearch)
            }
        }
        .onDisappear {
            if selected != nil {
                model.suspendForViewer()
            } else {
                // A different feature/album should not inherit this wall's
                // L2 focus state or hide the global bottom navigation.
                focusedBrowsing = false
                onFocusChange?(false)
                model.suspendForNavigation()
            }
        }
        }

    }

    private func applySearch() {
        let query = searchDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.unicodeScalars.count <= 200 else { return }
        if query == appliedSearch && model.page != nil { return }
        appliedSearch = query
        lastOpenedMediaID = nil
        model.load(login: login, albumID: album?.id, offset: 0, search: query)
    }
}

/// Server collection index is distinct from local PhotoKit smart/user albums.
struct XDriveIOSNativeServerMediaAlbums: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    var onFocusChange: ((Bool) -> Void)? = nil
    @Environment(\.scenePhase) private var phase
    @State private var albums: [XDriveIOSNativeMediaAlbum] = []
    @State private var error: String?
    @State private var busy = false
    @State private var job: Task<Void, Never>?
    @State private var epoch = UUID()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("云端相册归属于当前 Server Owner，与 iPhone 本机相册分开管理。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(albums) { album in
                    NavigationLink {
                        XDriveIOSNativeServerMediaWall(
                            login: login, album: album, onFocusChange: onFocusChange
                        )
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "rectangle.stack")
                            VStack(alignment: .leading, spacing: 4) {
                                Text(album.name)
                                Text("\(album.item_count) 项 · \(album.kind)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                }
                if busy { ProgressView("读取云端相册…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重新读取") { reload() }
                }
                if !busy && error == nil && albums.isEmpty {
                    Text("当前 Owner 没有云端相册，或没有可显示的相册。")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
        .navigationTitle("云端相册")
        .onAppear { if albums.isEmpty { reload() } }
        .onChange(of: login.owner) { _ in
            invalidate()
            if login.owner != nil { reload() }
        }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            // Pushing an album wall must not remove the NavigationLink's
            // underlying album identity from its original list. Retire the
            // generation before cancelling so late results cannot write back.
            epoch = UUID()
            job?.cancel()
            job = nil
            busy = false
        }
    }

    private func reload() {
        invalidate()
        guard let expected = login.owner else {
            error = "当前未登录已验证的服务器账户。"
            return
        }
        let ticket = epoch
        busy = true
        job = Task { @MainActor in
            defer { if epoch == ticket { busy = false; job = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                let items = try await XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).albums()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                albums = items
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "无法读取当前 Owner 的云端相册，请检查网络或权限。"
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        albums = []
        error = nil
        busy = false
    }
}
