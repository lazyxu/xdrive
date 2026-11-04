import Combine
import Foundation
import Photos
import SwiftUI
import UIKit

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
    func read(mediaFilter: XDriveIOSNativePhotoMediaFilter) async throws
        -> XDriveIOSNativePhotoTimelineIndex {
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
            NSSortDescriptor(key: "modificationDate", ascending: false)
        ]
        if mediaFilter.requiresFavorite {
            options.predicate = NSPredicate(format: "favorite == YES")
        } else if mediaFilter.requiresLive {
            options.predicate = NSPredicate(
                format: "(mediaSubtypes & %d) != 0",
                PHAssetMediaSubtype.photoLive.rawValue
            )
        } else if mediaFilter.requiresScreenshot {
            options.predicate = NSPredicate(
                format: "(mediaSubtypes & %d) != 0",
                PHAssetMediaSubtype.photoScreenshot.rawValue
            )
        }
        let snapshot: PHFetchResult<PHAsset>
        switch mediaFilter {
        case .all:
            snapshot = PHAsset.fetchAssets(with: options)
        case .photos:
            snapshot = PHAsset.fetchAssets(with: .image, options: options)
        case .videos:
            snapshot = PHAsset.fetchAssets(with: .video, options: options)
        case .favorites:
            snapshot = PHAsset.fetchAssets(with: options)
        case .livePhotos, .screenshots:
            snapshot = PHAsset.fetchAssets(with: .image, options: options)
        }
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
                let kind = asset.mediaType == .image ? "image" : "video"
                guard mediaFilter.includes(kind: kind),
                      !mediaFilter.requiresFavorite || asset.isFavorite,
                      !mediaFilter.requiresLive ||
                        asset.mediaSubtypes.contains(.photoLive),
                      !mediaFilter.requiresScreenshot ||
                        asset.mediaSubtypes.contains(.photoScreenshot) else {
                    throw XDriveIOSNativePhotoTimelineError.libraryChanged
                }
                index.append(capturedAt: asset.creationDate, slot: slot)
            } else if mediaFilter != .all {
                throw XDriveIOSNativePhotoTimelineError.libraryChanged
            }
        }
        try verify(status: status, observer: observer, revision: revision)
        let result = index.finish(totalSlots: snapshot.count)
        guard mediaFilter == .all || result.indexedMediaCount == result.totalSlots else {
            throw XDriveIOSNativePhotoTimelineError.libraryChanged
        }
        return result
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
    @Published private(set) var indexFilter: XDriveIOSNativePhotoMediaFilter?
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func load(mediaFilter: XDriveIOSNativePhotoMediaFilter) {
        guard !loading else { return }
        if indexFilter != mediaFilter { invalidate() }
        guard index == nil else { return }
        generation = UUID()
        let token = generation
        errorMessage = nil
        loading = true
        job = Task { [weak self] in
            do {
                let result = try await XDriveIOSNativePhotoTimelineReader()
                    .read(mediaFilter: mediaFilter)
                try Task.checkCancellation()
                guard let self, self.generation == token else { return }
                self.indexFilter = mediaFilter
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
        indexFilter = nil
        errorMessage = nil
        loading = false
    }
}

/// A date navigator around the continuous native PhotoKit wall. No user-visible
/// pagination or 100k-row photo array; internal 64-slot viewport reads remain.
/// The chosen date lands on the enclosing metadata range, which must read
/// and reauthorize its own fresh PHFetchResult before showing any pixels.

/**
 * A visible calendar group requests exactly one PhotoKit thumbnail candidate.
 * The index stores only numeric offsets: it never holds PHAsset IDs or pixels.
 * This fetch goes through the same filtered, permission-fenced 64-slot scanner
 * as the local continuous wall, and releases the scanner after each read.
 */
private struct XDriveIOSNativeTimelineCoverTile: View {
    let group: XDriveIOSNativePhotoTimelineGroup
    let totalSlots: Int
    let mediaFilter: XDriveIOSNativePhotoMediaFilter
    let showsTextOverlay: Bool

    init(group: XDriveIOSNativePhotoTimelineGroup, totalSlots: Int,
         mediaFilter: XDriveIOSNativePhotoMediaFilter,
         showsTextOverlay: Bool = true) {
        self.group = group
        self.totalSlots = totalSlots
        self.mediaFilter = mediaFilter
        self.showsTextOverlay = showsTextOverlay
    }

    @State private var representative: XDrivePhotoKitScanCandidate?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let representative {
                    XDriveIOSNativeSquarePhotoTile(candidate: representative)
                } else {
                    Rectangle()
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay {
                            Image(systemName: "photo.on.rectangle")
                                .font(.title)
                                .foregroundStyle(.secondary)
                        }
                        .aspectRatio(1, contentMode: .fit)
                }
            }
            if showsTextOverlay {
                LinearGradient(
                    colors: [.clear, .black.opacity(0.72)],
                    startPoint: .center, endPoint: .bottom
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(group.title)
                        .font(.headline)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Text("\(group.mediaCount) 项")
                        .font(.caption)
                        .monospacedDigit()
                }
                .foregroundStyle(.white)
                .padding(10)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(group.title)，\(group.mediaCount) 项")
        .task(id: "\(group.id)-\(totalSlots)-\(mediaFilter.rawValue)") {
            await readRepresentative()
        }
        .onDisappear { representative = nil }
    }

    private func matchesGroup(_ candidate: XDrivePhotoKitScanCandidate) -> Bool {
        guard let date = candidate.capturedAt else { return group.key == "unknown" }
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        let expected: String
        switch group.scale {
        case .year:
            expected = parts.year.map(String.init) ?? "unknown"
        case .month:
            if let year = parts.year, let month = parts.month {
                expected = "\(year)-\(month)"
            } else { expected = "unknown" }
        case .day:
            if let year = parts.year, let month = parts.month, let day = parts.day {
                expected = "\(year)-\(month)-\(day)"
            } else { expected = "unknown" }
        }
        return expected == group.key
    }

    private func readRepresentative() async {
        representative = nil
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited,
              totalSlots > 0, group.firstSlot >= 0,
              group.firstSlot < totalSlots else { return }

        let reader = XDriveIOSNativeGalleryMediaScanner()
        let batch: XDrivePhotoKitScanPage
        let count: Int
        do {
            count = try await reader.start(
                atOffset: group.firstPageOffset, mediaFilter: mediaFilter
            )
            batch = try await reader.nextPage()
            try Task.checkCancellation()
        } catch {
            await reader.reset()
            return
        }
        await reader.reset()
        let position = group.firstSlot - group.firstPageOffset
        guard !Task.isCancelled,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission,
              count == totalSlots, batch.totalAccessibleAssets == totalSlots,
              batch.startOffset == group.firstPageOffset,
              position >= 0, position < batch.items.count else { return }

        let candidate = batch.items[position]
        guard mediaFilter.includes(kind: candidate.kind),
              matchesGroup(candidate) else { return }
        representative = candidate
    }
}

