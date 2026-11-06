import SwiftUI

struct XDriveIOSNativeUnifiedGallerySelection: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let page: XDriveIOSNativeUnifiedGalleryPage
    let position: Int
}

/// One mixed sequence, with the existing native still/video/Live decoders.
/// Replacing a row retires the previous viewer and its media requests.
@MainActor
struct XDriveIOSNativeUnifiedPhotoViewer: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var wall: XDriveIOSNativeUnifiedPhotoWall
    let selection: XDriveIOSNativeUnifiedGallerySelection
    let filter: XDriveIOSNativeGalleryPresence?
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let onViewed: (Int, String) -> Void
    let pairing: (XDriveIOSNativeUnifiedPhoto) -> Void
    @State private var page: XDriveIOSNativeUnifiedGalleryPage
    @State private var position: Int
    @State private var cloud: XDriveIOSNativeMediaItem?
    @State private var busy = false
    @State private var failure: String?
    @State private var usedFallback = false
    @State private var showingPairing = false
    @State private var operation: Task<Void, Never>?
    @State private var request = UUID()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase

    init(login: XDriveIOSNativeOwnerLoginModel, wall: XDriveIOSNativeUnifiedPhotoWall,
         selection: XDriveIOSNativeUnifiedGallerySelection, filter: XDriveIOSNativeGalleryPresence?,
         query: XDriveIOSNativeUnifiedGalleryQuery,
         onViewed: @escaping (Int, String) -> Void,
         pairing: @escaping (XDriveIOSNativeUnifiedPhoto) -> Void) {
        self.login = login; self.wall = wall; self.selection = selection
        self.filter = filter; self.query = query; self.onViewed = onViewed; self.pairing = pairing
        _page = State(initialValue: selection.page)
        _position = State(initialValue: selection.position)
    }

    private var row: XDriveIOSNativeUnifiedPhoto { page.rows[position] }
    private var authorized: Bool { phase == .active && XDriveIOSNativePhotoOwnerScope.matches(login.owner, selection.owner) }

    var body: some View {
        NavigationStack {
            media
                .id("\(row.id):\(cloud?.id ?? 0)")
                .safeAreaInset(edge: .bottom) { navigation }
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Menu {
                            Button("来源与核对详情") { showingPairing = true }
                            if row.local != nil && row.match != nil && cloud == nil {
                                Button("查看云端副本") { loadCloud(automatic: false) }
                            }
                            if cloud != nil && row.local != nil {
                                Button("使用本机原件") { cancel(); cloud = nil }
                            }
                        } label: { Image(systemName: row.presence.symbol) }
                        .disabled(!authorized || busy)
                    }
                }
        }
        .onAppear { onViewed(page.number, row.id) }
        .sheet(isPresented: $showingPairing) {
            XDriveIOSNativePhotoPairingDetails(row: row, retry: { pairing(row) })
        }
        .onChange(of: login.owner) { _ in cancel(); dismiss() }
        .onChange(of: wall.generation) { _ in cancel(); dismiss() }
        .onChange(of: phase) { if $0 != .active { cancel(); dismiss() } }
        .onDisappear { cancel() }
    }

    @ViewBuilder private var media: some View {
        if authorized {
            if let cloud = cloud ?? (row.local == nil ? row.cloud : nil) {
                XDriveIOSNativeServerMediaPreview(item: cloud, login: login, openedOwner: selection.owner,
                                                 onUnifiedNavigate: navigate)
            } else if let local = row.local {
                XDriveIOSNativeLocalPhotoDetail(candidate: local, onUnifiedNavigate: navigate,
                    onOriginalUnavailable: { id in
                        guard id == row.local?.id else { return }
                        loadCloud(automatic: true)
                    })
            }
        } else { Color.black }
    }

    private var navigation: some View {
        VStack(spacing: 4) {
            if busy { ProgressView("正在读取…").font(.caption) }
            if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button { navigate(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .accessibilityLabel("上一张")
                    .disabled(busy || (page.number == 0 && position == 0))
                Spacer()
                Text(cloud != nil && row.local != nil ? "\(row.presence.title) · 使用云端原件" : row.presence.title)
                    .font(.caption)
                Spacer()
                Button { navigate(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .accessibilityLabel("下一张")
                    .disabled(busy || (position == page.rows.count - 1 && page.number == wall.index.pages.count - 1))
            }
            ScrollViewReader { scroll in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 4) {
                        ForEach(Array(page.rows.enumerated()), id: \.element.id) { index, photo in
                            Button { show(page: page, at: index) } label: {
                                XDriveIOSUnifiedPhotoTile(row: photo, login: login, presentingOwner: selection.owner,
                                                         displayActive: authorized)
                                    .frame(width: 48, height: 48)
                                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(index == position ? Color.accentColor : .clear, lineWidth: 2))
                            }
                            .buttonStyle(.plain).disabled(busy).id(photo.id)
                            .accessibilityLabel("\(photo.presence.title)，第 \(index + 1) 张")
                        }
                    }.padding(3)
                }
                .onAppear { scroll.scrollTo(row.id, anchor: .center) }
                .onChange(of: row.id) { scroll.scrollTo($0, anchor: .center) }
            }
        }
        .padding(.horizontal, 8).background(.ultraThinMaterial)
        .accessibilityIdentifier("native-ios-unified-viewer-navigation")
    }

    private func show(page: XDriveIOSNativeUnifiedGalleryPage, at index: Int) {
        guard authorized, page.rows.indices.contains(index) else { return }
        cancel()
        self.page = page; position = index
        cloud = nil; usedFallback = false; failure = nil
        onViewed(page.number, row.id)
    }

    private func navigate(_ direction: Int) {
        guard authorized, !busy, direction == -1 || direction == 1 else { return }
        let next = position + direction
        if page.rows.indices.contains(next) { show(page: page, at: next); return }
        cancel()
        busy = true
        let ticket = request
        var number = page.number + direction
        operation = Task {
            defer { if request == ticket { busy = false; operation = nil } }
            do {
                while wall.index.pages.indices.contains(number) {
                    let adjacent = try await wall.read(page: number, login: login, owner: selection.owner,
                                                       filter: filter, query: query)
                    try Task.checkCancellation()
                    guard request == ticket, authorized else { return }
                    if !adjacent.rows.isEmpty {
                        show(page: adjacent, at: direction > 0 ? 0 : adjacent.rows.count - 1)
                        return
                    }
                    number += direction
                    await Task.yield()
                }
                failure = direction > 0 ? "已经是最后一张" : "已经是第一张"
            } catch is CancellationError {
            } catch {
                if request == ticket && authorized { failure = "相邻照片暂不可读，请返回图库刷新后重试。" }
            }
        }
    }

    private func loadCloud(automatic: Bool) {
        guard authorized, !busy, cloud == nil, let match = row.match,
              !automatic || !usedFallback else { return }
        cancel()
        usedFallback = true
        busy = true
        let ticket = request
        let selectedID = row.id
        operation = Task {
            defer { if request == ticket { busy = false; operation = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, selection.owner) else { return }
                let current = try await XDriveIOSNativeMediaGalleryReader(owner: selection.owner, accessToken: auth.accessToken)
                    .matchedMedia(match)
                try Task.checkCancellation()
                guard request == ticket, authorized, row.id == selectedID else { return }
                cloud = current
                failure = nil
            } catch is CancellationError {
            } catch {
                if request == ticket && authorized { failure = "已匹配的云端副本暂不可读，可在来源菜单重试。" }
            }
        }
    }

    private func cancel() { request = UUID(); operation?.cancel(); operation = nil; busy = false }
}
