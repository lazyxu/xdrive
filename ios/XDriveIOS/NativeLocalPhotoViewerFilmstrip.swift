import Photos
import SwiftUI
import UIKit

/// Visible-only PhotoKit thumbnails: no iCloud access or persistent pixels.
@MainActor
private final class XDriveIOSNativeLocalFilmstripLoader: ObservableObject {
    @Published private(set) var image: UIImage?
    private var requestID: PHImageRequestID = PHInvalidImageRequestID
    private var generation = UUID()

    private func matches(_ asset: PHAsset, _ item: XDrivePhotoKitScanCandidate) -> Bool {
        asset.creationDate == item.capturedAt &&
        asset.modificationDate == item.modifiedAt &&
        ((item.kind == "image" && asset.mediaType == .image &&
          item.isLive == asset.mediaSubtypes.contains(.photoLive)) ||
         (item.kind == "video" && asset.mediaType == .video))
    }

    func load(_ item: XDrivePhotoKitScanCandidate) {
        cancel()
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ), let asset = PHAsset.fetchAssets(
            withLocalIdentifiers: [item.id], options: nil
        ).firstObject, matches(asset, item) else { return }
        let token = generation
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = false
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        requestID = PHImageManager.default().requestImage(
            for: asset, targetSize: CGSize(width: 128, height: 128),
            contentMode: .aspectFill, options: options
        ) { [weak self] result, info in
            let cancelled = info?[PHImageCancelledKey] as? Bool == true
            Task { @MainActor [weak self] in
                guard let self, self.generation == token, !cancelled,
                      let result,
                      [.authorized, .limited].contains(
                          PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ), let refreshed = PHAsset.fetchAssets(
                          withLocalIdentifiers: [item.id], options: nil
                      ).firstObject, self.matches(refreshed, item)
                else { return }
                self.image = result
            }
        }
    }

    func cancel() {
        generation = UUID()
        if requestID != PHInvalidImageRequestID {
            PHImageManager.default().cancelImageRequest(requestID)
            requestID = PHInvalidImageRequestID
        }
        image = nil
    }
}

private struct XDriveIOSNativeLocalFilmstripTile: View {
    let candidate: XDrivePhotoKitScanCandidate
    let selected: Bool
    @StateObject private var loader = XDriveIOSNativeLocalFilmstripLoader()

    private var key: XDriveIOSNativeLocalFilmstripKey {
        XDriveIOSNativeLocalFilmstripKey(
            id: candidate.id, kind: candidate.kind, isLive: candidate.isLive,
            capturedAt: candidate.capturedAt, modifiedAt: candidate.modifiedAt
        )
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image = loader.image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemBackground))
                    .overlay { Image(systemName: "photo").foregroundStyle(.secondary) }
            }
            if candidate.kind == "video" || candidate.isLive {
                Image(systemName: candidate.kind == "video" ? "play.fill" : "livephoto")
                    .font(.caption2).foregroundStyle(.white).padding(3)
                    .shadow(radius: 2)
            }
        }
        .frame(width: selected ? 48 : 42, height: selected ? 60 : 54)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay {
            if selected {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(Color.white, lineWidth: 2)
            }
        }
        .task(id: key) { loader.load(candidate) }
        .onDisappear { loader.cancel() }
    }
}

/// Ready for integration in the existing L3 Viewer; the presenting Viewer
/// must supply its one current authorized page and reverify onSelect.
struct XDriveIOSNativeLocalViewerFilmstrip: View {
    let current: XDrivePhotoKitScanCandidate
    let loaded: [XDrivePhotoKitScanCandidate]
    let authorized: Bool
    let busy: Bool
    let onSelect: (XDrivePhotoKitScanCandidate) -> Void

    @Environment(\.scenePhase) private var phase

    @State private var scrubStartIndex: Int?
    @State private var lastScrubbedKey: XDriveIOSNativeLocalFilmstripKey?
    @State private var lastScrubDispatch: TimeInterval = 0

