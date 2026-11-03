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
    // Exactly two visible 48-item Owner Ranges maximum. As the user reaches
    // the lower edge, the old page remains on screen while the adjacent
    // trusted page appears; later pages rotate this bounded window.
    @State private var priorWindow: XDriveIOSNativeMediaRange?
    @State private var priorWindowCursor: XDriveIOSOwnerClusterCursor?
    @State private var scrollFootVisible = false
    @State private var coverImages: [UInt64: UIImage] = [:]
    @State private var viewing: XDriveIOSNativeMediaItem?
    // Restore the last successfully viewed Node+revision in the bounded
    // Owner page after L3 closes, without persisting any photo identities.
    @State private var viewerReturn: XDriveIOSNativeMediaItem?
    @State private var visiblePageRevision = UUID()
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
            ScrollViewReader { returnScroll in
            ScrollView {
                LazyVGrid(columns: columns, spacing: 2) {
                    if let priorWindow {
                        ForEach(priorWindow.items) { item in
                            photoTile(item, from: priorWindow)
                        }
                    }
                    if let page {
                        ForEach(page.items) { item in
                            photoTile(item, from: page)
                        }
                    }
                    // This foot is inside LazyVGrid, not an eagerly built
                    // ScrollView sibling. Programmatic appearance alone never
                    // starts another PhotoAsset Range request.
                    if let next {
                        Color.clear
                            .frame(height: 24)
                            .id("\(next.placeIndex):\(next.offset)")
                            .onAppear { scrollFootVisible = true }
                            .onDisappear { scrollFootVisible = false }
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 4)
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 12).onEnded { _ in
                    guard scrollFootVisible, activeOwner, !busy,
                          viewing == nil, page != nil, let next else { return }
                    scrollFootVisible = false
                    load(next, history: earlier + [cursor],
                         autoAdvance: true)
                }
            )
            .onChange(of: visiblePageRevision) { _ in
                // Only the reverified current Owner page can restore focus.
                // An unavailable, deleted or modified Node is never scrolled
                // to using a stale visible ID from the old Viewer.
                guard let anchor = viewerReturn, activeOwner,
                      page?.items.contains(where: {
                          $0.sameVisibleRevision(as: anchor)
                      }) == true else {
                    viewerReturn = nil
                    return
                }
                returnScroll.scrollTo(anchor.id, anchor: .center)
                viewerReturn = nil
            }
            }
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
                    viewerReturn = neighbor
                    return true
                },
                canCrossMapPlace: { previous, anchor, direction in
                    guard activeOwner, viewing?.id == initial.id, let page,
                          page.sameVisibleSnapshot(as: previous),
                          previous.offset == cursor.offset,
                          let index = previous.items.firstIndex(where: {
                              $0.sameVisibleRevision(as: anchor)
                          }) else { return false }
                    return adjacentClusterPlace(
                        current: cursor, previous: previous,
                        selectedIndex: index, direction: direction
                    ) != nil
                },
                onCrossRange: { previous, anchor, direction in
                    guard activeOwner, viewing?.id == initial.id,
                          let current = page,
                          current.sameVisibleSnapshot(as: previous),
                          previous.offset == cursor.offset,
                          selection.places.indices.contains(cursor.placeIndex),
                          let anchorIndex = previous.items.firstIndex(where: {
                              $0.sameVisibleRevision(as: anchor)
                          })
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    pendingViewerCross = nil
                    let currentCursor = cursor
                    let facet = selection.places[currentCursor.placeIndex]
                    guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet),
                          previous.total_count == facet.item_count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let targetCursor: XDriveIOSOwnerClusterCursor
                    if let targetOffset =
                        XDriveIOSNativePhotoAssetRangeCursorPolicy.adjacentOffset(
                            current: previous.offset, count: previous.items.count,
                            total: previous.total_count,
                            selectedIndex: anchorIndex, direction: direction
                        ) {
                        targetCursor = XDriveIOSOwnerClusterCursor(
                            placeIndex: currentCursor.placeIndex, offset: targetOffset)
                    } else if let neighboring = adjacentClusterPlace(
                        current: currentCursor, previous: previous,
                        selectedIndex: anchorIndex, direction: direction
                    ) {
                        targetCursor = neighboring
                    } else {
                        throw XDriveIOSNativeMediaReadFailure.invalidScope
                    }
                    guard selection.places.indices.contains(targetCursor.placeIndex)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let targetFacet = selection.places[targetCursor.placeIndex]
                    guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(targetFacet)
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
                    let following: XDriveIOSNativeMediaRange
                    if targetCursor.placeIndex == currentCursor.placeIndex {
                        // Preserve the original same-place adjacent 48-item path.
                        let targetOffset = targetCursor.offset
                        following = try await reader.page(
                            offset: targetOffset, placeID: facet.id)
                        guard following.total_count == facet.item_count else {
                            throw XDriveIOSNativeMediaReadFailure.invalidPage
                        }
                    } else {
                        // Never use a MapKit region as a PhotoAsset credential.
                        // The destination must be an exact, verified placeID.
                        following = try await reader.page(
                            offset: targetCursor.offset, placeID: targetFacet.id)
                    }
                    try Task.checkCancellation()
                    guard activeOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(
                            login.owner, selection.owner
                          ),
                          cursor == currentCursor,
                          page?.sameVisibleSnapshot(as: previous) == true,
                          following.total_count == targetFacet.item_count,
                          following.offset == targetCursor.offset,
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
                          admitted.offset == verifiedRange.offset,
                          selection.places.indices.contains(cursor.placeIndex),
                          selection.places.indices.contains(admitted.placeIndex),
                          verifiedRange.total_count ==
                            selection.places[admitted.placeIndex].item_count,
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                            offset: verifiedRange.offset,
                            count: verifiedRange.items.count,
                            total: verifiedRange.total_count
                          ),
                          verifiedRange.items.contains(where: {
                              $0.sameVisibleRevision(as: opened)
                          })
                    else { return false }
                    let samePlace = admitted.placeIndex == cursor.placeIndex &&
                        abs(verifiedRange.offset - oldPage.offset) ==
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize
                    let followingPlace = admitted.placeIndex == cursor.placeIndex + 1 &&
                        oldPage.offset + oldPage.items.count == oldPage.total_count &&
                        admitted.offset == 0
                    let precedingPlace = admitted.placeIndex + 1 == cursor.placeIndex &&
                        oldPage.offset == 0 &&
                        admitted.offset ==
                          ((verifiedRange.total_count - 1) /
                            XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize) *
                            XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize
                    guard samePlace || followingPlace || precedingPlace else {
                        return false
                    }
                    pendingViewerCross = nil
                    if followingPlace {
                        earlier.append(cursor)
                    } else if precedingPlace {
                        if earlier.last == admitted {
                            earlier.removeLast()
                        } else {
                            earlier = []
                        }
                    } else if admitted.offset > cursor.offset {
                        earlier.append(cursor)
                    } else if earlier.last == admitted {
                        earlier.removeLast()
                    } else {
                        earlier = []
                    }
                    cursor = admitted
                    page = verifiedRange
                    viewerReturn = opened
                    priorWindow = nil
                    priorWindowCursor = nil
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

    @ViewBuilder
    private func photoTile(
        _ item: XDriveIOSNativeMediaItem,
        from origin: XDriveIOSNativeMediaRange
    ) -> some View {
        Button {
            guard activeOwner, !busy, viewing == nil,
                  (page?.sameVisibleSnapshot(as: origin) == true ||
                   priorWindow?.sameVisibleSnapshot(as: origin) == true),
                  origin.items.contains(where: {
                      $0.sameVisibleRevision(as: item)
                  }) else { return }
            // A prior visible page may still be tapped after automatic
            // advancement. Make that exact verified Range current before
            // launching L3, so the existing Viewer cross-page contract
            // never reads its neighbors against the newer page.
            if let oldCursor = priorWindowCursor,
               priorWindow?.sameVisibleSnapshot(as: origin) == true {
                let newerCursor = cursor
                if earlier.last == oldCursor {
                    earlier.removeLast()
                } else {
                    earlier = []
                }
                cursor = oldCursor
                next = newerCursor
                page = origin
                priorWindow = nil
                priorWindowCursor = nil
            }
            viewerReturn = item
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
        .id(item.id)
        .accessibilityLabel(item.isLive ? "实况照片" :
                             item.isVideo ? "视频" : "照片")
    }

    /// Numeric-only map cluster boundary. A new place is admitted only if
    /// the current exact Owner Range ends or begins at its real boundary.
    /// The actual HTTP read and identity proof happen in onCrossRange.
    private func adjacentClusterPlace(
        current: XDriveIOSOwnerClusterCursor,
        previous: XDriveIOSNativeMediaRange,
        selectedIndex: Int, direction: Int
    ) -> XDriveIOSOwnerClusterCursor? {
        guard selection.places.indices.contains(current.placeIndex),
              previous.offset == current.offset,
              XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                  offset: previous.offset, count: previous.items.count,
                  total: previous.total_count
              ),
              previous.total_count == selection.places[current.placeIndex].item_count,
              XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(
                  selection.places[current.placeIndex]
              ),
              selectedIndex >= 0 && selectedIndex < previous.items.count,
              direction == 1 || direction == -1
        else { return nil }
        let nextIndex: Int
        let nextOffset: Int
        if direction > 0 {
            guard selectedIndex == previous.items.count - 1,
                  previous.offset + previous.items.count == previous.total_count,
                  current.placeIndex + 1 < selection.places.count
            else { return nil }
            nextIndex = current.placeIndex + 1
            nextOffset = 0
        } else {
            guard selectedIndex == 0, previous.offset == 0,
                  current.placeIndex > 0 else { return nil }
            nextIndex = current.placeIndex - 1
            let count = selection.places[nextIndex].item_count
            guard count > 0,
                  count <= XDriveIOSNativePhotoAssetRangeCursorPolicy.maximumTotal
            else { return nil }
            nextOffset = ((count - 1) /
                XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize) *
                XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize
        }
        let destination = selection.places[nextIndex]
        guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(destination),
              destination.item_count > 0,
              destination.item_count <=
                XDriveIOSNativePhotoAssetRangeCursorPolicy.maximumTotal
        else { return nil }
        return XDriveIOSOwnerClusterCursor(
            placeIndex: nextIndex, offset: nextOffset)
    }

    private func invalidate() {
        generation = UUID()
        loadTask?.cancel()
        coverTask?.cancel()
        loadTask = nil
        coverTask = nil
        page = nil
        viewerReturn = nil
        priorWindow = nil
        priorWindowCursor = nil
        scrollFootVisible = false
        coverImages = [:]
        viewing = nil
        next = nil
        earlier = []
        pendingViewerCross = nil
        busy = false
    }

    private func load(_ target: XDriveIOSOwnerClusterCursor,
                      history: [XDriveIOSOwnerClusterCursor],
                      autoAdvance: Bool = false) {
        guard activeOwner, !busy, viewing == nil,
              target.placeIndex >= 0,
              target.placeIndex < selection.places.count,
              target.offset >= 0 else { return }
        generation = UUID()
        let ticket = generation
        let departingPage = page
        let departingCursor = cursor
        // Ordinary pagination does not carry a stale Viewer anchor into a
        // different place or new 48-item Range. Dismissal reloads the SAME.
        if autoAdvance || target != cursor { viewerReturn = nil }
        scrollFootVisible = false
        loadTask?.cancel()
        coverTask?.cancel()
        if !autoAdvance {
            priorWindow = nil
            priorWindowCursor = nil
            coverImages = [:]
        }
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
                // Preserve at most one previous page and the newly validated
                // page. Never combine two unrelated Owner scopes or replay
                // prior photos after a failed Range verification.
                if autoAdvance, let departingPage,
                   history.last == departingCursor,
                   target != departingCursor {
                    priorWindow = departingPage
                    priorWindowCursor = departingCursor
                    let admitted = Set(
                        departingPage.items.map(\.id) + fetched.items.map(\.id)
                    )
                    coverImages = coverImages.filter {
                        admitted.contains($0.key)
                    }
                } else {
                    priorWindow = nil
                    priorWindowCursor = nil
                    coverImages = [:]
                }
                cursor = target
                earlier = history
                next = following
                page = fetched
                visiblePageRevision = UUID()
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
                viewerReturn = nil
                self.error = "地点照片或 Owner 授权已变化；可重试，必要时返回地图刷新。"
            }
        }
    }
}
