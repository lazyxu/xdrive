import Photos
import SwiftUI
import UIKit

// This is a local-only, on-demand PhotoKit inventory. No bytes, identifiers,
// coordinates, or private metadata are persisted or sent to xDrive Server.
private struct LocalPhotoPreview: Identifiable {
    // Transient PhotoKit identity only, never serialized or sent to Server.
    let id: String
    let kind: String
    let capturedAt: Date?
    let isLive: Bool
}

private struct LocalPhotoInventory {
    let imageCount: Int
    let videoCount: Int
    let recent: [LocalPhotoPreview]
}

@MainActor
private final class LocalPhotoInventoryModel: ObservableObject {
    @Published private(set) var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @Published private(set) var inventory: LocalPhotoInventory?
    @Published private(set) var loading = false

    var hasAccess: Bool { authorization == .authorized || authorization == .limited }

    var permissionDescription: String {
        switch authorization {
        case .notDetermined: return "尚未申请照片读取权限。只有点击“允许检查”才会弹出 iOS 授权。"
        case .authorized: return "已授权读取系统相册。"
        case .limited: return "仅能检查你授权给 xDrive 的照片和视频，不代表系统相册总量。"
        case .denied: return "照片访问已拒绝。可以在系统设置中调整权限。"
        case .restricted: return "照片访问受到设备管理或系统限制。"
        @unknown default: return "照片授权状态不可识别，未读取任何内容。"
        }
    }

    func inspect(askPermission: Bool) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }

        var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined && askPermission {
            status = await withCheckedContinuation { continuation in
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { result in
                    continuation.resume(returning: result)
                }
            }
        }
        authorization = status
        guard hasAccess else {
            inventory = nil
            return
        }

        // PHFetchResult provides its count without materializing image bytes.
        // Only a bounded recent metadata preview is enumerated; a large
        // 100k+ library is never converted to an in-memory Swift array.
        let next = await Task.detached(priority: .userInitiated) {
            let imageCount = PHAsset.fetchAssets(with: .image, options: nil).count
            let videoCount = PHAsset.fetchAssets(with: .video, options: nil).count
            let options = PHFetchOptions()
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            let assets = PHAsset.fetchAssets(with: options)
            var recent: [LocalPhotoPreview] = []
            let upperBound = min(assets.count, 60)
            if upperBound > 0 {
                for position in 0..<upperBound where recent.count < 30 {
                    let asset = assets.object(at: position)
                    guard asset.mediaType == .image || asset.mediaType == .video else { continue }
                    recent.append(LocalPhotoPreview(
                        id: asset.localIdentifier,
                        kind: asset.mediaType == .video ? "视频" : "照片",
                        capturedAt: asset.creationDate,
                        isLive: asset.mediaType == .image && asset.mediaSubtypes.contains(.photoLive)
                    ))
                }
            }
            return LocalPhotoInventory(imageCount: imageCount, videoCount: videoCount, recent: recent)
        }.value
        guard !Task.isCancelled else { return }
        // Recheck permission after the fetch: system Settings may have
        // revoked access while a metadata read was in progress.
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        authorization = current
        inventory = hasAccess ? next : nil
    }
}

/// Native-only diagnostic for local Photos access. This does NOT mean local
/// photos are paired with Server PhotoAsset or backed up to CAS.
struct LocalPhotoInventoryScreen: View {
    /// Passed only after verifying the native Owner; a plain photo-check
    /// dialog has no upload capability and never accesses authentication.
    let onUploadStillPhoto: ((String, Bool) async -> String)?

    init(onUploadStillPhoto: ((String, Bool) async -> String)? = nil) {
        self.onUploadStillPhoto = onUploadStillPhoto
    }

