import SwiftUI
import UIKit

/// Identity includes the whole immutable original and the verified Owner/root,
/// excluding the mutable root revision. No pixels or credential are persisted.
private struct XDriveIOSNativeOriginalFilmstripTileIdentity: Hashable {
    let node: XDriveIOSNativeCloudOriginalFilmstripKey
    let origin: URL?
    let instanceID: String?
    let ownerID: UInt64?
    let username: String?
    let rootNodeID: UInt64?

    init(node: XDriveIOSNativeCloudOriginalFilmstripKey,
         owner: XDriveNativeOwnerRoot) {
        self.node = node
        origin = owner.origin
        instanceID = owner.instanceID
        ownerID = owner.ownerID
        username = owner.username
        rootNodeID = owner.rootNodeID
    }
}

private struct XDriveIOSNativeOriginalFilmstripTile: View {
    let node: XDriveIOSNativeCloudOriginal
    let key: XDriveIOSNativeCloudOriginalFilmstripKey
    let selected: Bool
    // Already decoded, validated still from the currently selected Live ZIP.
    // No neighboring Live ZIP is fetched or unpacked for the filmstrip.
    let selectedLiveStill: UIImage?
    let owner: XDriveNativeOwnerRoot
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel

    @Environment(\.scenePhase) private var phase
    @State private var image: UIImage?

    private var identity: XDriveIOSNativeOriginalFilmstripTileIdentity {
        XDriveIOSNativeOriginalFilmstripTileIdentity(node: key, owner: owner)
    }

    private var authorized: Bool {
        phase == .active &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
    }

    private var visibleStill: UIImage? {
        // A selected Live tile can reuse only its presenting Viewer's already
        // verified still. Hide all decoded pixels when the Owner/scene retires.
        guard authorized else { return nil }
        if selected && node.isLiveArchive { return selectedLiveStill }
        return image
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let visibleStill {
                Image(uiImage: visibleStill).resizable().scaledToFill()
            } else {
                Rectangle().fill(Color(uiColor: .secondarySystemBackground))
                    .overlay {
                        Image(systemName: node.isLiveArchive ? "livephoto" :
                              node.isVideo ? "video" : "photo")
                            .foregroundStyle(.secondary)
                    }
            }
            if node.isLiveArchive || node.isVideo {
                Image(systemName: node.isLiveArchive ? "livephoto" : "play.fill")
                    .font(.caption2)
                    .foregroundStyle(.white)
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
            // An indexed Live ZIP has no image thumbnail endpoint. Show the
            // Live glyph; never download/extract a ZIP just for a filmstrip.
            guard authorized, !node.isLiveArchive,
                  node.isImage || node.isVideo else { return }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard authorized,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { return }
                let reader = XDriveIOSNativeCloudOriginalReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let thumbnail = try await reader.thumbnail(node)
                try Task.checkCancellation()
                guard authorized,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      key.nodeID == node.id, key.revision == node.revision,
                      key.name == node.name, key.size == node.size
                else { return }
                image = thumbnail
            } catch {
                // Missing/pending derivatives never imply missing originals.
                // Parent owns session/retry state; tile retains no old pixels.
            }
        }
        .onChange(of: login.owner) { _ in image = nil }
        .onChange(of: phase) { state in
            if state != .active { image = nil }
        }
        .onDisappear { image = nil }
    }
}

/// One foreground L3 strip from the already-frozen <=48 backed-up originals.
/// Parent callback remains the authoritative Owner/revision/return gate.
struct XDriveIOSNativeCloudOriginalViewerFilmstrip: View {
    let current: XDriveIOSNativeCloudOriginal
    let loaded: [XDriveIOSNativeCloudOriginal]
    let openedOwner: XDriveNativeOwnerRoot?
    let authorized: Bool
    let busy: Bool
    // The presenting Viewer retains ownership of this transient Live still.
    let selectedLiveStill: UIImage?
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let onSelect: (XDriveIOSNativeCloudOriginal) -> Void

    @Environment(\.scenePhase) private var phase

    @State private var scrubStartIndex: Int?
    @State private var lastScrubbedKey: XDriveIOSNativeCloudOriginalFilmstripKey?
    @State private var lastScrubDispatch: TimeInterval = 0

    private func key(_ item: XDriveIOSNativeCloudOriginal)
        -> XDriveIOSNativeCloudOriginalFilmstripKey {
        XDriveIOSNativeCloudOriginalFilmstripKey(
            nodeID: item.id, revision: item.revision,
            name: item.name, type: item.type, size: item.size,
            kind: item.isLiveArchive ? "live" :
                item.isVideo ? "video" : "image"
        )
    }

    private var visible: [XDriveIOSNativeCloudOriginal] {
        loaded.filter { $0.isImage || $0.isVideo || $0.isLiveArchive }
    }

    private var keys: [XDriveIOSNativeCloudOriginalFilmstripKey] {
        visible.map(key)
    }

    private var admitted: Bool {
        phase == .active && authorized &&
            openedOwner.map {
                XDriveIOSNativePhotoOwnerScope.matches(login.owner, $0)
            } == true &&
            XDriveIOSNativeCloudOriginalFilmstripPolicy.loadedIndex(
                current: key(current), in: keys, authorized: true
            ) != nil
    }

    /// Map each drag back to the original selected index in exactly this
    /// bounded, verified Owner window. The parent rechecks complete Node
    /// identity and the presenting Gallery callback on every selection.
    private func scrubChanged(_ translation: CGSize, force: Bool = false) {
        guard admitted, !busy else { resetScrub(); return }
        guard let origin = scrubStartIndex ??
            XDriveIOSNativeCloudOriginalFilmstripPolicy.loadedIndex(
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
              XDriveIOSNativeCloudOriginalFilmstripPolicy.target(
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
                        ForEach(visible) { node in
                            Button {
                                guard !busy, admitted,
                                      XDriveIOSNativeCloudOriginalFilmstripPolicy.target(
                                        current: key(current), requested: key(node),
                                        in: keys, authorized: true
                                      ) != nil else { return }
                                onSelect(node)
                            } label: {
                                XDriveIOSNativeOriginalFilmstripTile(
                                    node: node, key: key(node),
                                    selected: key(node) == key(current),
                                    selectedLiveStill: selectedLiveStill,
                                    owner: openedOwner, login: login
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(busy)
                            .id(node.id)
                            .accessibilityLabel(node.isLiveArchive ? "实况照片" :
                                node.isVideo ? "视频" : "照片")
                            .accessibilityValue(
                                key(node) == key(current) ? "当前媒体" : ""
                            )
                            .accessibilityIdentifier("native-ios-original-filmstrip-tile")
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 5)
                }
                .frame(height: 72)
                .background(.ultraThinMaterial)
                // Only the thumbnail rail admits page scrubbing. Ordinary
                // taps remain accessible Buttons; the parent owns playback
                // cancellation and all Owner/revision admission.
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
            .accessibilityIdentifier("native-ios-original-filmstrip")
            .onChange(of: keys) { _ in resetScrub() }
            .onChange(of: login.owner) { _ in resetScrub() }
            .onChange(of: phase) { state in
                if state != .active { resetScrub() }
            }
            .onDisappear { resetScrub() }
        }
    }
}
