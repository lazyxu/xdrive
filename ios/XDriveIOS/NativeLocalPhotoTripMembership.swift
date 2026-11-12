import Foundation
import Photos
import SwiftUI

/// A trip member is a REAL current PhotoKit asset whose capture day AND
/// WGS84 0.25-degree cell match the discovered day/cell pair. Date alone is
/// never authority for a curated journey, and no PHAsset identifiers, GPS
/// positions or originals are saved to persistent storage.
struct XDriveIOSNativeLocalTripDayCell: Hashable, Sendable {
    let day: Date
    let cell: Int
}

struct XDriveIOSNativeLocalTripScope: Identifiable, Equatable, Sendable {
    let id: UUID
    let title: String
    let captureRange: XDriveIOSNativePhotoMapCaptureRange
    // Exact PhotoKit generation of the discovery. A later edit/revoke must
    // never silently import new assets into this GPS trip's membership.
    let libraryEpoch: Data
    let cells: Set<XDriveIOSNativeLocalTripDayCell>
    let photoCount: Int

    var valid: Bool {
        captureRange.valid && !cells.isEmpty && photoCount >= 2 &&
        cells.count <= 100_000
    }

    static func coordinateCell(latitude: Double, longitude: Double) -> Int? {
        guard XDriveIOSNativePhotoMapPolicy.validCoordinate(
            latitude: latitude, longitude: longitude) else { return nil }
        let lat = min(719, max(0, Int(floor((latitude + 90) * 4))))
        let lon = min(1439, max(0, Int(floor((longitude + 180) * 4))))
        return lat * 1440 + lon
    }

    func contains(_ capturedAt: Date?, latitude: Double, longitude: Double,
                  calendar: Calendar = .current) -> Bool {
        guard valid, let capturedAt,
              let cell = Self.coordinateCell(latitude: latitude, longitude: longitude),
              captureRange.contains(capturedAt)
        else { return false }
        return cells.contains(.init(day: calendar.startOfDay(for: capturedAt),
                                    cell: cell))
    }
}

private struct XDriveIOSLocalRecentDay: Identifiable {
    let day: Date
    let count: Int
    var id: Date { day }
}

private struct XDriveIOSLocalTripDiscovery: Sendable {
    let days: [(Date, Int)]
    let trips: [XDriveIOSNativeLocalTripScope]
}

/// Read-only metadata discovery. All-photo PHFetchResult iteration stays off
/// the UI thread; it records only aggregate day/cell COUNTS, no user media IDs.
/// The 250k bound fails visibly instead of presenting an incomplete list.
private enum XDriveIOSNativeLocalTripDiscovery {
    static let maximumAssets = 250_000
    static let maximumTrips = 100
    static let maximumTripDays = 21

    static func scan() throws -> XDriveIOSLocalTripDiscovery {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
        else { throw XDrivePhotoKitScanFailure.notAuthorized }
        let beginning = try XDriveIOSPhotoKitLibraryEpoch.capture()
        let generation = beginning.serialized
        let calendar = Calendar.current
        let options = PHFetchOptions()
        options.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: false)
        ]
        let assets = PHAsset.fetchAssets(with: options)
        guard assets.count <= maximumAssets else {
            throw XDrivePhotoKitScanFailure.invalidOffset
        }
        var dayCellCounts: [XDriveIOSNativeLocalTripDayCell: Int] = [:]
        var daysPerCell: [Int: Set<Date>] = [:]
        var photoDays: [Date: Int] = [:]
        for index in 0..<assets.count {
            try Task.checkCancellation()
            if index % 64 == 0 {
                guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                      XDriveIOSNativePhotoFingerprintIndex.isCurrent(generation)
                else { throw XDrivePhotoKitScanFailure.snapshotChanged }
            }
            let asset = assets.object(at: index)
            guard asset.mediaType == .image || asset.mediaType == .video,
                  let captured = asset.creationDate,
                  let coordinate = asset.location?.coordinate,
                  let cell = XDriveIOSNativeLocalTripScope.coordinateCell(
                    latitude: coordinate.latitude, longitude: coordinate.longitude)
            else { continue }
            let day = calendar.startOfDay(for: captured)
            let key = XDriveIOSNativeLocalTripDayCell(day: day, cell: cell)
            dayCellCounts[key, default: 0] += 1
            photoDays[day, default: 0] += 1
            daysPerCell[cell, default: []].insert(day)
        }
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              XDriveIOSNativePhotoFingerprintIndex.isCurrent(generation)
        else { throw XDrivePhotoKitScanFailure.snapshotChanged }

        // The most repeatedly photographed calendar location is a stable
        // heuristic home, NOT a Photos/Apple-private travel classification.
        // Never include home-cell members in automatically inferred trips.
        let home = daysPerCell.max {
            $0.value.count == $1.value.count
                ? $0.key > $1.key
                : $0.value.count < $1.value.count
        }?.key

        var away: [Date: [XDriveIOSNativeLocalTripDayCell]] = [:]
        for (key, count) in dayCellCounts where count > 0 {
            if let home {
                let a = key.cell / 1440, b = key.cell % 1440
                let ha = home / 1440, hb = home % 1440
                let dl = min(abs(b - hb), 1440 - abs(b - hb))
                if abs(a - ha) <= 1 && dl <= 1 { continue }
            }
            away[key.day, default: []].append(key)
        }

        var trips: [XDriveIOSNativeLocalTripScope] = []
        var segment: [Date] = []

        func finishSegment() {
            defer { segment = [] }
            guard !segment.isEmpty else { return }
            let members = Set(segment.flatMap { away[$0] ?? [] })
            let count = members.reduce(0) { $0 + (dayCellCounts[$1] ?? 0) }
            guard count >= 2,
                  members.count <= 100_000,
                  let first = segment.first,
                  let last = segment.last,
                  let end = calendar.date(byAdding: .day, value: 1, to: last)
            else { return }
            let label = segment.count == 1
                ? "旅行候选 · \(first.formatted(date: .abbreviated, time: .omitted))"
                : "旅行候选 · \(first.formatted(date: .abbreviated, time: .omitted)) 至 \(last.formatted(date: .abbreviated, time: .omitted))"
            let scope = XDriveIOSNativePhotoMapCaptureRange(
                from: first, to: end, label: label)
            let trip = XDriveIOSNativeLocalTripScope(
                id: UUID(), title: label, captureRange: scope,
                libraryEpoch: generation, cells: members, photoCount: count)
            if trip.valid { trips.append(trip) }
        }

        for day in away.keys.sorted() {
            let count = (away[day] ?? []).reduce(0) {
                $0 + (dayCellCounts[$1] ?? 0)
            }
            // At least two away GPS photos distinguish a possible trip from
            // a single incidental/commute snapshot. Across the same day,
            // all verified away cells remain members (multi-city preserved).
            if count < 2 { finishSegment(); continue }
            if let last = segment.last {
                let gap = calendar.dateComponents([.day], from: last, to: day).day ?? 999
                if gap > 1 || segment.count >= maximumTripDays {
                    finishSegment()
                }
            }
            segment.append(day)
        }
        finishSegment()
        let recentStart = calendar.date(
            byAdding: .day, value: -89, to: calendar.startOfDay(for: Date())
        ) ?? .distantPast
        let recent = photoDays.filter { $0.key >= recentStart }
            .sorted { $0.key > $1.key }
            .prefix(90)
            .map { ($0.key, $0.value) }

        return .init(
            days: recent,
            trips: Array(trips.reversed().prefix(maximumTrips))
        )
    }
}