    private func key(_ item: XDrivePhotoKitScanCandidate)
        -> XDriveIOSNativeLocalFilmstripKey {
        XDriveIOSNativeLocalFilmstripKey(
            id: item.id, kind: item.kind, isLive: item.isLive,
            capturedAt: item.capturedAt, modifiedAt: item.modifiedAt
        )
    }

    private var keys: [XDriveIOSNativeLocalFilmstripKey] { loaded.map(key) }
    private var admitted: Bool {
        phase == .active && authorized &&
        XDriveIOSNativeLocalFilmstripPolicy.selectedIndex(
            current: key(current), in: keys, authorized: true
        ) != nil
    }

    /// A drag updates the current media inside this one bounded PhotoKit page.
    /// The parent still verifies the live PHAsset before accepting each change.
    private func scrubChanged(_ translation: CGSize, force: Bool = false) {
        guard admitted, !busy else { resetScrub(); return }
        guard let origin = scrubStartIndex ??
            XDriveIOSNativeLocalFilmstripPolicy.selectedIndex(
                current: key(current), in: keys, authorized: admitted
            ) else { return }
        if scrubStartIndex == nil { scrubStartIndex = origin }
        guard let target = XDriveIOSNativePhotoFilmstripScrubPolicy.targetIndex(
            startingAt: origin, loadedCount: loaded.count,
            horizontal: translation.width, vertical: translation.height,
            authorized: admitted
        ), loaded.indices.contains(target) else { return }
        let candidate = loaded[target]
        let candidateKey = key(candidate)
        guard candidateKey != key(current), candidateKey != lastScrubbedKey,
              XDriveIOSNativeLocalFilmstripPolicy.target(
                current: key(current), requested: candidateKey,
                in: keys, authorized: admitted
              ) != nil else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard force || lastScrubDispatch == 0 ||
              now - lastScrubDispatch >= 0.08 else { return }
        lastScrubDispatch = now
        lastScrubbedKey = candidateKey
        onSelect(candidate)
    }

    private func resetScrub() {
        scrubStartIndex = nil
        lastScrubbedKey = nil
        lastScrubDispatch = 0
    }

    var body: some View {
        if admitted, loaded.count > 1 {
            ScrollViewReader { scroll in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .center, spacing: 4) {
                        ForEach(loaded) { item in
                            Button {
                                guard !busy, phase == .active, authorized,
                                      XDriveIOSNativeLocalFilmstripPolicy.target(
                                          current: key(current), requested: key(item),
                                          in: keys, authorized: true
                                      ) != nil else { return }
                                onSelect(item)
                            } label: {
                                XDriveIOSNativeLocalFilmstripTile(
                                    candidate: item, selected: item.id == current.id
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(busy)
                            .id(item.id)
                            .accessibilityLabel(
                                item.kind == "video" ? "视频" :
                                item.isLive ? "实况照片" : "照片"
                            )
                            .accessibilityValue(item.id == current.id ? "当前照片" : "")
                            .accessibilityIdentifier("native-ios-viewer-filmstrip-tile")
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 5)
                }
                .frame(height: 72)
                .background(.ultraThinMaterial)
                // Horizontal drag scrubs the bounded page; a short tap keeps
                // each tile's accessible Button action and native zoom intact.
                .highPriorityGesture(
                    DragGesture(minimumDistance: 18, coordinateSpace: .local)
                        .onChanged { scrubChanged($0.translation) }
                        .onEnded {
                            scrubChanged($0.translation, force: true)
                            resetScrub()
                        }
                )
                .onAppear { scroll.scrollTo(current.id, anchor: .center) }
                .onChange(of: current.id) { id in
                    guard admitted else { return }
                    withAnimation(.easeOut(duration: 0.18)) {
                        scroll.scrollTo(id, anchor: .center)
                    }
                }
            }
            .accessibilityIdentifier("native-ios-viewer-filmstrip")
            .onChange(of: keys) { _ in resetScrub() }
            .onChange(of: phase) { newPhase in
                if newPhase != .active { resetScrub() }
            }
        }
    }
}
