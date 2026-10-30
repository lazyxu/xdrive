import Foundation
import Photos
import SwiftUI
import UIKit

import Combine

/// PhotoKit change callbacks may arrive off-main. The visible album wall
/// drops its page immediately instead of keeping a revoked/changed member.
private final class XDriveIOSNativeAlbumChangeMonitor: NSObject, ObservableObject,
    PHPhotoLibraryChangeObserver {
    @Published private(set) var revision = 0
    private var registered = false

    func start() {
        guard !registered else { return }
        PHPhotoLibrary.shared().register(self)
        registered = true
    }

    func stop() {
        guard registered else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        registered = false
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in
            self?.revision &+= 1
        }
    }

    deinit { stop() }
}

// Local PhotoKit collection IDs are transient, in-memory view identities.
// Never persist them, send them to xDrive Server, or use them as backup receipts.
private enum XDriveIOSAlbumReadFailure: Error {
    case unauthorized
    case changed
    case missing
}

private final class XDriveIOSAlbumLibraryObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var version: UInt64 = 0

    func current() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return version
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        version &+= 1
        lock.unlock()
    }
}

/// A dedicated read-only album cursor. Does not change the whole-library
/// scanner used by the encrypted original-upload ledger.
actor XDriveIOSNativeAlbumPageReader {
    private let observer = XDriveIOSAlbumLibraryObserver()
    private var registered = false
    private var snapshot: PHFetchResult<PHAsset>?
    private var permission: PHAuthorizationStatus?
    private var version: UInt64 = 0

    deinit {
        if registered {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        }
    }

    func open(_ album: XDriveLocalPhotoAlbumSummary) throws -> Int {
        reset()
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw XDriveIOSAlbumReadFailure.unauthorized
        }
        guard let collection = PHAssetCollection.fetchAssetCollections(
            withLocalIdentifiers: [album.collectionIdentifier], options: nil
        ).firstObject else {
            throw XDriveIOSAlbumReadFailure.missing
        }
        let name = collection.localizedTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentName = name?.isEmpty == false ? name! : "未命名相册"
        let kind = collection.assetCollectionType == .album ? "用户相册" :
            collection.assetCollectionType == .smartAlbum ? "系统智能相册" : ""
        guard currentName == album.name, kind == album.kind else {
            throw XDriveIOSAlbumReadFailure.changed
        }

        PHPhotoLibrary.shared().register(observer)
        registered = true
        version = observer.current()
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(in: collection, options: options)
        guard observer.current() == version,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            reset()
            throw XDriveIOSAlbumReadFailure.changed
        }
        snapshot = result
        permission = status
        return result.count
    }

    func page(offset: Int) throws -> XDrivePhotoKitScanPage {
        guard let result = snapshot, let permission else {
            throw XDriveIOSAlbumReadFailure.missing
        }
        try verify(permission)
        guard offset >= 0, offset <= result.count else {
            throw XDriveIOSAlbumReadFailure.changed
        }
        let end = min(result.count, offset + 64)
        var items: [XDrivePhotoKitScanCandidate] = []
        items.reserveCapacity(end - offset)
        if end > offset {
            for position in offset..<end {
                try Task.checkCancellation()
                let asset = result.object(at: position)
                let kind: String
                switch asset.mediaType {
                case .image: kind = "image"
                case .video: kind = "video"
                default: kind = "unsupported"
                }
                items.append(XDrivePhotoKitScanCandidate(
                    id: asset.localIdentifier,
                    kind: kind,
                    isLive: kind == "image" && asset.mediaSubtypes.contains(.photoLive),
                    capturedAt: asset.creationDate,
                    modifiedAt: asset.modificationDate
                ))
            }
        }
        try verify(permission)
        return XDrivePhotoKitScanPage(
            totalAccessibleAssets: result.count,
            startOffset: offset, nextOffset: end,
            limitedAuthorization: permission == .limited, items: items
        )
    }

    func reset() {
        snapshot = nil
        permission = nil
        version = 0
        if registered {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
            registered = false
        }
    }

    private func verify(_ status: PHAuthorizationStatus) throws {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == status,
              observer.current() == version else {
            reset()
            throw XDriveIOSAlbumReadFailure.changed
        }
        try Task.checkCancellation()
    }
}

