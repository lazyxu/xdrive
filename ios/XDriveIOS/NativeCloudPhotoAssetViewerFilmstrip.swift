import Photos
import SwiftUI
import UIKit

/// Every visible tile keeps its own short-lived decoder result. This is NOT an
/// extension of the background media scanner or a credential cache.
private struct XDriveIOSNativeCloudFilmstripTileIdentity: Hashable {
    let node: XDriveIOSNativeCloudFilmstripKey
    let origin: URL?
    let instanceID: String?
    let ownerID: UInt64?
    let username: String?
    let rootNodeID: UInt64?

    init(node: XDriveIOSNativeCloudFilmstripKey, owner: XDriveNativeOwnerRoot?) {
        self.node = node
        origin = owner?.origin
        instanceID = owner?.instanceID
        ownerID = owner?.ownerID
        username = owner?.username
        rootNodeID = owner?.rootNodeID
    }
}

private struct XDriveIOSNativeCloudFilmstripTile: View {
    let item: XDriveIOSNativeMediaItem
    let key: XDriveIOSNativeCloudFilmstripKey
    let selected: Bool
    let openedOwner: XDriveNativeOwnerRoot
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @State private var image: UIImage?

    private var identity: XDriveIOSNativeCloudFilmstripTileIdentity {
        XDriveIOSNativeCloudFilmstripTileIdentity(node: key, owner: openedOwner)
    }

    private var authorized: Bool {
        phase == .active &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemBackground))
                    .overlay {
                        Image(systemName: item.isVideo ? "video" : "photo")
                            .foregroundStyle(.secondary)
                    }
            }
            if item.isVideo || item.isLive {
                Image(systemName: item.isVideo ? "play.fill" : "livephoto")
                    .font(.caption2).foregroundStyle(.white)
                    .padding(3).shadow(radius: 2)
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
        .task(id: identity) {
            image = nil
            guard authorized, item.supportsPreview else { return }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard authorized,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, openedOwner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let thumbnail = try await reader.thumbnail(item)
                try Task.checkCancellation()
                guard authorized,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, openedOwner),
                      key.nodeID == item.id,
                      key.revision == item.node.revision else { return }
                image = thumbnail
            } catch {
                // A missing derivative or revoked token is never a valid still.
                // The parent has the authoritative Owner/Range error UI.
            }
        }
        .onChange(of: login.owner) { _ in image = nil }
        .onChange(of: phase) { newPhase in
            if newPhase != .active { image = nil }
        }
        .onDisappear { image = nil }
    }
}

/// L3-only, foreground, bounded thumbnails for cloud indexed PhotoAssets.
/// Tap admission also revalidates the full media DTO in the presenting Viewer.
struct XDriveIOSNativeCloudPhotoAssetFilmstrip: View {
    let current: XDriveIOSNativeMediaItem
    let loaded: [XDriveIOSNativeMediaItem]
    let openedOwner: XDriveNativeOwnerRoot?
    let authorized: Bool
    let busy: Bool
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let onSelect: (XDriveIOSNativeMediaItem) -> Void

    @Environment(\.scenePhase) private var phase

    @State private var scrubStartIndex: Int?
    @State private var lastScrubbedKey: XDriveIOSNativeCloudFilmstripKey?
    @State private var lastScrubDispatch: TimeInterval = 0

    private func key(_ item: XDriveIOSNativeMediaItem)
        -> XDriveIOSNativeCloudFilmstripKey {
        XDriveIOSNativeCloudFilmstripKey(
            nodeID: item.id, revision: item.node.revision,
            name: item.node.name, size: item.node.size,
            kind: item.isLive ? "live" : item.isVideo ? "video" : "image"
        )
    }

    private var visible: [XDriveIOSNativeMediaItem] {
        loaded.filter { $0.supportsPreview }
    }

    private var keys: [XDriveIOSNativeCloudFilmstripKey] {
        visible.map(key)
    }

    private var admitted: Bool {
        phase == .active && authorized &&
            openedOwner.map {
                XDriveIOSNativePhotoOwnerScope.matches(login.owner, $0)
            } == true &&
            visible.contains(where: { $0.sameVisibleRevision(as: current) }) &&
            XDriveIOSNativeCloudFilmstripPolicy.selectedIndex(
                current: key(current), in: keys, authorized: true
            ) != nil
    }

    /// Scrub only this exact Owner/revision-scoped, previewable 48-item range.
    /// The parent onNavigate route remains the final Server admission fence.
    private func scrubChanged(_ translation: CGSize, force: Bool = false) {
        guard admitted, !busy else { resetScrub(); return }
        guard let origin = scrubStartIndex ??
            XDriveIOSNativeCloudFilmstripPolicy.selectedIndex(
                current: key(current), in: keys, authorized: admitted
            ) else { return }
        if scrubStartIndex == nil { scrubStartIndex = origin }
        guard let target = XDriveIOSNativePhotoFilmstripScrubPolicy.targetIndex(
            startingAt: origin, loadedCount: visible.count,
            horizontal: translation.width, vertical: translation.height,
            authorized: admitted
        ), visible.indices.contains(target) else { return }
        let candidate = visible[target]
        let candidateKey = key(candidate)
        guard candidateKey != key(current), candidateKey != lastScrubbedKey,
              visible.contains(where: { $0.sameVisibleRevision(as: candidate) }),
              XDriveIOSNativeCloudFilmstripPolicy.target(
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
        if admitted, visible.count > 1, let openedOwner {
            ScrollViewReader { scroll in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .center, spacing: 4) {
                        ForEach(visible) { item in
                            Button {
                                guard !busy, admitted,
                                      XDriveIOSNativeCloudFilmstripPolicy.target(
                                        current: key(current), requested: key(item),
                                        in: keys, authorized: true
                                      ) != nil,
                                      visible.contains(where: {
                                          $0.sameVisibleRevision(as: item)
                                      }) else { return }
                                onSelect(item)
                            } label: {
                                XDriveIOSNativeCloudFilmstripTile(
                                    item: item, key: key(item),
                                    selected: item.id == current.id &&
                                        item.node.revision == current.node.revision,
                                    openedOwner: openedOwner, login: login
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(busy)
                            .id(item.id)
                            .accessibilityLabel(
                                item.isLive ? "实况照片" :
                                    item.isVideo ? "视频" : "照片"
                            )
                            .accessibilityValue(
                                item.id == current.id ? "当前媒体" : ""
                            )
                            .accessibilityIdentifier("native-ios-cloud-filmstrip-tile")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
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
            .accessibilityIdentifier("native-ios-cloud-filmstrip")
            .onChange(of: keys) { _ in resetScrub() }
            .onChange(of: login.owner) { _ in resetScrub() }
            .onChange(of: phase) { newPhase in
                if newPhase != .active { resetScrub() }
            }
        }
    }
}
