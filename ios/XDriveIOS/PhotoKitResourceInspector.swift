import Foundation
import Photos

/// The original-resource pair is only metadata evidence. It is NOT proof that
/// the bytes have been downloaded from iCloud, uploaded or committed to CAS.
struct XDrivePhotoKitResourceEvidence {
    let isLive: Bool
    let isVideo: Bool
    let stillFilename: String?
    let motionFilename: String?
    let videoFilename: String?
    let extraResourceCount: Int

    var originalResourceManifestComplete: Bool {
        if isVideo { return videoFilename != nil }
        return stillFilename != nil && (!isLive || motionFilename != nil)
    }

    var summary: String {
        if isLive {
            guard let stillFilename, let motionFilename else {
                return "Live Photo 资源不完整：静态图或动态视频缺失；禁止作为完整 Live Photo 同步。"
            }
            return "Live Photo 已发现静态图 \(stillFilename) 与动态视频 \(motionFilename)；尚未读取原始字节。"
        }
        if isVideo {
            return videoFilename.map { "视频原始资源：\($0)；尚未读取字节。" }
                ?? "没有可识别的视频原始资源。"
        }
        return stillFilename.map { "图片原始资源：\($0)；尚未读取字节。" }
            ?? "没有可识别的图片原始资源。"
    }
}

enum XDrivePhotoKitResourceInspector {
    /// Inspect exactly one currently permitted localIdentifier, never persist
    /// the identifier, and never enumerate or request original image bytes.
    ///
    /// IDs from an old/limited Photos authorization may no longer be visible;
    /// return nil rather than using old private resource metadata.
    static func inspect(localIdentifier: String) -> XDrivePhotoKitResourceEvidence? {
        let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard authorization == .authorized || authorization == .limited,
              !localIdentifier.isEmpty,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [localIdentifier], options: nil
              ).firstObject
        else { return nil }

        guard asset.mediaType == .image || asset.mediaType == .video else { return nil }
        let resources = PHAssetResource.assetResources(for: asset)
        let isLive = asset.mediaType == .image && asset.mediaSubtypes.contains(.photoLive)
        let isVideo = asset.mediaType == .video

        // Edited and unedited PhotoKit resources can coexist. Always choose
        // the full-size original resource when advertised. Do not infer a Live
        // pair from two unrelated filenames or an arbitrary .mov attachment.
        let still = resources.first { $0.type == .fullSizePhoto }
            ?? resources.first { $0.type == .photo }
        let motion = resources.first { $0.type == .fullSizePairedVideo }
            ?? resources.first { $0.type == .pairedVideo }
        let video = resources.first { $0.type == .fullSizeVideo }
            ?? resources.first { $0.type == .video }

        let primary = [still, motion, video].compactMap { $0 }
        let extras = resources.filter { candidate in
            !primary.contains { $0 === candidate }
        }
        let result = XDrivePhotoKitResourceEvidence(
            isLive: isLive,
            isVideo: isVideo,
            stillFilename: isVideo ? nil : still?.originalFilename,
            motionFilename: isLive ? motion?.originalFilename : nil,
            videoFilename: isVideo ? video?.originalFilename : nil,
            extraResourceCount: extras.count
        )
        // A settings change during resource enumeration must invalidate the
        // UI result, even if we still hold the PHAsset object in memory.
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard current == .authorized || current == .limited,
              PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil).firstObject != nil
        else { return nil }
        return result
    }
}