/// Visible album-cover cells request one locally available PhotoKit image.
/// Image requests are canceled when a cover leaves the viewport.
private struct XDriveIOSNativeAlbumCover: View {
    let album: XDriveLocalPhotoAlbumSummary
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let image = loader.image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay { Image(systemName: "rectangle.stack").foregroundStyle(.secondary) }
                }
            }
            .frame(width: 74, height: 74)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(album.name).font(.body.weight(.medium)).lineLimit(2)
                Text("\(album.accessibleAssetCount) 项 · \(album.kind)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .task(id: album.collectionIdentifier) {
            guard [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
            ), let collection = PHAssetCollection.fetchAssetCollections(
                withLocalIdentifiers: [album.collectionIdentifier], options: nil
            ).firstObject else { return }
            if let asset = PHAsset.fetchAssets(in: collection, options: nil).firstObject {
                loader.load(asset.localIdentifier, size: CGSize(width: 220, height: 220))
            }
        }
        .onDisappear { loader.cancel() }
    }
}

/// Genuine album-specific, bounded native media wall with the existing
/// still/video/Live Viewer. No full album array, upload, or iCloud download.
struct XDriveIOSNativeAlbumContentsScreen: View {
    let album: XDriveLocalPhotoAlbumSummary
    @Environment(\.scenePhase) private var phase
    @StateObject private var libraryMonitor = XDriveIOSNativeAlbumChangeMonitor()
    @State private var reader: XDriveIOSNativeAlbumPageReader?
    @State private var page: XDrivePhotoKitScanPage?
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var loading = false
    @State private var task: Task<Void, Never>?
    @State private var epoch = UUID()
    @State private var error: String?
    @State private var savedOffset = 0
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if permission == .limited {
                    Label("仅显示 iOS 已授权的部分照片", systemImage: "lock.shield")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let page {
                    Text(page.totalAccessibleAssets == 0 ? "相册内没有可访问的照片或视频。" :
                        "已显示 \(page.startOffset + 1)–\(page.nextOffset) / \(page.totalAccessibleAssets) 项")
                        .font(.caption).foregroundStyle(.secondary)
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 3)],
                        spacing: 3
                    ) {
                        ForEach(page.items.filter { $0.kind != "unsupported" }) { item in
                            Button { selected = item } label: {
                                XDriveIOSLocalPhotoTile(candidate: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    HStack {
                        Button("上一页") { load(offset: max(0, page.startOffset - 64)) }
                            .disabled(loading || page.startOffset == 0)
                        Spacer()
                        Button("下一页") { load(offset: page.nextOffset) }
                            .disabled(loading || page.finished)
                    }
                    .buttonStyle(.bordered)
                }
                if loading { ProgressView("读取相册内容…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("重新读取") { savedOffset = 0; reload() }
                }
                Text("仅预览已授权的本机资源；不读取 iCloud 原件、不上传、不保存相册成员标识。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(12)
        }
        .navigationTitle(album.name)
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $selected, onDismiss: { restoreAfterViewer() }) {
            XDriveIOSNativeLocalPhotoDetail(candidate: $0)
        }
        .onAppear {
            libraryMonitor.start()
            if selected == nil && page == nil && !loading { reload() }
        }
        .onChange(of: libraryMonitor.revision) { _ in
            invalidate()
            error = "系统相册发生变化，请重新读取当前页面。"
        }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            if selected != nil { suspendForViewer() }
            else { libraryMonitor.stop(); invalidate() }
        }
    }

    private func restoreAfterViewer() {
        // Open the same album/page only after fresh PhotoKit authorization.
        if phase == .active { reload() }
        else { invalidate() }
    }

    private func reload() {
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard permission == .authorized || permission == .limited else {
            error = "本机相册访问权限已失效，请返回相册重新授权。"
            return
        }
        load(offset: savedOffset)
    }

    private func load(offset: Int) {
        invalidate()
        let ticket = epoch
        let next = XDriveIOSNativeAlbumPageReader()
        reader = next
        loading = true
        task = Task { @MainActor in
            do {
                _ = try await next.open(album)
                let page = try await next.page(offset: offset)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active else { return }
                permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                self.page = page
                savedOffset = page.startOffset
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "相册内容或授权发生变化，旧结果已撤销；请返回或重新读取。"
            }
            if epoch == ticket { loading = false }
        }
    }

    private func suspendForViewer() {
        epoch = UUID()
        task?.cancel()
        task = nil
        if let reader { Task { await reader.reset() } }
        reader = nil
        loading = false
        // The modal owns selected until dismissal; library monitor remains live.
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        if let reader { Task { await reader.reset() } }
        reader = nil
        page = nil
        selected = nil
        loading = false
        error = nil
    }
}

