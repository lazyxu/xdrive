import Foundation
import Photos
import SwiftUI
import UIKit

// Native, read-only calendar scopes over the ENTIRE currently authorized
// PhotoKit fetch result, not over a 64-item wall's in-memory candidates.
// This is a bounded date navigator; it does not claim the full animated
// year/month/day presentation of Apple's Photos application.
enum XDriveIOSNativeTimelineScale: String, CaseIterable, Identifiable {
    case year, month, day, all

    var id: String { rawValue }
    var label: String {
        switch self {
        case .year: return "年"
        case .month: return "月"
        case .day: return "日"
        case .all: return "全部"
        }
    }
    var calendarComponent: Calendar.Component? {
        switch self {
        case .year: return .year
        case .month: return .month
        case .day: return .day
        case .all: return nil
        }
    }
    func interval(containing date: Date, calendar: Calendar) -> DateInterval? {
        guard let component = calendarComponent else { return nil }
        return calendar.dateInterval(of: component, for: date)
    }
}

enum XDriveIOSNativeTimelinePolicy {
    static let pageSize = 64

    static func boundedOffset(_ requested: Int, total: Int) -> Int {
        guard total > 0 else { return 0 }
        return min(max(0, requested / pageSize * pageSize),
                   ((total - 1) / pageSize) * pageSize)
    }
}

struct XDriveIOSNativeTimelineSection: Identifiable {
    let id: Int
    let title: String
    let items: [XDrivePhotoKitScanCandidate]
}

struct XDriveIOSNativeTimelinePage {
    let sections: [XDriveIOSNativeTimelineSection]
    let total: Int
    let offset: Int
    let nextOffset: Int
    var hasPrevious: Bool { offset > 0 }
    var hasNext: Bool { nextOffset < total }
    var loadedItems: [XDrivePhotoKitScanCandidate] {
        sections.flatMap(\.items)
    }
}

enum XDriveIOSNativeTimelineFailure: Error {
    case unauthorized, changed, invalidDate
}

// Change callbacks may arrive off-main. Keep only a generation counter;
// never cache or serialize a persistent PhotoKit identifier here.
private final class XDriveIOSNativeTimelineChangeObserver: NSObject,
    PHPhotoLibraryChangeObserver {
    private let lock = NSLock()
    private var value: UInt64 = 0

    func generation() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
    func photoLibraryDidChange(_ change: PHChange) {
        lock.lock()
        value &+= 1
        lock.unlock()
    }
}

