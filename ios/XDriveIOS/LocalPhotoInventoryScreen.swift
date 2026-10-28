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
    @StateObject private var model = LocalPhotoInventoryModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var inspectedAssetID: String?
    @State private var inspectedResourceMessage: String?

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
                                Divider()
                            }
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
                            Task { await model.inspect(askPermission: false) }
                        }
                        .buttonStyle(.bordered)
                    }

                    if model.authorization == .limited || model.authorization == .denied {
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("在 iOS 设置中管理照片权限", destination: settings)
                        }
                    }

                    Text("当前只读取已授权项目的数量、类型、最近日期；单项检查仅枚举 PhotoKit 声明的原始资源及 Live 动静配对情况。这不证明 iCloud 原件可下载，也不读取照片字节或 GPS、不上传数据、不执行同步。真正同步仍需账户绑定、增量游标、资源内容读取、UploadSession 和断点恢复。")
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
        .task { await model.inspect(askPermission: false) }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                inspectedAssetID = nil
                inspectedResourceMessage = nil
                Task { await model.inspect(askPermission: false) }
            }
        }
        .onChange(of: model.authorization) { status in
            if status != .authorized && status != .limited {
                inspectedAssetID = nil
                inspectedResourceMessage = nil
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
