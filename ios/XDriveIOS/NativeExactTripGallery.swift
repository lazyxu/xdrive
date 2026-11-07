import SwiftUI
import UIKit

/// Read-only Owner Trips: v2 GPS-calendar-cell members only. The v1 date
/// heuristic is never a browse scope, and every transfer reuses the native
/// Owner HTTPS Reader. This view does not access PhotoKit originals.
struct XDriveIOSNativeExactTripsScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @State private var epoch = UUID()
    @State private var loadTask: Task<Void, Never>?
    @State private var busy = false
    @State private var error: String?
    @State private var trips: [XDriveIOSNativeExactTrip] = []
    @State private var loadedOwner: XDriveNativeOwnerRoot?
    // Year selection is only a display filter over at most 100 verified
    // trip DTOs, never a client-computed member set or a new GPS credential.
    @State private var selectedYear: String?

    private var availableYears: [String] {
        Array(Set(trips.map { String($0.end_date.prefix(4)) })).sorted(by: >)
    }

    private var timeZone: String {
        let candidate = TimeZone.current.identifier
        return XDriveIOSNativeExactTripPolicy.validTimeZone(candidate)
            ? candidate : "UTC"
    }

    var body: some View {
        List {
            Section {
                Text("只列出当前 Owner 已核对 GPS 日期与主要地点的行程。"
                     + " 其他同日照片不会仅凭拍摄日期加入旅行。")
                    .font(.caption).foregroundStyle(.secondary)
                if busy { ProgressView("核对旅行地点…") }
                if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("重试") { reload() }.disabled(busy)
                }
                if trips.isEmpty && !busy && error == nil {
                    Text("当前没有满足条件的已索引旅行地点。")
                        .foregroundStyle(.secondary)
                }
            }
            if let owner = loadedOwner,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                ForEach(availableYears.filter {
                    selectedYear == nil || selectedYear == $0
                }, id: \.self) { year in
                    Section("\(year) 年的旅行") {
                        ForEach(trips.filter {
                            $0.end_date.hasPrefix(year)
                        }) { trip in
                            NavigationLink {
                                XDriveIOSNativeExactTripWall(
                                    login: login, expectedOwner: owner,
                                    trip: trip, timeZone: timeZone)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(trip.title).font(.headline)
                                    Text(trip.subtitle ??
                                         "\(trip.start_date) – \(trip.end_date)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(minHeight: 44, alignment: .leading)
                            }
                            .accessibilityIdentifier("native-ios-exact-trip-\(trip.id)")
                        }
                    }
                }
            }
        }
        .navigationTitle("旅行地点")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("所有年份") { selectedYear = nil }
                    ForEach(availableYears, id: \.self) { year in
                        Button(year) { selectedYear = year }
                    }
                } label: {
                    Label(selectedYear ?? "年份", systemImage: "calendar")
                }
                .disabled(availableYears.isEmpty || busy || phase != .active)
                .accessibilityIdentifier("native-ios-exact-trips-year-filter")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("刷新") { reload() }.disabled(busy || phase != .active)
            }
        }
        .onAppear {
            // NavigationStack may retain this parent while showing a child.
            // Re-admit retained trip labels only for the original Owner.
            if let loadedOwner,
               !XDriveIOSNativePhotoOwnerScope.matches(
                   login.owner, loadedOwner) {
                invalidate()
            }
            if !busy && trips.isEmpty { reload() }
        }
        .onChange(of: login.owner) { _ in
            selectedYear = nil
            invalidate()
            if phase == .active && login.owner != nil { reload() }
        }
        .onChange(of: phase) { new in
            if new == .active { reload() } else { invalidate() }
        }
        .onDisappear {
            // Pushing a NavigationLink also makes this view disappear.
            // Clearing its List here would remove the active row and may
            // pop the genuine trip detail. Only cancel the in-flight read;
            // background and Owner revocation still invalidate immediately.
            loadTask?.cancel()
            loadTask = nil
            if phase != .active || login.owner == nil { invalidate() }
        }
    }

    private func invalidate() {
        epoch = UUID()
        loadTask?.cancel()
        loadTask = nil
        loadedOwner = nil
        trips = []
        busy = false
        error = nil
    }

    private func reload() {
        invalidate()
        guard phase == .active, let expected = login.owner else { return }
        let ticket = epoch
        busy = true
        loadTask = Task { @MainActor in
            defer {
                if epoch == ticket { busy = false; loadTask = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, expected)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let items = try await reader.exactTrips(timeZone: timeZone)
                try Task.checkCancellation()
                guard epoch == ticket, phase == .active,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, expected)
                else { return }
                loadedOwner = expected
                trips = items
                if let selectedYear,
                   !availableYears.contains(selectedYear) {
                    self.selectedYear = nil
                }
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                self.error = "旅行地点已变化或当前 Owner 无法读取，请刷新。"
            }
        }
    }
}