actor XDriveIOSNativeTimelineReader {
    private let changes = XDriveIOSNativeTimelineChangeObserver()

    // Each operation retains PHFetchResult only while building <=64 rows.
    // PhotoKit applies Full/Limited access to both full-library and date
    // predicates. No scanning of the skipped items, original download, GPS,
    // backup session or photo-writing side effect takes place.
    func read(scale: XDriveIOSNativeTimelineScale, date: Date,
              offset requested: Int) throws -> XDriveIOSNativeTimelinePage {
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited else {
            throw XDriveIOSNativeTimelineFailure.unauthorized
        }
        PHPhotoLibrary.shared().register(changes)
        defer { PHPhotoLibrary.shared().unregisterChangeObserver(changes) }
        let generation = changes.generation()
        let options = PHFetchOptions()
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false),
            NSSortDescriptor(key: "localIdentifier", ascending: true)
        ]
        let calendar = Calendar.autoupdatingCurrent
        if scale != .all {
            guard let interval = scale.interval(containing: date, calendar: calendar)
            else { throw XDriveIOSNativeTimelineFailure.invalidDate }
            options.predicate = NSPredicate(
                format: "creationDate >= %@ AND creationDate < %@",
                interval.start as NSDate, interval.end as NSDate
            )
        }
        let snapshot = PHAsset.fetchAssets(with: options)
        let offset = XDriveIOSNativeTimelinePolicy.boundedOffset(
            requested, total: snapshot.count
        )
        let end = min(snapshot.count, offset + XDriveIOSNativeTimelinePolicy.pageSize)
        var sections: [XDriveIOSNativeTimelineSection] = []
        var groupTitle: String?
        var groupKey: Date?
        var groupItems: [XDrivePhotoKitScanCandidate] = []
        var groupStart = offset

        func appendGroup() {
            guard let title = groupTitle, !groupItems.isEmpty else { return }
            sections.append(XDriveIOSNativeTimelineSection(
                id: groupStart, title: title, items: groupItems
            ))
        }

        for index in offset..<end {
            try Task.checkCancellation()
            let asset = snapshot.object(at: index)
            let kind: String
            switch asset.mediaType {
            case .image: kind = "image"
            case .video: kind = "video"
            default: continue
            }
            let key = asset.creationDate.map { calendar.startOfDay(for: $0) }
            let title = asset.creationDate.map {
                $0.formatted(date: .complete, time: .omitted)
            } ?? "拍摄日期未知"
            if groupTitle == nil || key != groupKey {
                appendGroup()
                groupKey = key
                groupTitle = title
                groupItems = []
                groupStart = index
            }
            groupItems.append(XDrivePhotoKitScanCandidate(
                id: asset.localIdentifier,
                kind: kind,
                isLive: kind == "image" && asset.mediaSubtypes.contains(.photoLive),
                capturedAt: asset.creationDate,
                modifiedAt: asset.modificationDate
            ))
        }
        appendGroup()
        try Task.checkCancellation()
        guard changes.generation() == generation,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
        else { throw XDriveIOSNativeTimelineFailure.changed }
        return XDriveIOSNativeTimelinePage(
            sections: sections, total: snapshot.count,
            offset: offset, nextOffset: end
        )
    }

    // Jump to the nearest earlier/later populated calendar scope, not one
    // empty day/month at a time. A lazy PhotoKit query returns at most 1 row.
    func adjacentDate(scale: XDriveIOSNativeTimelineScale,
                      date: Date, direction: Int) throws -> Date? {
        guard direction == -1 || direction == 1,
              let interval = scale.interval(
                containing: date, calendar: Calendar.autoupdatingCurrent
              )
        else { throw XDriveIOSNativeTimelineFailure.invalidDate }
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited
        else { throw XDriveIOSNativeTimelineFailure.unauthorized }
        PHPhotoLibrary.shared().register(changes)
        defer { PHPhotoLibrary.shared().unregisterChangeObserver(changes) }
        let generation = changes.generation()
        let opts = PHFetchOptions()
        opts.fetchLimit = 1
        opts.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: direction == 1),
            NSSortDescriptor(key: "localIdentifier", ascending: true)
        ]
        if direction < 0 {
            opts.predicate = NSPredicate(
                format: "creationDate < %@", interval.start as NSDate
            )
        } else {
            opts.predicate = NSPredicate(
                format: "creationDate >= %@", interval.end as NSDate
            )
        }
        let nearby = PHAsset.fetchAssets(with: opts).firstObject?.creationDate
        try Task.checkCancellation()
        guard changes.generation() == generation,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
        else { throw XDriveIOSNativeTimelineFailure.changed }
        return nearby
    }
}

private final class XDriveIOSNativeTimelineLibraryMonitor: NSObject,
    ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var revision = 0
    private var observing = false

    func start() {
        guard !observing else { return }
        PHPhotoLibrary.shared().register(self)
        observing = true
    }
    func stop() {
        guard observing else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
        observing = false
    }
    func photoLibraryDidChange(_ change: PHChange) {
        DispatchQueue.main.async { [weak self] in self?.revision &+= 1 }
    }
    deinit { stop() }
}