    @StateObject private var model = LocalPhotoInventoryModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var inspectedAssetID: String?
    @State private var inspectedResourceMessage: String?
    @State private var albumPage: XDriveLocalPhotoAlbumPage?
    @State private var albumLoading = false
    @State private var albumError: String?
    @State private var albumTask: Task<Void, Never>?
    @State private var showingBoundedScan = false
    @State private var allowICloudOriginal = false
    @State private var uploadingPhotoID: String?
    @State private var photoUploadTask: Task<Void, Never>?
    @State private var photoUploadMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Label("本机照片权限", systemImage: "photo.on.rectangle.angled")
                        .font(.headline)
                    Text(model.permissionDescription)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if onUploadStillPhoto != nil && model.hasAccess {
                        Toggle("允许本次手动上传从 iCloud 下载原件", isOn: $allowICloudOriginal)
                            .disabled(uploadingPhotoID != nil)
                            .font(.subheadline)
                        Text("默认关闭。只有明确点击下面单张普通照片的上传按钮，才会读取它的原件并连接云端；Live Photo、视频和后台自动同步暂不可用。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let photoUploadMessage {
                        Text(photoUploadMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("manual-photo-upload-result")
                    }

                    if let inventory = model.inventory {
                        HStack(spacing: 14) {
                            countCard("照片（含 Live）", count: inventory.imageCount)
                            countCard("视频", count: inventory.videoCount)
                        }
                        Text("最近的可访问项目（最多 30 项）")
                            .font(.headline)
                        if inventory.recent.isEmpty {
                            Text("授权范围内没有照片或视频。").foregroundStyle(.secondary)
                        } else {
                            ForEach(inventory.recent) { item in
                                HStack(spacing: 12) {
                                    Image(systemName: item.kind == "视频" ? "video" : "photo")
                                        .frame(width: 26)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(item.isLive ? "Live Photo" : item.kind)
                                        if let date = item.capturedAt {
                                            Text(date.formatted(date: .abbreviated, time: .shortened))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                }
                                .padding(.vertical, 3)
                                Button("检查此项的原始资源组成") {
                                    let evidence = XDrivePhotoKitResourceInspector.inspect(localIdentifier: item.id)
                                    inspectedAssetID = item.id
                                    inspectedResourceMessage = evidence?.summary
                                        ?? "当前授权范围内已无法访问该项目，请重新检查相册权限。"
                                }
                                .font(.footnote)
                                .buttonStyle(.borderless)
                                if inspectedAssetID == item.id, let message = inspectedResourceMessage {
                                    Text(message)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                if item.kind == "照片" && !item.isLive && onUploadStillPhoto != nil {
                                    Button("手动保存这张普通照片到云端") {
                                        startPhotoUpload(item.id)
                                    }
                                    .font(.footnote)
                                    .buttonStyle(.bordered)
                                    .disabled(uploadingPhotoID != nil || model.loading)
                                    .accessibilityIdentifier("native-photo-upload-still")
                                }
                                if uploadingPhotoID == item.id {
                                    ProgressView("读取原件并等待 Server 上传确认…")
                                        .font(.footnote)
                                    Button("取消本机请求") { photoUploadTask?.cancel() }
                                        .font(.footnote)
                                        .buttonStyle(.bordered)
                                }
                                Divider()
                            }
                        }
                    }

                    if model.hasAccess {
                        Divider()
                        Button {
                            showingBoundedScan = true
                        } label: {
                            Label("预览全库有界扫描（每批最多 64 项）", systemImage: "list.bullet.rectangle")
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.loading || uploadingPhotoID != nil)
                        .accessibilityIdentifier("native-photokit-scan-preview")
                        Text("只读取当前授权可访问的候选元数据；不下载原件、不上传，也不保存 PhotoKit 游标。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Divider()
                        Text("系统相册目录")
                            .font(.headline)
                        Text("仅枚举当前授权可访问的相册。不同相册的照片可能重复，目录成员数不等于唯一照片数。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let page = albumPage {
                            Text(page.total == 0
                                ? "当前没有可访问的相册目录。"
                                : "相册 \(page.offset + 1)–\(page.offset + page.items.count) / \(page.total)"
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            if page.limitedAuthorization {
                                Label("仅统计 iOS 已授权子集", systemImage: "lock.shield")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(page.items) { album in
                                HStack(spacing: 10) {
                                    Image(systemName: "rectangle.stack")
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(album.name)
                                        Text(album.kind)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(album.accessibleAssetCount.formatted())
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                                Divider()
                            }
                            HStack {
                                Button("上一页") { loadAlbumPage(page.offset - XDriveLocalPhotoAlbumPager.pageSize) }
                                    .disabled(!page.hasPrevious || albumLoading)
                                Spacer()
                                Button("下一页") { loadAlbumPage(page.offset + page.items.count) }
                                    .disabled(!page.hasNext || albumLoading)
                            }
                            .buttonStyle(.bordered)
                        } else if !albumLoading {
                            Button("检查本机相册目录") { loadAlbumPage(0) }
                                .buttonStyle(.bordered)
                        }
                        if albumLoading {
                            ProgressView("正在读取最多 32 个相册目录…")
                        }
                        if let albumError {
                            Text(albumError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                            Button("重新读取相册目录") { loadAlbumPage(0) }
                                .buttonStyle(.bordered)
                                .disabled(albumLoading)
                        }
                    }

                    if model.loading {
                        ProgressView("正在读取本机相册元数据…")
                    } else if model.authorization == .notDetermined {
                        Button("允许检查系统相册") {
                            Task { await model.inspect(askPermission: true) }
                        }
                        .buttonStyle(.borderedProminent)
                    } else if model.hasAccess {
                        Button("重新检查") {
                            inspectedAssetID = nil
                            inspectedResourceMessage = nil
                            albumTask?.cancel()
                            albumPage = nil
                            albumError = nil
                            Task { await model.inspect(askPermission: false) }
                        }
                        .buttonStyle(.bordered)
                    }

                    if model.authorization == .limited || model.authorization == .denied {
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("在 iOS 设置中管理照片权限", destination: settings)
                        }
                    }

                    Text("系统相册默认仅做本机元数据检查，不读取 GPS 或发送 PhotoKit 标识。仅在验证原生 Owner 后主动点击普通照片上传按钮，才会读取该张原件并通过现有 UploadSession 保存云端文件；这不代表自动相册同步、Device/Root 备份或 Live Photo 成对提交。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .navigationTitle("系统相册识别")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showingBoundedScan) {
            XDrivePhotoKitScanPreviewScreen()
        }
        .task { await model.inspect(askPermission: false) }
        .onChange(of: scenePhase) { phase in
            if phase != .active {
                showingBoundedScan = false
                photoUploadTask?.cancel()
                return
            }
            if phase == .active {
                inspectedAssetID = nil
                inspectedResourceMessage = nil
                albumTask?.cancel()
                albumPage = nil
                albumError = nil
                Task { await model.inspect(askPermission: false) }
            }
        }
        .onChange(of: model.authorization) { _ in
            showingBoundedScan = false
            photoUploadTask?.cancel()
            photoUploadMessage = nil
            inspectedAssetID = nil
            inspectedResourceMessage = nil
            albumTask?.cancel()
            albumPage = nil
            albumError = nil
        }
        .onDisappear {
            showingBoundedScan = false
            albumTask?.cancel()
            photoUploadTask?.cancel()
        }
    }

    private func startPhotoUpload(_ localIdentifier: String) {
        guard let onUploadStillPhoto, uploadingPhotoID == nil,
              model.hasAccess else { return }
        uploadingPhotoID = localIdentifier
        photoUploadMessage = nil
        let mayDownloadICloud = allowICloudOriginal
        photoUploadTask = Task { @MainActor in
            let result = await onUploadStillPhoto(localIdentifier, mayDownloadICloud)
            photoUploadMessage = Task.isCancelled
                ? "本机已取消。若最后 ACK 丢失，请先核实云端再操作。"
                : result
            uploadingPhotoID = nil
            photoUploadTask = nil
        }
    }

    private func loadAlbumPage(_ offset: Int) {
        guard !albumLoading else { return }
        albumTask?.cancel()
        albumLoading = true
        albumError = nil
        albumTask = Task { @MainActor in
            defer { albumLoading = false }
            do {
                let page = try await XDriveLocalPhotoAlbumPager.readPage(offset: offset)
                try Task.checkCancellation()
                guard model.hasAccess else { return }
                albumPage = page
            } catch is CancellationError {
                // Leaving this screen or revoking Photos access discards rows.
            } catch {
                albumPage = nil
                albumError = "无法读取当前授权范围内的相册目录，请检查权限后重试。"
            }
        }
    }

    private func countCard(_ title: String, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.footnote).foregroundStyle(.secondary)
            Text(count.formatted()).font(.title2.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