/// Photos-first list of local smart/user albums. Entries come from the
/// existing 32-at-a-time PhotoKit album pager, never a 100k-sized array.
struct XDriveIOSNativePhotoAlbumsScreen: View {
    @Environment(\.scenePhase) private var phase
    @StateObject private var libraryMonitor = XDriveIOSNativeAlbumChangeMonitor()
    @State private var page: XDriveLocalPhotoAlbumPage?
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var loading = false
    @State private var error: String?
    @State private var offset = 0
    @State private var epoch = UUID()
    @State private var task: Task<Void, Never>?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if permission == .notDetermined {
                    Button("允许查看本机相册") {
                        Task {
                            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                            reload()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                } else if permission == .denied || permission == .restricted {
                    Label("相册访问权限不可用", systemImage: "lock")
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        Link("打开 iOS 设置", destination: url)
                    }
                } else {
                    if permission == .limited {
                        Label("仅可查看 iOS 已授权的相册成员", systemImage: "lock.shield")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let page {
                        Text(page.total == 0 ? "没有可访问的相册。" :
                            "相册 \(page.offset + 1)–\(page.offset + page.items.count) / \(page.total)")
                            .font(.caption).foregroundStyle(.secondary)
                        ForEach(page.items) { album in
                            NavigationLink {
                                XDriveIOSNativeAlbumContentsScreen(album: album)
                            } label: {
                                XDriveIOSNativeAlbumCover(album: album)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("native-ios-gallery-album-open")
                        }
                        HStack {
                            Button("上一页") { load(offset: max(0, page.offset - 32)) }
                                .disabled(loading || !page.hasPrevious)
                            Spacer()
                            Button("下一页") { load(offset: page.offset + page.items.count) }
                                .disabled(loading || !page.hasNext)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                if loading { ProgressView("读取已授权相册…") }
                if let error {
                    Text(error).foregroundStyle(.red)
                    Button("从第一页重试") { offset = 0; reload() }
                }
                Button("刷新相册") { reload() }
                    .disabled(loading || permission == .denied || permission == .restricted)
            }
            .padding(12)
        }
        .navigationTitle("相册")
        .onAppear { libraryMonitor.start(); reload() }
        .onChange(of: libraryMonitor.revision) { _ in
            invalidate()
            error = "相册目录发生变化，请重新读取。"
        }
        .onChange(of: phase) { state in
            if state == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            libraryMonitor.stop()
            suspendForNavigation()
        }
    }

    private func suspendForNavigation() {
        // Album NavigationLink must keep its originating row alive.
        epoch = UUID()
        task?.cancel()
        task = nil
        loading = false
    }

    private func reload() {
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        invalidate()
        guard permission == .authorized || permission == .limited else { return }
        load(offset: offset)
    }

    private func load(offset requestedOffset: Int) {
        invalidate()
        let ticket = epoch
        loading = true
        task = Task { @MainActor in
            do {
                let page = try await XDriveLocalPhotoAlbumPager.readPage(offset: requestedOffset)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
                else { return }
                self.page = page
                offset = page.offset
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "相册目录或授权发生变化，请刷新后重新查看。"
            }
            if epoch == ticket { loading = false }
        }
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        page = nil
        loading = false
        error = nil
    }
}