struct XDriveIOSNativeLocalPhotoTimelineContainer: View {
    @Binding var savedOffset: Int

    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativePhotoTimelineModel()
    @StateObject private var changes = XDriveIOSNativePhotoTimelineChangeMonitor()
    @State private var showingDates = false
    @State private var scale: XDriveIOSNativePhotoTimelineScale = .year
    @State private var selectedYearKey: String?
    @State private var selectedMonthKey: String?
    @State private var wallRevision: UInt64 = 0
    @State private var mediaFilter: XDriveIOSNativePhotoMediaFilter = .all

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    showingDates = true
                    model.load(mediaFilter: mediaFilter)
                } label: {
                    Label("按年／月／日定位", systemImage: "calendar")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("native-ios-local-timeline-open")
                Spacer(minLength: 4)
                if let index = model.index, model.indexFilter == mediaFilter {
                    Text("已索引 \(index.indexedMediaCount) 项")
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            XDriveIOSNativeLocalContinuousGalleryScreen(
                savedOffset: $savedOffset, mediaFilter: $mediaFilter
            )
            .id(wallRevision)
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
                    if scale == .month, selectedYearKey != nil {
                        Button("所有年份") {
                            selectedYearKey = nil
                            selectedMonthKey = nil
                            scale = .year
                        }
                        .accessibilityIdentifier("native-ios-local-timeline-back-years")
                    } else if scale == .day, selectedMonthKey != nil {
                        Button("返回月份") {
                            selectedMonthKey = nil
                            scale = .month
                        }
                        .accessibilityIdentifier("native-ios-local-timeline-back-months")
                    }

                    if model.loading {
                        Spacer()
                        ProgressView("正在检查已授权图库的日期…")
                        Spacer()
                    } else if let errorMessage = model.errorMessage {
                        Spacer()
                        Text(errorMessage).foregroundStyle(.secondary)
                        Button("重新读取日期") { model.load(mediaFilter: mediaFilter) }
                            .buttonStyle(.borderedProminent)
                        Spacer()
                    } else if let index = model.index,
                              model.indexFilter == mediaFilter {
                        List {
                            Section {
                                Button(mediaFilter == .videos ? "所有视频（查看全部）" :
                                       mediaFilter == .photos ? "所有照片（查看全部）" :
                                       mediaFilter == .favorites ? "所有收藏（查看全部）" :
                                       mediaFilter == .livePhotos ? "所有实况（查看全部）" :
                                       mediaFilter == .screenshots ? "所有截屏（查看全部）" :
                                       "所有媒体（查看全部）") {
                                    jump(to: 0)
                                }
                                .accessibilityIdentifier("native-ios-local-timeline-all")
                            } footer: {
                                Text("仅索引当前授权的\(mediaFilter.title)（\(index.indexedMediaCount) 项）。日期定位使用当前媒体筛选的完整 PhotoKit 游标。")
                            }
                            Section("\(scale.title) · \(visibleGroupCount(index)) 个日期分组") {
                                if scale == .day {
                                    ForEach(index.groups(for: scale)) { group in
                                        if shows(group) {
                                            Button {
                                                jump(to: group.firstPageOffset)
                                            } label: {
                                                HStack(spacing: 12) {
                                                    XDriveIOSNativeTimelineCoverTile(
                                                        group: group,
                                                        totalSlots: index.totalSlots,
                                                        mediaFilter: mediaFilter,
                                                        showsTextOverlay: false
                                                    )
                                                    .frame(width: 76, height: 76)
                                                    VStack(alignment: .leading, spacing: 5) {
                                                        Text(group.title)
                                                            .font(.subheadline.weight(.semibold))
                                                        Text("\(group.mediaCount) 项")
                                                            .font(.caption)
                                                            .foregroundStyle(.secondary)
                                                            .monospacedDigit()
                                                    }
                                                    Spacer(minLength: 0)
                                                    Image(systemName: "chevron.right")
                                                        .font(.caption.weight(.semibold))
                                                        .foregroundStyle(.tertiary)
                                                }
                                                .padding(.vertical, 3)
                                                .contentShape(Rectangle())
                                            }
                                            .foregroundStyle(.primary)
                                            .accessibilityIdentifier("native-ios-local-timeline-\(group.id)")
                                        }
                                    }
                                } else {
                                    LazyVGrid(columns: [
                                        GridItem(.adaptive(minimum: 138, maximum: 230), spacing: 10)
                                    ], spacing: 10) {
                                        ForEach(index.groups(for: scale)) { group in
                                            if shows(group) {
                                                Button {
                                                    openCalendarGroup(group)
                                                } label: {
                                                    XDriveIOSNativeTimelineCoverTile(
                                                        group: group,
                                                        totalSlots: index.totalSlots,
                                                        mediaFilter: mediaFilter
                                                    )
                                                }
                                                .buttonStyle(.plain)
                                                .accessibilityIdentifier("native-ios-local-timeline-\(group.id)")
                                            }
                                        }
                                    }
                                    .listRowInsets(EdgeInsets(
                                        top: 10, leading: 12, bottom: 10, trailing: 12
                                    ))
                                }
                            }
                        }
                        .listStyle(.plain)
                    } else {
                        Spacer()
                        Button("读取已授权图库的日期") { model.load(mediaFilter: mediaFilter) }
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
        .onChange(of: mediaFilter) { _ in
            model.invalidate()
            showingDates = false
        }
        .onChange(of: showingDates) { visible in
            if visible {
                selectedYearKey = nil
                selectedMonthKey = nil
                scale = .year
            }
        }
        .onChange(of: scale) { value in
            if value == .year {
                selectedYearKey = nil
                selectedMonthKey = nil
            } else if value == .month {
                selectedMonthKey = nil
            }
        }
        .onChange(of: phase) { state in
            if state != .active {
                model.invalidate()
                showingDates = false
            }
        }
    }

    private func shows(_ group: XDriveIOSNativePhotoTimelineGroup) -> Bool {
        if group.scale == .month, let year = selectedYearKey {
            return group.key.hasPrefix(year + "-")
        }
        if group.scale == .day, let month = selectedMonthKey {
            return group.key.hasPrefix(month + "-")
        }
        return true
    }

    private func visibleGroupCount(_ index: XDriveIOSNativePhotoTimelineIndex) -> Int {
        index.groups(for: scale).filter { shows($0) }.count
    }

    private func openCalendarGroup(_ group: XDriveIOSNativePhotoTimelineGroup) {
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited,
              model.index != nil, model.indexFilter == mediaFilter else { return }
        switch group.scale {
        case .year where group.key != "unknown":
            selectedYearKey = group.key
            selectedMonthKey = nil
            scale = .month
        case .month where group.key != "unknown":
            selectedYearKey = group.key.split(separator: "-").first.map(String.init)
            selectedMonthKey = group.key
            scale = .day
        default:
            jump(to: group.firstPageOffset)
        }
    }

    private func jump(to requestedOffset: Int) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited,
              let index = model.index, model.indexFilter == mediaFilter,
              requestedOffset >= 0,
              requestedOffset <= max(0, ((max(1, index.totalSlots) - 1) / 64) * 64),
              requestedOffset % 64 == 0 else {
            model.invalidate()
            return
        }
        // The continuous wall independently clamps and validates its scroll anchor.
        savedOffset = requestedOffset
        wallRevision &+= 1
        showingDates = false
    }
}
