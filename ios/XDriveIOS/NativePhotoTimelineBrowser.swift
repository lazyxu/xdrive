import Combine
import Foundation
import Photos
import SwiftUI

/// A secondary PhotoKit observer keeps the in-memory calendar invalid if a
/// user changes their Limited selection or edits the library while browsing.
private final class XDriveIOSNativePhotoTimelineChangeMonitor: NSObject,
    ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var revision = 0
    private var registered = false

    func start() {
        guard !registered else { return }
        PHPhotoLibrary.shared().register(self)
        registered = true
    }

    func stop() {
        guard registered else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        registered = false
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in self?.revision &+= 1 }
    }

    deinit { stop() }
}

private final class XDriveIOSNativePhotoTimelineReadObserver: NSObject,
    PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var revision: UInt64 = 0

    func current() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return revision
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock()
        revision &+= 1
        lock.unlock()
    }
}

private enum XDriveIOSNativePhotoTimelineError: Error {
    case permissionChanged
    case libraryChanged
}

/// One explicit, cancellable metadata-only pass over the full authorized
/// PhotoKit PHFetchResult. This reader is independent of the backup scanner
/// and never retains a PHAsset or its identifier in its returned index.
private actor XDriveIOSNativePhotoTimelineReader {
    func read() async throws -> XDriveIOSNativePhotoTimelineIndex {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            throw XDriveIOSNativePhotoTimelineError.permissionChanged
        }

        let observer = XDriveIOSNativePhotoTimelineReadObserver()
        PHPhotoLibrary.shared().register(observer)
        defer { PHPhotoLibrary.shared().unregisterChangeObserver(observer) }
        let revision = observer.current()
        let options = PHFetchOptions()
        // Match the existing 64-slot wall's exact ordering and offset basis.
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false),
            NSSortDescriptor(key: "localIdentifier", ascending: true)
        ]
        let snapshot = PHAsset.fetchAssets(with: options)
        try verify(status: status, observer: observer, revision: revision)
        var index = XDriveIOSNativePhotoTimelineBuilder(calendar: .current)
        for slot in 0..<snapshot.count {
            if slot % 256 == 0 {
                try verify(status: status, observer: observer, revision: revision)
                // Do not monopolize the executor on a large photo library.
                await Task.yield()
            }
            let asset = snapshot.object(at: slot)
            if asset.mediaType == .image || asset.mediaType == .video {
                index.append(capturedAt: asset.creationDate, slot: slot)
            }
        }
        try verify(status: status, observer: observer, revision: revision)
        return index.finish(totalSlots: snapshot.count)
    }

    private func verify(status: PHAuthorizationStatus,
                        observer: XDriveIOSNativePhotoTimelineReadObserver,
                        revision: UInt64) throws {
        try Task.checkCancellation()
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == status else {
            throw XDriveIOSNativePhotoTimelineError.permissionChanged
        }
        guard observer.current() == revision else {
            throw XDriveIOSNativePhotoTimelineError.libraryChanged
        }
    }
}

@MainActor
private final class XDriveIOSNativePhotoTimelineModel: ObservableObject {
    @Published private(set) var index: XDriveIOSNativePhotoTimelineIndex?
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func load() {
        guard !loading, index == nil else { return }
        generation = UUID()
        let token = generation
        errorMessage = nil
        loading = true
        job = Task { [weak self] in
            do {
                let result = try await XDriveIOSNativePhotoTimelineReader().read()
                try Task.checkCancellation()
                guard let self, self.generation == token else { return }
                self.index = result
            } catch is CancellationError {
            } catch {
                guard let self, self.generation == token else { return }
                self.errorMessage = "照片库或访问权限已变化，无法完成日期索引。请重新读取。"
            }
            if let self, self.generation == token {
                self.loading = false
                self.job = nil
            }
        }
    }

    func invalidate() {
        generation = UUID()
        job?.cancel()
        job = nil
        index = nil
        errorMessage = nil
        loading = false
    }
}

/// A date navigator around the existing native PhotoKit wall. It does not
/// manufacture a 100k-row photo array or replace Viewer/backup ownership.
/// The chosen date lands on the enclosing 64-slot wall page, which must read
/// and reauthorize its own fresh PHFetchResult before showing any pixels.
struct XDriveIOSNativeLocalPhotoTimelineContainer<Content: View>: View {
    @Binding var savedOffset: Int
    let content: Content

    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativePhotoTimelineModel()
    @StateObject private var changes = XDriveIOSNativePhotoTimelineChangeMonitor()
    @State private var showingDates = false
    @State private var scale: XDriveIOSNativePhotoTimelineScale = .year
    @State private var wallRevision: UInt64 = 0

    init(savedOffset: Binding<Int>, @ViewBuilder content: () -> Content) {
        self._savedOffset = savedOffset
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    showingDates = true
                    model.load()
                } label: {
                    Label("按年／月／日定位", systemImage: "calendar")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("native-ios-local-timeline-open")
                Spacer(minLength: 4)
                if let index = model.index {
                    Text("已索引 \(index.indexedMediaCount) 项")
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            content.id(wallRevision)
        }
        .sheet(isPresented: $showingDates) {
            NavigationStack {
                VStack(spacing: 0) {
                    Picker("时间层级", selection: $scale) {
                        ForEach(XDriveIOSNativePhotoTimelineScale.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(12)

                    if model.loading {
                        Spacer()
                        ProgressView("正在检查已授权图库的日期…")
                        Spacer()
                    } else if let errorMessage = model.errorMessage {
                        Spacer()
                        Text(errorMessage).foregroundStyle(.secondary)
                        Button("重新读取日期") { model.load() }
                            .buttonStyle(.borderedProminent)
                        Spacer()
                    } else if let index = model.index {
                        List {
                            Section {
                                Button("所有照片（返回第一页）") {
                                    jump(to: 0)
                                }
                                .accessibilityIdentifier("native-ios-local-timeline-all")
                            } footer: {
                                Text("仅索引当前授权的照片和视频（\(index.indexedMediaCount) 项）。点击日期将定位到所在的 64 项照片页；连续滚动时间轴仍需后续补齐。")
                            }
                            Section("\(scale.title) · \(index.groups(for: scale).count) 个日期分组") {
                                ForEach(index.groups(for: scale)) { group in
                                    Button {
                                        jump(to: group.firstPageOffset)
                                    } label: {
                                        HStack {
                                            Text(group.title)
                                            Spacer(minLength: 8)
                                            Text("\(group.mediaCount) 项")
                                                .foregroundStyle(.secondary)
                                                .monospacedDigit()
                                        }
                                        .contentShape(Rectangle())
                                    }
                                    .foregroundStyle(.primary)
                                    .accessibilityIdentifier("native-ios-local-timeline-\(group.id)")
                                }
                            }
                        }
                        .listStyle(.plain)
                    } else {
                        Spacer()
                        Button("读取已授权图库的日期") { model.load() }
                        Spacer()
                    }
                }
                .navigationTitle("按日期定位")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("完成") { showingDates = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .onAppear { changes.start() }
        .onDisappear {
            changes.stop()
            model.invalidate()
        }
        .onChange(of: changes.revision) { _ in model.invalidate() }
        .onChange(of: phase) { state in
            if state != .active {
                model.invalidate()
                showingDates = false
            }
        }
    }

    private func jump(to requestedOffset: Int) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited,
              model.index != nil else {
            model.invalidate()
            return
        }
        // The existing wall independently clamps/validates its page cursor.
        savedOffset = requestedOffset
        wallRevision &+= 1
        showingDates = false
    }
}