/// Two-window maximum (2 × 48) continuous GPS-member wall. When rotating a
/// window, reverify the complete departing Owner Range before appending.
/// No Client-wide trip-member arrays, no synthetic date-range credentials.
struct XDriveIOSNativeExactTripWall: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let trip: XDriveIOSNativeExactTrip
    let timeZone: String
    @Environment(\.scenePhase) private var phase
    @State private var epoch = UUID()
    @State private var task: Task<Void, Never>?
    @State private var openTask: Task<Void, Never>?
    @State private var busy = false
    @State private var opening = false
    @State private var error: String?
    @State private var page: XDriveIOSNativeMediaRange?
    @State private var previousPage: XDriveIOSNativeMediaRange?
    @State private var selected: XDriveIOSNativeMediaItem?
    @State private var viewerPage: XDriveIOSNativeMediaRange?
    @State private var viewerReturnID: UInt64?
    @State private var revision = UUID()
    @State private var density: XDriveIOSNativePhotoWallDensity = .standard
    @State private var scrollFootVisible = false

    private var activeOwner: Bool {
        phase == .active &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    Text("当前旅行真实 GPS 地点成员 · \(trip.item_count) 张")
                        .font(.caption).foregroundStyle(.secondary)
                    XDriveIOSNativePhotoWallGrid(density: density) {
                        if let previousPage {
                            ForEach(previousPage.items) { item in
                                tile(item, in: previousPage)
                            }
                        }
                        if let page {
                            ForEach(page.items) { item in tile(item, in: page) }
                        }
                    }
                    if let page, page.offset + page.items.count < page.total_count {
                        Color.clear.frame(height: 1)
                            .accessibilityIdentifier("native-ios-exact-trip-sentinel")
                            .onAppear {
                                scrollFootVisible = true
                                advanceIfVisible()
                            }
                            .onDisappear { scrollFootVisible = false }
                    }
                    if busy { ProgressView("核对下一批旅行照片…") }
                    if opening { ProgressView("核对照片权限…") }
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                        Button("重新读取") { load(offset: 0, autoAdvance: false) }
                            .disabled(busy || opening || !activeOwner)
                    }
                }
                .padding(10)
            }
            .onChange(of: revision) { _ in
                // Viewer return wins over a retired rolling-window anchor.
                // Only the reverified current Owner/Node page can restore it.
                if let id = viewerReturnID, activeOwner,
                   selected == nil,
                   page?.items.contains(where: { $0.id == id }) == true {
                    scroll.scrollTo(id, anchor: .center)
                    viewerReturnID = nil
                } else if let anchor = previousPage?.items.last,
                          activeOwner, !opening, selected == nil {
                    scroll.scrollTo(anchor.id, anchor: .bottom)
                }
            }
        }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    ForEach(XDriveIOSNativePhotoWallDensity.allCases) { option in
                        Button(option.title) { density = option }
                    }
                } label: {
                    Label("缩略图大小", systemImage: "square.grid.3x3")
                }
                .accessibilityIdentifier("native-ios-exact-trip-density")
            }
        }
        .fullScreenCover(item: $selected, onDismiss: {
            let verifiedOffset = viewerPage?.offset ?? page?.offset ?? 0
            viewerPage = nil
            if activeOwner { load(offset: verifiedOffset, autoAdvance: false) }
            else { invalidate() }
        }) { initial in
            XDriveIOSNativeServerMediaPreview(
                item: initial, login: login,
                loadedItems: viewerPage?.items ?? [],
                loadedRange: viewerPage,
                openedOwner: expectedOwner,
                onNavigate: { next in
                    guard activeOwner, selected?.id == initial.id,
                          let current = viewerPage,
                          next.supportsPreview,
                          current.items.contains(where: {
                              $0.sameVisibleRevision(as: next)
                          })
                    else { return false }
                    viewerReturnID = next.id
                    return true
                },
                onCrossRange: { previous, anchor, direction in
                    guard activeOwner, selected?.id == initial.id,
                          viewerPage?.sameVisibleSnapshot(as: previous) == true,
                          let currentIndex = previous.items.firstIndex(where: {
                              $0.sameVisibleRevision(as: anchor)
                          }),
                          let targetOffset =
                              XDriveIOSNativePhotoAssetRangeCursorPolicy.adjacentOffset(
                                  current: previous.offset,
                                  count: previous.items.count,
                                  total: previous.total_count,
                                  selectedIndex: currentIndex,
                                  direction: direction
                              )
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }

                    let auth = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard activeOwner, selected?.id == initial.id,
                          XDriveIOSNativePhotoOwnerScope.matches(
                              auth.owner, expectedOwner),
                          XDriveIOSNativePhotoOwnerScope.matches(
                              login.owner, expectedOwner),
                          viewerPage?.sameVisibleSnapshot(as: previous) == true
                    else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
                    let reader = XDriveIOSNativeMediaGalleryReader(
                        owner: auth.owner, accessToken: auth.accessToken)
                    // The old trip membership/Node revisions must still
                    // match before crossing; never treat a date range as
                    // proof of the next page.
                    let reread = try await reader.exactTripPage(
                        trip, offset: previous.offset, timeZone: timeZone)
                    try Task.checkCancellation()
                    guard reread.sameVisibleSnapshot(as: previous),
                          activeOwner, selected?.id == initial.id,
                          viewerPage?.sameVisibleSnapshot(as: previous) == true
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let next = try await reader.exactTripPage(
                        trip, offset: targetOffset, timeZone: timeZone)
                    try Task.checkCancellation()
                    guard activeOwner, selected?.id == initial.id,
                          XDriveIOSNativePhotoOwnerScope.matches(
                              login.owner, expectedOwner),
                          viewerPage?.sameVisibleSnapshot(as: previous) == true,
                          next.total_count == previous.total_count,
                          next.offset == targetOffset,
                          Set(next.items.map(\.id)).count == next.items.count,
                          Set(previous.items.map(\.id)).isDisjoint(
                              with: next.items.map(\.id))
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    return next
                },
                onCrossedRange: { next, verifiedRange in
                    guard activeOwner, selected?.id == initial.id,
                          let previous = viewerPage,
                          next.supportsPreview,
                          verifiedRange.total_count == trip.item_count,
                          verifiedRange.items.contains(where: {
                              $0.sameVisibleRevision(as: next)
                          }),
                          verifiedRange.offset != previous.offset,
                          Set(previous.items.map(\.id)).isDisjoint(
                              with: verifiedRange.items.map(\.id))
                    else { return false }
                    // Keep only the new verified 48-item Viewer range.
                    // The map/list wall refreshes on dismissal and returns
                    // to the last accepted exact Node+revision.
                    viewerPage = verifiedRange
                    viewerReturnID = next.id
                    return true
                }
            )
        }
        .onAppear { if page == nil && !busy { load(offset: 0, autoAdvance: false) } }
        .onChange(of: login.owner) { _ in
            if !activeOwner { invalidate() }
        }
        .onChange(of: phase) { new in
            if new != .active { invalidate() }
            else if page == nil { load(offset: 0, autoAdvance: false) }
        }
        .onDisappear {
            task?.cancel()
            openTask?.cancel()
            if selected == nil { invalidate() }
        }
    }

    private func tile(
        _ item: XDriveIOSNativeMediaItem,
        in origin: XDriveIOSNativeMediaRange
    ) -> some View {
        Button { openVerified(item, in: origin) } label: {
            XDriveIOSNativeExactTripTile(
                item: item, login: login, expectedOwner: expectedOwner,
                viewerActive: selected != nil)
        }
        .buttonStyle(.plain)
        .disabled(!activeOwner || busy || opening || selected != nil ||
                  !item.supportsPreview)
        .id(item.id)
    }

    private func advanceIfVisible() {
        guard scrollFootVisible, activeOwner, !busy, !opening,
              selected == nil, error == nil, let page else { return }
        let after = page.offset + page.items.count
        guard after < page.total_count, after % 48 == 0 else { return }
        scrollFootVisible = false
        load(offset: after, autoAdvance: true)
    }

    private func invalidate() {
        epoch = UUID()
        task?.cancel()
        openTask?.cancel()
        task = nil
        openTask = nil
        page = nil
        previousPage = nil
        selected = nil
        viewerPage = nil
        viewerReturnID = nil
        error = nil
        busy = false
        opening = false
        scrollFootVisible = false
    }

    private func load(offset: Int, autoAdvance: Bool) {
        guard activeOwner, !busy, !opening, selected == nil else { return }
        let departing = page
        epoch = UUID()
        let ticket = epoch
        task?.cancel()
        task = nil
        scrollFootVisible = false
        error = nil
        busy = true
        task = Task { @MainActor in
            defer { if epoch == ticket { busy = false; task = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, expectedOwner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                if autoAdvance {
                    guard let departing, departing.offset + departing.items.count == offset
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                    let reread = try await reader.exactTripPage(
                        trip, offset: departing.offset, timeZone: timeZone)
                    try Task.checkCancellation()
                    guard epoch == ticket, activeOwner,
                          page?.sameVisibleSnapshot(as: departing) == true,
                          reread.sameVisibleSnapshot(as: departing)
                    else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                }
                let next = try await reader.exactTripPage(
                    trip, offset: offset, timeZone: timeZone)
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, expectedOwner)
                else { return }
                if autoAdvance, let departing,
                   !Set(departing.items.map(\.id)).isDisjoint(
                       with: next.items.map(\.id)) {
                    throw XDriveIOSNativeMediaReadFailure.invalidPage
                }
                previousPage = autoAdvance ? departing : nil
                page = next
                revision = UUID()
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                // A changed trip ID or place membership must not retain old
                // thumbnails or fall back to all photos from the same date.
                page = nil
                previousPage = nil
                viewerReturnID = nil
                error = "该旅行照片成员已变化，请返回旅行列表刷新。"
            }
        }
    }

    private func openVerified(
        _ item: XDriveIOSNativeMediaItem, in origin: XDriveIOSNativeMediaRange
    ) {
        guard activeOwner, !busy, !opening, selected == nil,
              item.supportsPreview,
              page?.sameVisibleSnapshot(as: origin) == true ||
              previousPage?.sameVisibleSnapshot(as: origin) == true,
              origin.items.contains(where: { $0.sameVisibleRevision(as: item) })
        else { return }
        opening = true
        let ticket = epoch
        openTask?.cancel()
        openTask = Task { @MainActor in
            defer { if epoch == ticket { opening = false; openTask = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        auth.owner, expectedOwner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let reread = try await reader.exactTripPage(
                    trip, offset: origin.offset, timeZone: timeZone)
                try Task.checkCancellation()
                guard epoch == ticket, activeOwner,
                      (page?.sameVisibleSnapshot(as: origin) == true ||
                       previousPage?.sameVisibleSnapshot(as: origin) == true),
                      reread.sameVisibleSnapshot(as: origin)
                else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
                viewerPage = reread
                viewerReturnID = item.id
                selected = item
            } catch is CancellationError {
            } catch {
                if epoch == ticket { error = "照片已变化，请刷新旅行成员。" }
            }
        }
    }
}