struct XDriveIOSNativeLocalPhotoTimelineScreen: View {
    @Environment(\.scenePhase) private var phase
    @StateObject private var changes = XDriveIOSNativeTimelineLibraryMonitor()
    @State private var scale: XDriveIOSNativeTimelineScale = .all
    @State private var anchorDate = Date()
    @State private var initialDateResolved = false
    @State private var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var page: XDriveIOSNativeTimelinePage?
    @State private var displayOffset = 0
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var epoch = UUID()
    @State private var job: Task<Void, Never>?
    @State private var selected: XDrivePhotoKitScanCandidate?
    @State private var frozenViewerItems: [XDrivePhotoKitScanCandidate] = []
    @State private var viewerReturnID: String?
    @State private var pageRevision = 0
    private let reader = XDriveIOSNativeTimelineReader()

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    Picker("时间范围", selection: $scale) {
                        ForEach(XDriveIOSNativeTimelineScale.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("native-ios-photos-timeline-scale")

                    if scale != .all {
                        HStack(spacing: 12) {
                            DatePicker("选择日期", selection: $anchorDate,
                                       displayedComponents: .date)
                                .datePickerStyle(.compact)
                                .accessibilityIdentifier("native-ios-photos-timeline-jump")
                            Spacer(minLength: 0)
                            Button {
                                jump(direction: -1)
                            } label: {
                                Image(systemName: "chevron.left")
                            }
                            .accessibilityLabel("上一个有照片的时间段")
                            .disabled(busy)
                            Button {
                                jump(direction: 1)
                            } label: {
                                Image(systemName: "chevron.right")
                            }
                            .accessibilityLabel("下一个有照片的时间段")
                            .disabled(busy)
                        }
                        Text(scale == .year ? "当前年份的全部授权照片" :
                             scale == .month ? "当前月份的全部授权照片" :
                             "当前日期的全部授权照片")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if permission == .notDetermined {
                        Button("允许查看本机相册") {
                            Task {
                                _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
                                reload(at: 0)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    } else if permission == .denied || permission == .restricted {
                        Label("相册权限不可用，请在 iOS 设置中允许访问。",
                              systemImage: "lock")
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            Link("打开 iOS 设置", destination: url)
                        }
                    } else if let page {
                        if permission == .limited {
                            Text("仅包含 iOS 当前授权的部分照片和视频")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Text(page.total == 0 ? "当前时间范围没有可访问的照片。" :
                             "当前范围 \((page.offset + 1))–\(page.nextOffset) / \(page.total)")
                            .font(.caption).monospacedDigit()
                            .foregroundStyle(.secondary)
                        ForEach(page.sections) { section in
                            Text(section.title).font(.headline)
                                .padding(.top, 4)
                            LazyVGrid(columns: [
                                GridItem(.adaptive(minimum: 92, maximum: 150), spacing: 3)
                            ], spacing: 3) {
                                ForEach(section.items) { candidate in
                                    Button {
                                        frozenViewerItems = page.loadedItems
                                        viewerReturnID = candidate.id
                                        selected = candidate
                                    } label: {
                                        XDriveIOSLocalPhotoTile(candidate: candidate)
                                    }
                                    .buttonStyle(.plain)
                                    .id(candidate.id)
                                    .accessibilityIdentifier("native-ios-photos-timeline-tile")
                                }
                            }
                        }
                        HStack {
                            Button("上一页") {
                                reload(at: max(0, page.offset -
                                                  XDriveIOSNativeTimelinePolicy.pageSize))
                            }
                            .disabled(busy || !page.hasPrevious)
                            Spacer()
                            Button("下一页") { reload(at: page.nextOffset) }
                                .disabled(busy || !page.hasNext)
                        }
                        .buttonStyle(.bordered)
                    }
                    if busy { ProgressView("读取本机照片时间轴…") }
                    if let notice {
                        Text(notice).font(.caption).foregroundStyle(.secondary)
                    }
                    if let error {
                        Text(error).foregroundStyle(.red)
                        Button("重试当前时间范围") { reload(at: displayOffset) }
                    }
                }
                .padding(12)
            }
            .onChange(of: pageRevision) { _ in
                guard let id = viewerReturnID,
                      page?.loadedItems.contains(where: { $0.id == id }) == true
                else {
                    viewerReturnID = nil
                    return
                }
                scroll.scrollTo(id, anchor: .center)
                viewerReturnID = nil
            }
        }
        .navigationTitle("照片时间轴")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("刷新") { reload(at: displayOffset) }
                    .disabled(busy)
            }
        }
        .fullScreenCover(item: $selected, onDismiss: {
            frozenViewerItems = []
            reload(at: displayOffset)
        }) { first in
            XDriveIOSNativeLocalPhotoDetail(
                candidate: first,
                loadedItems: frozenViewerItems,
                onViewed: { next in
                    guard phase == .active,
                          selected?.id == first.id,
                          frozenViewerItems.contains(where: {
                              $0.id == next.id && $0.kind == next.kind &&
                              $0.isLive == next.isLive &&
                              $0.capturedAt == next.capturedAt &&
                              $0.modifiedAt == next.modifiedAt
                          })
                    else { return }
                    viewerReturnID = next.id
                }
            )
        }
        .onAppear {
            changes.start()
            if selected == nil && page == nil { reload(at: displayOffset) }
        }
        .onChange(of: scale) { _ in
            displayOffset = 0
            if selected == nil { reload(at: 0) }
        }
        .onChange(of: anchorDate) { _ in
            if scale != .all && selected == nil {
                displayOffset = 0
                reload(at: 0)
            }
        }
        .onChange(of: changes.revision) { _ in
            stopReading()
            page = nil
            error = "系统照片发生变化，请刷新当前时间范围。"
        }
        .onChange(of: phase) { state in
            permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            if state != .active {
                stopReading()
                page = nil
            } else if selected == nil {
                reload(at: displayOffset)
            }
        }
        .onDisappear {
            stopReading()
            page = nil
            changes.stop()
        }
    }

    private func stopReading() {
        epoch = UUID()
        job?.cancel()
        job = nil
        busy = false
    }

    private func reload(at offset: Int) {
        stopReading()
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        page = nil
        error = nil
        notice = nil
        guard phase == .active,
              permission == .authorized || permission == .limited
        else { return }
        let token = epoch
        let requestedScale = scale
        let requestedDate = anchorDate
        busy = true
        job = Task { @MainActor in
            do {
                let result = try await reader.read(
                    scale: requestedScale, date: requestedDate, offset: offset
                )
                try Task.checkCancellation()
                guard epoch == token, phase == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
                else { return }
                page = result
                displayOffset = result.offset
                if !initialDateResolved && requestedScale == .all,
                   let newest = result.loadedItems.first?.capturedAt {
                    initialDateResolved = true
                    anchorDate = newest
                }
                pageRevision &+= 1
            } catch is CancellationError {
            } catch {
                guard epoch == token else { return }
                self.error = "时间范围或相册授权已变化，请重新读取。"
            }
            if epoch == token {
                busy = false
                job = nil
            }
        }
    }

    private func jump(direction: Int) {
        guard !busy, scale != .all,
              (direction == -1 || direction == 1),
              phase == .active else { return }
        stopReading()
        let token = epoch
        let selectedScale = scale
        let date = anchorDate
        notice = nil
        busy = true
        job = Task { @MainActor in
            do {
                let nearby = try await reader.adjacentDate(
                    scale: selectedScale, date: date, direction: direction
                )
                try Task.checkCancellation()
                guard epoch == token, phase == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
                else { return }
                if let nearby {
                    anchorDate = nearby
                } else {
                    notice = direction < 0 ?
                        "已经没有更早的已授权照片。" : "已经没有更晚的已授权照片。"
                }
            } catch is CancellationError {
            } catch {
                if epoch == token {
                    notice = "照片库发生变化，请刷新后重试。"
                }
            }
            if epoch == token {
                busy = false
                job = nil
            }
        }
    }
}
