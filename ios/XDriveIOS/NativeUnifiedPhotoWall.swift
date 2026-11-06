import Combine
import Foundation
import SwiftUI

struct XDriveIOSNativeUnifiedGalleryPage {
    let number: Int
    let rows: [XDriveIOSNativeUnifiedPhoto]
}

@MainActor
final class XDriveIOSNativeUnifiedPhotoWall: ObservableObject {
    @Published private(set) var index = XDriveIOSNativeUnifiedPageIndex(start: XDriveIOSNativeGalleryCursor())
    @Published private(set) var generation = UUID()
    @Published private(set) var failure: String?
    private(set) var library: Data?

    func reset() {
        generation = UUID()
        index = .init(start: .init())
        library = (try? XDriveIOSPhotoKitLibraryEpoch.capture())?.serialized
        failure = nil
    }

    func accept(_ model: XDriveIOSNativeUnifiedPhotoTimeline, page: Int) -> Bool {
        guard model.completed else { return false }
        guard index.commit(page: page, count: model.rows.count, next: model.next) else {
            failure = "图库排序或配对结果已变化，请刷新以继续浏览。"
            return false
        }
        return true
    }

    func measure(page: Int, height: Double) {
        guard index.pages.indices.contains(page), abs(index.pages[page].height - height) > 1 else { return }
        index.measure(page: page, height: height)
    }

    func read(page: Int, login: XDriveIOSNativeOwnerLoginModel, owner: XDriveNativeOwnerRoot,
              filter: XDriveIOSNativeGalleryPresence?, query: XDriveIOSNativeUnifiedGalleryQuery)
        async throws -> XDriveIOSNativeUnifiedGalleryPage {
        guard failure == nil, index.pages.indices.contains(page),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        let ticket = generation
        let model = XDriveIOSNativeUnifiedPhotoTimeline()
        await model.load(from: index.pages[page].start, filter: filter, login: login, query: query, library: library)
        try Task.checkCancellation()
        guard generation == ticket, XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
              accept(model, page: page) else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return .init(number: page, rows: model.rows)
    }
}

private struct XDriveUnifiedPageHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Each visible range owns at most 48 reconciled rows. SwiftUI may retain a
/// view's State after scrolling away, so explicitly release its model too.
@MainActor
struct XDriveIOSNativeUnifiedPhotoWallPage: View {
    let page: XDriveIOSNativeUnifiedPageIndex<XDriveIOSNativeGalleryCursor>.Page
    @ObservedObject var wall: XDriveIOSNativeUnifiedPhotoWall
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let owner: XDriveNativeOwnerRoot
    let filter: XDriveIOSNativeGalleryPresence?
    let query: XDriveIOSNativeUnifiedGalleryQuery
    let density: XDriveIOSNativePhotoWallDensity
    let displayActive: Bool
    let open: (XDriveIOSNativeUnifiedGalleryPage, Int) -> Void
    let loaded: () -> Void
    let pairing: (XDriveIOSNativeUnifiedPhoto) -> Void
    @StateObject private var model = XDriveIOSNativeUnifiedPhotoTimeline()
    @State private var visible = false
    @State private var retry = UUID()

    var body: some View {
        content
            .background(GeometryReader { geometry in
                Color.clear.preference(key: XDriveUnifiedPageHeight.self, value: geometry.size.height)
            })
            .onPreferenceChange(XDriveUnifiedPageHeight.self) { height in
                if model.completed { wall.measure(page: page.id, height: Double(height)) }
            }
            .onAppear { visible = true }
            .onDisappear { visible = false; model.reset() }
            .task(id: "\(visible):\(displayActive):\(retry)") {
                guard visible, displayActive, wall.failure == nil,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { model.reset(); return }
                let ticket = wall.generation
                await model.load(from: page.start, filter: filter, login: login, query: query, library: wall.library)
                guard !Task.isCancelled, visible, displayActive, wall.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { model.reset(); return }
                if wall.accept(model, page: page.id) { loaded() }
            }
    }

    @ViewBuilder private var content: some View {
        if model.completed && model.belongs(to: login.owner) {
            let groups = Dictionary(grouping: model.rows) { $0.capturedAt.map { Calendar.current.startOfDay(for: $0) } }
            let days = groups.keys.sorted { ($0 ?? .distantPast) > ($1 ?? .distantPast) }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(days, id: \.self) { day in
                    XDriveIOSNativePhotoWallDayHeader(title: day?.formatted(date: .abbreviated, time: .omitted) ?? "拍摄日期未知")
                    XDriveIOSNativePhotoWallGrid(density: density) {
                        ForEach(groups[day] ?? []) { row in
                            Button {
                                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                                      let position = model.rows.firstIndex(where: { $0.id == row.id }) else { return }
                                open(.init(number: page.id, rows: model.rows), position)
                            } label: {
                                XDriveIOSUnifiedPhotoTile(row: row, login: login, presentingOwner: owner,
                                                         displayActive: displayActive)
                            }
                            .buttonStyle(.plain).id(row.id)
                            .accessibilityLabel("\(row.isLive ? "实况照片" : row.isVideo ? "视频" : "照片")，\(row.presence.title)")
                            .contextMenu {
                                Button("来源与核对详情") { pairing(row) }
                            }
                        }
                    }
                }
                if model.rows.isEmpty {
                    Text(model.next == nil ? "已浏览到底，没有更多符合条件的照片" : "正在查找符合条件的照片…")
                        .font(.footnote).foregroundStyle(.secondary).frame(minHeight: 36)
                }
                if let message = model.notice { Text(message).font(.footnote).foregroundStyle(.secondary) }
            }
        } else {
            VStack(spacing: 8) {
                if let message = model.notice {
                    Text(message).font(.footnote)
                    Button("重新读取") { retry = UUID() }
                } else if visible && displayActive {
                    ProgressView("读取并核对照片…")
                }
            }
            .frame(maxWidth: .infinity, minHeight: page.height)
        }
    }
}