/// Individual visible 280px derivative only, no original export and no
/// thumbnail cache retained after leaving a bounded native trip window.
private struct XDriveIOSNativeExactTripTile: View {
    let item: XDriveIOSNativeMediaItem
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let viewerActive: Bool
    @State private var image: UIImage?

    var body: some View {
        GeometryReader { square in
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay {
                            Image(systemName: item.isVideo ? "video" : "photo")
                                .foregroundStyle(.secondary)
                        }
                }
            }
            .frame(width: square.size.width, height: square.size.height)
            .clipped()
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .overlay(alignment: .bottomTrailing) {
            if item.isVideo || item.isLive {
                Image(systemName: item.isVideo ? "play.fill" : "livephoto")
                    .foregroundStyle(.white).padding(5).shadow(radius: 2)
            }
        }
        .accessibilityLabel(item.node.name)
        .task(id: "\(item.id)-\(item.node.revision)-\(viewerActive)") {
            guard !viewerActive, image == nil else { return }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(
                    auth.owner, expectedOwner),
                    XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, expectedOwner)
                else { return }
                let reader = XDriveIOSNativeMediaGalleryReader(
                    owner: auth.owner, accessToken: auth.accessToken)
                let thumbnail = try await reader.thumbnail(item)
                try Task.checkCancellation()
                guard !viewerActive,
                      XDriveIOSNativePhotoOwnerScope.matches(
                          login.owner, expectedOwner)
                else { return }
                image = thumbnail
            } catch {
                // Missing derivative never authorizes or deletes an original.
            }
        }
        .onDisappear { image = nil }
    }
}
