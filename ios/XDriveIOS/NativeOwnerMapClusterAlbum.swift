import SwiftUI
import UIKit

/// MapKit's visual cluster contains only exact Owner-issued place facets.
struct XDriveIOSOwnerMapChosenCluster: Identifiable {
    let id = UUID()
    let places: [XDriveIOSNativeOwnerMapFacet]
    let owner: XDriveNativeOwnerRoot
}

private struct XDriveIOSOwnerClusterCursor: Equatable {
    let placeIndex: Int
    let offset: Int
}

/// Each page is ONE signed 48-asset place Range. The explicit next/previous
/// cursor walks every exact place in the selected visual cluster. No all-Owner
/// photo query, asset-ID cache, original download, or new Server API is used.
struct XDriveIOSNativeOwnerMapClusterAlbum: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let selection: XDriveIOSOwnerMapChosenCluster

    @Environment(\.scenePhase) private var phase
    @State private var generation = UUID()
    @State private var loadTask: Task<Void, Never>?
    @State private var coverTask: Task<Void, Never>?
    @State private var busy = false
    @State private var error: String?
    @State private var cursor = XDriveIOSOwnerClusterCursor(placeIndex: 0, offset: 0)
    @State private var earlier: [XDriveIOSOwnerClusterCursor] = []
    @State private var next: XDriveIOSOwnerClusterCursor?
    @State private var page: XDriveIOSNativeMediaRange?
    @State private var coverImages: [UInt64: UIImage] = [:]
    @State private var viewing: XDriveIOSNativeMediaItem?
    // A Viewer may only promote an exact adjacent Range after verifying its
    // prior signed place page. No guessed place or cached media identities.
    @State private var pendingViewerCross: XDriveIOSOwnerClusterCursor?
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    init(login: XDriveIOSNativeOwnerLoginModel,
         selection: XDriveIOSOwnerMapChosenCluster) {
        self.login = login
        self.selection = selection
    }

    private var activeOwner: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, selection.owner)
    }

    private var selectedPhotoCount: Int {
        selection.places.reduce(0) { $0 + $1.item_count }
    }

    var body: some View {
        VStack(spacing: 8) {
            Text("\(selection.places.count) 个位置 · \(selectedPhotoCount) 张已索引照片")
                .font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("native-ios-owner-cluster-count")
            if let error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            }
            if busy { ProgressView("核对当前 Owner 的地点照片…") }
            if let page, cursor.placeIndex < selection.places.count {
                Text("位置 \(cursor.placeIndex + 1)/\(selection.places.count) · 当前地点 \(page.offset + 1)–\(page.offset + page.items.count)/\(page.total_count)")
                    .font(.caption).monospacedDigit()
            }
            ScrollView {
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(page?.items ?? []) { item in
                        Button {
                            guard activeOwner, !busy, viewing == nil,
                                  page?.items.contains(where: {
                                      $0.sameVisibleRevision(as: item)
                                  }) == true else { return }
                            viewing = item
                        } label: {
                            GeometryReader { tile in
                                ZStack(alignment: .bottomTrailing) {
                                    Rectangle().fill(Color(uiColor: .tertiarySystemFill))
                                    if let image = coverImages[item.id] {
                                        Image(uiImage: image)
                                            .resizable().scaledToFill()
                                            .frame(width: tile.size.width,
                                                   height: tile.size.height)
                                            .clipped()
                                    } else {
                                        Image(systemName: item.isVideo ? "video" : "photo")
                                            .font(.title2).foregroundStyle(.secondary)
                                            .frame(width: tile.size.width,
                                                   height: tile.size.height)
                                    }
                                    if item.isLive || item.isVideo {
                                        Image(systemName: item.isLive ? "livephoto" : "play.fill")
                                            .font(.caption).foregroundStyle(.white)
                                            .padding(5)
                                            .background(.black.opacity(0.55), in: Capsule())
                                            .padding(5)
                                    }
                                }
                            }
                            .aspectRatio(1, contentMode: .fit)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.isLive ? "实况照片" :
                                             item.isVideo ? "视频" : "照片")
                    }
                }
                .padding(.horizontal, 4)
            }
            .id("\(cursor.placeIndex):\(cursor.offset)")
            HStack(spacing: 12) {
                Button("上一批") {
                    guard let previous = earlier.last else { return }
                    load(previous, history: Array(earlier.dropLast()))
                }
                .disabled(busy || !activeOwner || earlier.isEmpty || viewing != nil)
                Spacer(minLength: 0)
                Button("重试") { load(cursor, history: earlier) }
                    .disabled(busy || !activeOwner || viewing != nil)
                Spacer(minLength: 0)
                Button("下一批") {
                    guard let next else { return }
                    load(next, history: earlier + [cursor])
                }
                .disabled(busy || !activeOwner || next == nil || viewing != nil)
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
        }
        .navigationTitle("位置照片")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $viewing, onDismiss: {
            pendingViewerCross = nil
            if activeOwner {
                // Refetch the exact Owner page after L3; do not assume its
                // thumbnail revisions remained valid while the Viewer covered it.
                load(cursor, history: earlier)
            } else {
                invalidate()
            }
        }) { initial in
            XDriveIOSNativeServerMediaPreview(
                item: initial, login: login,
                loadedItems: page?.items ?? [],
                loadedRange: page,
                openedOwner: selection.owner,
                onNavigate: { neighbor in
                    guard activeOwner, viewing?.id == initial.id, let page,
                          page.items.contains(where: {
                              $0.sameVisibleRevision(as: neighbor)
                          }) else { return false }
                    return true
                },
                onCrossRange: { previous, anchor, direction in
                    guard activeOwner, viewing?.id == initial.id,
                          let current = page,
                          current.sameVisibleSnapshot(as: previous),
                          previous.offset == cursor.offset,
                          selection.places.indices.contains(cursor.placeIndex),
                          let anchorIndex = previous.items.firstIndex(where: {
                              $0.sameVisibleRevision(as: anchor)
                          }),
                          let targetOffset =
                            XDriveIOSNativePhotoAssetRangeCursorPolicy.adjacentOffset(
                                current: previous.offset, count: previous.items.count,
                                total: previous.total_count,
                                selectedIndex: anchorIndex, direction: direction
                            )
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    pendingViewerCross = nil
                    let currentCursor = cursor
                    let targetCursor = XDriveIOSOwnerClusterCursor(
                        placeIndex: currentCursor.placeIndex, offset: targetOffset)
                    let facet = selection.places[currentCursor.placeIndex]
                    guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet),
                          previous.total_count == facet.item_count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let authorized = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard activeOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(
                            authorized.owner, selection.owner
                          ),
                          cursor == currentCursor,
                          page?.sameVisibleSnapshot(as: previous) == true
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let reader = XDriveIOSNativeMediaGalleryReader(
                        owner: authorized.owner, accessToken: authorized.accessToken)
                    // Even if a new page has a valid offset, the old snapshot
                    // must still be EXACTLY the one the Viewer left.
                    let reread = try await reader.page(
                        offset: currentCursor.offset, placeID: facet.id)
                    guard previous.sameVisibleSnapshot(as: reread),
                          reread.total_count == facet.item_count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let following = try await reader.page(
                        offset: targetOffset, placeID: facet.id)
                    try Task.checkCancellation()
                    guard activeOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(
                            login.owner, selection.owner
                          ),
                          cursor == currentCursor,
                          page?.sameVisibleSnapshot(as: previous) == true,
                          following.total_count == facet.item_count,
                          following.offset == targetOffset,
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                            offset: following.offset, count: following.items.count,
                            total: following.total_count
                          ),
                          Set(following.items.map(\.id)).count == following.items.count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    pendingViewerCross = targetCursor
                    return following
                },
                onCrossedRange: { opened, verifiedRange in
                    guard activeOwner, viewing?.id == initial.id,
                          let oldPage = page, let admitted = pendingViewerCross,
                          admitted.placeIndex == cursor.placeIndex,
                          admitted.offset == verifiedRange.offset,
                          selection.places.indices.contains(cursor.placeIndex),
                          verifiedRange.total_count ==
                            selection.places[cursor.placeIndex].item_count,
                          abs(verifiedRange.offset - oldPage.offset) ==
                            XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize,
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                            offset: verifiedRange.offset,
                            count: verifiedRange.items.count,
                            total: verifiedRange.total_count
                          ),
                          verifiedRange.items.contains(where: {
                              $0.sameVisibleRevision(as: opened)
                          })
                    else { return false }
                    pendingViewerCross = nil
                    if admitted.offset > cursor.offset {
                        earlier.append(cursor)
                    } else if earlier.last == admitted {
                        earlier.removeLast()
                    } else {
                        earlier = []
                    }
                    cursor = admitted
                    page = verifiedRange
                    coverTask?.cancel()
                    coverImages = [:]
                    let after = verifiedRange.offset + verifiedRange.items.count
                    if after < verifiedRange.total_count {
                        next = XDriveIOSOwnerClusterCursor(
                            placeIndex: admitted.placeIndex, offset: after)
                    } else if admitted.placeIndex + 1 < selection.places.count {
                        next = XDriveIOSOwnerClusterCursor(
                            placeIndex: admitted.placeIndex + 1, offset: 0)
                    } else {
                        next = nil
                    }
                    return true
                }
            )
        }
        .onAppear {
            if page == nil && !busy && activeOwner {
                load(XDriveIOSOwnerClusterCursor(placeIndex: 0, offset: 0),
                     history: [])
            }
        }
        .onChange(of: login.owner) { _ in
            if !activeOwner { invalidate() }
        }
        .onChange(of: phase) { state in
            if state != .active { invalidate() }
            else if page == nil && !busy && activeOwner {
                load(XDriveIOSOwnerClusterCursor(placeIndex: 0, offset: 0),
                     history: [])
            }
        }
        .onDisappear {
            loadTask?.cancel()
            coverTask?.cancel()
            if viewing == nil { invalidate() }
        }
    }

    private func invalidate() {
        generation = UUID()
        loadTask?.cancel()
        coverTask?.cancel()
        loadTask = nil
        coverTask = nil
        page = nil
        coverImages = [:]
        viewing = nil
        next = nil
        earlier = []
        pendingViewerCross = nil
        busy = false
    }

    private func load(_ target: XDriveIOSOwnerClusterCursor,
                      history: [XDriveIOSOwnerClusterCursor]) {
        guard activeOwner, !busy, viewing == nil,
              target.placeIndex >= 0,
              target.placeIndex < selection.places.count,
              target.offset >= 0 else { return }
        generation = UUID()
        let ticket = generation
        loadTask?.cancel()
        coverTask?.cancel()
        coverImages = [:]
        pendingViewerCross = nil
        error = nil
        busy = true
        loadTask = Task { @MainActor in
            defer {
                if generation == ticket { busy = false; loadTask = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard generation == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, selection.owner
                      ) else { return }
                let facet = selection.places[target.placeIndex]
                guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet)
                else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let fetched = try await reader.page(
                    offset: target.offset, placeID: facet.id)
                try Task.checkCancellation()
                guard generation == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, selection.owner
                      ),
                      fetched.total_count == facet.item_count,
                      fetched.offset == target.offset,
                      !fetched.items.isEmpty else {
                    throw XDriveIOSNativeMediaReadFailure.invalidPage
                }
                let after = fetched.offset + fetched.items.count
                let following: XDriveIOSOwnerClusterCursor?
                if after < fetched.total_count {
                    following = XDriveIOSOwnerClusterCursor(
                        placeIndex: target.placeIndex, offset: after)
                } else if target.placeIndex + 1 < selection.places.count {
                    following = XDriveIOSOwnerClusterCursor(
                        placeIndex: target.placeIndex + 1, offset: 0)
                } else {
                    following = nil
                }
                cursor = target
                earlier = history
                next = following
                page = fetched
                coverTask = Task { @MainActor in
                    // At most 48 sequential thumbnails; no original download.
                    for item in fetched.items where item.metadata.has_thumbnail {
                        guard !Task.isCancelled, generation == ticket,
                              activeOwner, cursor == target else { return }
                        do {
                            let thumb = try await reader.thumbnail(item)
                            try Task.checkCancellation()
                            guard generation == ticket, activeOwner,
                                  cursor == target else { return }
                            coverImages[item.id] = thumb
                        } catch is CancellationError {
                            return
                        } catch let failure as XDriveIOSNativeMediaReadFailure {
                            if case .response(let code) = failure,
                               code == 401 || code == 403 {
                                if generation == ticket {
                                    invalidate()
                                    error = "Owner 权限已变化，请返回地图刷新。"
                                }
                                return
                            }
                        } catch {
                            // Missing thumbnail isn't a missing original.
                        }
                    }
                }
            } catch is CancellationError {
            } catch {
                guard generation == ticket else { return }
                // Do not promote an unverified next cursor on failure.
                self.error = "地点照片或 Owner 授权已变化；可重试，必要时返回地图刷新。"
            }
        }
    }
}