/// Apple Photos does not publish the private "Trips" collection membership
/// API. Here "旅行候选" is deliberately labelled as a local GPS heuristic;
/// once selected, each asset is admitted with the exact day+cell predicate.
struct XDriveIOSNativeLocalRecentDaysAndTrips: View {
    let chooseDay: (Date) -> Void
    let chooseTrip: (XDriveIOSNativeLocalTripScope) -> Void

    @Environment(\.scenePhase) private var phase
    @Environment(\.dismiss) private var dismiss
    @State private var request = UUID()
    @State private var busy = false
    @State private var error: String?
    @State private var days: [XDriveIOSLocalRecentDay] = []
    @State private var trips: [XDriveIOSNativeLocalTripScope] = []

    var body: some View {
        NavigationStack {
            List {
                if busy { ProgressView("正在核对 PhotoKit 日期与地点…") }
                if let error {
                    XDriveIOSNativePhotoWallRetryMessage(
                        message: error, buttonTitle: "重新核对",
                        canRetry: !busy && phase == .active
                    ) { reload() }
                }
                Section("最近的日子 · 精确日期照片") {
                    if days.isEmpty && !busy {
                        Text("最近 90 天没有已授权的定位照片。")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(days) { entry in
                        Button {
                            chooseDay(entry.day)
                            dismiss()
                        } label: {
                            HStack {
                                Text(entry.day.formatted(date: .abbreviated, time: .omitted))
                                Spacer()
                                Text("\(entry.count) 张").foregroundStyle(.secondary)
                            }
                        }
                        .disabled(busy || phase != .active)
                    }
                }
                Section("旅行候选 · GPS 精确成员") {
                    Text("根据实际 GPS 日历分组生成旅行候选，不是 Apple 的私有精选集。选择后仅显示匹配的日期和位置照片。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if trips.isEmpty && !busy {
                        Text("尚无符合条件的旅行候选。")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(trips) { trip in
                        Button {
                            chooseTrip(trip)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading) {
                                Text(trip.title)
                                Text("\(trip.photoCount) 张照片 · \(trip.cells.count) 个日期地点单元")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .disabled(busy || phase != .active)
                    }
                }
            }
            .navigationTitle("最近的日子与旅行")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .onAppear { if days.isEmpty && !busy { reload() } }
        .onChange(of: phase) { state in
            if state != .active { invalidate() }
        }
        .onDisappear { invalidate() }
    }

    private func invalidate() {
        request = UUID()
        busy = false
        days = []
        trips = []
    }

    private func reload() {
        invalidate()
        guard phase == .active else { return }
        let ticket = request
        busy = true
        Task { @MainActor in
            let worker = Task.detached(priority: .userInitiated) {
                try XDriveIOSNativeLocalTripDiscovery.scan()
            }
            do {
                let result = try await withTaskCancellationHandler {
                    try await worker.value
                } onCancel: {
                    worker.cancel()
                }
                guard request == ticket, phase == .active else { return }
                days = result.days.map { .init(day: $0.0, count: $0.1) }
                trips = result.trips
                busy = false
            } catch is CancellationError {
                if request == ticket { busy = false }
            } catch {
                guard request == ticket else { return }
                self.error = "本机照片或位置成员已变化，请重新核对。"
                busy = false
            }
        }
    }
}
