import SwiftUI
import UIKit

/// MapKit's visual cluster contains only exact Owner-issued place facets.
struct XDriveIOSOwnerMapChosenCluster: Identifiable {
    let id = UUID()
    let places: [XDriveIOSNativeOwnerMapFacet]
    let owner: XDriveNativeOwnerRoot
    let captureRange: XDriveIOSNativePhotoMapCaptureRange?
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
    @State private var coverLoading = false
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
    // During a verified automatic append, preserve the last visible tile
    // while the former two-window head rotates out of the LazyVGrid.
    @State private var autoScrollReturn: XDriveIOSNativeMediaItem?
    @State private var visiblePageRevision = UUID()
    // A Viewer may only promote an exact adjacent Range after verifying its
    // prior signed place page. No guessed place or cached media identities.
    @State private var pendingViewerCross: XDriveIOSOwnerClusterCursor?
    @State private var wallDensity: XDriveIOSNativePhotoWallDensity = .standard

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
                // The signed 48-item transport is not a user-facing page:
                // expose its progress to VoiceOver without a visible counter.
                .accessibilityValue(
                    page.map {
                        "当前位置 \(cursor.placeIndex + 1)/\(selection.places.count)，已读取 \($0.offset + $0.items.count)/\($0.total_count)"
                    } ?? "正在读取位置照片"
                )
            if let error {
                XDriveIOSNativePhotoWallRetryMessage(
                    message: error, buttonTitle: "重试读取照片",
                    canRetry: !busy && activeOwner && viewing == nil,
                    accessibilityID: "native-ios-owner-map-cluster-inline-retry"
                ) {
                    load(cursor, history: earlier)
                }
            }
            if busy {
                XDriveIOSNativePhotoWallLoadingMessage(message: "核对当前 Owner 的地点照片…")
            }
            ScrollViewReader { returnScroll in
            ScrollView {
                XDriveIOSNativePhotoWallGrid(density: wallDensity) {
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
                    // The lazy-grid foot advances the verified Owner Range
                    // when it approaches the viewport, like native Photos.
                    // It remains guarded by Owner, busy, cover and error state.
                    if let next {
                        Color.clear
                            .frame(height: 24)
                            .id("\(next.placeIndex):\(next.offset)")
                            .onAppear {
                                scrollFootVisible = true
                                advanceIfVisible()
                            }
                            .onDisappear { scrollFootVisible = false }
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 4)
            }
            .onChange(of: visiblePageRevision) { _ in
                // Auto paging replaces the previous pair of 48-photo windows.
                // Re-anchor only to a Node+revision still present in the exact
                // verified retained prior Range, never a stale photo ID.
                if let anchor = autoScrollReturn {
                    if activeOwner,
                       XDriveIOSNativePhotoWallWindowPolicy.canRestore(
                           anchor, in: priorWindow?.items ?? [],
                           scopeActive: activeOwner,
                           matches: { $0.sameVisibleRevision(as: $1) }
                       ) {
                        returnScroll.scrollTo(anchor.id, anchor: .bottom)
                    }
                    autoScrollReturn = nil
                }
                // Only the reverified current Owner page can restore focus.
                // An unavailable, deleted or modified Node is never scrolled
                // to using a stale visible ID from the old Viewer.
                guard let anchor = viewerReturn, activeOwner,
                      XDriveIOSNativePhotoWallWindowPolicy.canRestore(
                          anchor, in: page?.items ?? [],
                          scopeActive: activeOwner,
                          matches: { $0.sameVisibleRevision(as: $1) }
                      ) else {
                    viewerReturn = nil
                    return
                }
                returnScroll.scrollTo(anchor.id, anchor: .center)
                viewerReturn = nil
            }
            .onChange(of: busy) { isBusy in
                if !isBusy { advanceIfVisible() }
            }
            }
        }
        .navigationTitle("位置照片")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    // Paging is driven by the visible grid sentinels; expose
                    // only an explicit refresh, not transport-page controls.
                    Button("重新核对当前位置照片") {
                        load(cursor, history: earlier)
                    }
                    .disabled(busy || !activeOwner || viewing != nil)
                    Section("照片网格") {
                        xdrivePhotoWallDensityButtons($wallDensity)
                    }
                } label: {
                    Label("位置照片操作", systemImage: "ellipsis.circle")
                }
                .accessibilityIdentifier("native-ios-owner-map-cluster-more")
            }
        }
        .xdrivePhotoWallPinch(
            density: $wallDensity,
            enabled: activeOwner && !busy && viewing == nil
        )
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
                        offset: currentCursor.offset, placeID: facet.id, captureRange: selection.captureRange)
                    guard previous.sameVisibleSnapshot(as: reread),
                          reread.total_count == facet.item_count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let following: XDriveIOSNativeMediaRange
                    if targetCursor.placeIndex == currentCursor.placeIndex {
                        // Preserve the original same-place adjacent 48-item path.
                        let targetOffset = targetCursor.offset
                        following = try await reader.page(
                            offset: targetOffset, placeID: facet.id, captureRange: selection.captureRange)
                        guard following.total_count == facet.item_count else {
                            throw XDriveIOSNativeMediaReadFailure.invalidPage
                        }
                    } else {
                        // Never use a MapKit region as a PhotoAsset credential.
                        // The destination must be an exact, verified placeID.
                        following = try await reader.page(
                            offset: targetCursor.offset, placeID: targetFacet.id, captureRange: selection.captureRange)
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
            XDriveIOSNativePhotoWallTileShell(isVideo: item.isVideo, isLive: item.isLive) {
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
                }
            }
            .aspectRatio(1, contentMode: .fit)
            }
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

    private func advanceIfVisible() {
        // The next Owner Range is independent of decorative thumbnails.
        // A slow or missing cover must never block continuous scrolling:
        // load() cancels the old coverTask, rechecks the departing signed
        // Range, and keeps at most two verified 48-item windows visible.
        guard XDriveIOSNativePhotoWallWindowPolicy.shouldAdvance(
            footVisible: scrollFootVisible,
            hasNext: page != nil && next != nil, busy: busy,
            failed: error != nil, viewerOpen: viewing != nil,
            scopeActive: activeOwner
        ), let next else { return }
        scrollFootVisible = false
        load(next, history: earlier + [cursor], autoAdvance: true)
    }

    private func invalidate() {
        generation = UUID()
        loadTask?.cancel()
        coverTask?.cancel()
        loadTask = nil
        coverTask = nil
        coverLoading = false
        page = nil
        viewerReturn = nil
        autoScrollReturn = nil
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
              target.offset >= 0,
              target.offset % XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize == 0
        else { return }
        generation = UUID()
        let ticket = generation
        let departingPage = page
        let departingCursor = cursor
        // Ordinary pagination does not carry a stale Viewer anchor into a
        // different place or new 48-item Range. Dismissal reloads the SAME.
        if autoAdvance || target != cursor { viewerReturn = nil }
        autoScrollReturn = nil
        scrollFootVisible = false
        loadTask?.cancel()
        coverTask?.cancel()
        coverTask = nil
        coverLoading = false
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
                if autoAdvance {
                    // A stable item count does not guarantee that old and
                    // new 48-item windows belong to the same media snapshot.
                    // Refuse to append if a reindex/replacement changed even
                    // one existing Node or revision during scrolling.
                    guard let departingPage,
                          history.last == departingCursor,
                          target != departingCursor,
                          selection.places.indices.contains(departingCursor.placeIndex),
                          departingPage.offset == departingCursor.offset,
                          XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                              offset: departingPage.offset,
                              count: departingPage.items.count,
                              total: departingPage.total_count
                          ),
                          departingPage.total_count ==
                            selection.places[departingCursor.placeIndex].item_count
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let priorFacet = selection.places[departingCursor.placeIndex]
                    guard XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(priorFacet)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let currentOldPage = try await reader.page(
                        offset: departingCursor.offset, placeID: priorFacet.id, captureRange: selection.captureRange)
                    try Task.checkCancellation()
                    guard generation == ticket, activeOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(
                              login.owner, selection.owner
                          ),
                          page?.sameVisibleSnapshot(as: departingPage) == true,
                          currentOldPage.sameVisibleSnapshot(as: departingPage)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                }
                let fetched = try await reader.page(
                    offset: target.offset, placeID: facet.id, captureRange: selection.captureRange)
                try Task.checkCancellation()
                guard generation == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, selection.owner
                      ),
                      fetched.total_count == facet.item_count,
                      fetched.offset == target.offset,
                      fetched.limit == XDriveIOSNativePhotoAssetRangeCursorPolicy.pageSize,
                      XDriveIOSNativePhotoAssetRangeCursorPolicy.validPage(
                          offset: fetched.offset, count: fetched.items.count,
                          total: fetched.total_count
                      ),
                      Set(fetched.items.map(\.id)).count == fetched.items.count
                else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                // An auto-advanced window must not duplicate the same Node
                // even if different place facets were temporarily indexed.
                if autoAdvance, let departingPage,
                   target != departingCursor,
                   !Set(departingPage.items.map(\.id))
                     .isDisjoint(with: fetched.items.map(\.id)) {
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
                    autoScrollReturn = departingPage.items.last
                    let admitted = Set(
                        departingPage.items.map(\.id) + fetched.items.map(\.id)
                    )
                    coverImages = coverImages.filter {
                        admitted.contains($0.key)
                    }
                } else {
                    priorWindow = nil
                    priorWindowCursor = nil
                    autoScrollReturn = nil
                    coverImages = [:]
                }
                cursor = target
                earlier = history
                next = following
                page = fetched
                visiblePageRevision = UUID()
                coverLoading = true
                coverTask = Task { @MainActor in
                    defer {
                        if generation == ticket {
                            coverLoading = false
                            coverTask = nil
                            advanceIfVisible()
                        }
                    }
                    // At most 48 sequential thumbnails; no original download.
                    // Finish this bounded window before rotating it out.
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
