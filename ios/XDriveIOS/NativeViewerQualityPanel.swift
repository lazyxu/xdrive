import Foundation
import MapKit
import SwiftUI
import UIKit

/// Metadata that the presenting source can actually prove for the selected
/// media. Missing cloud metadata stays missing; the Viewer never guesses EXIF.
struct XDriveIOSNativeViewerMediaDetails {
    let fileName: String
    let mediaKind: String
    let capturedAt: Date?
    let originalBytes: Int64?
    let format: String?
    let source: String?
    let pixelWidth: Int?
    let pixelHeight: Int?
    let duration: TimeInterval?
    let location: CLLocationCoordinate2D?
    let locationStatus: String?
    let resources: [XDriveIOSNativeViewerResourceDetail]
    let liveFiles: XDriveIOSLivePreviewFiles?

    init(
        fileName: String,
        mediaKind: String,
        capturedAt: Date? = nil,
        originalBytes: Int64? = nil,
        format: String? = nil,
        source: String? = nil,
        pixelWidth: Int? = nil,
        pixelHeight: Int? = nil,
        duration: TimeInterval? = nil,
        location: CLLocationCoordinate2D? = nil,
        locationStatus: String? = nil,
        resources: [XDriveIOSNativeViewerResourceDetail] = [],
        liveFiles: XDriveIOSLivePreviewFiles? = nil
    ) {
        self.fileName = fileName
        self.mediaKind = mediaKind
        self.capturedAt = capturedAt
        self.originalBytes = originalBytes
        self.format = format
        self.source = source
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.duration = duration
        self.location = location
        self.locationStatus = locationStatus
        self.resources = resources
        self.liveFiles = liveFiles
    }
}

struct XDriveIOSNativeViewerResourceDetail: Identifiable {
    let id: String
    let title: String
    let name: String?
    let mimeType: String?
    let size: Int64?
}

/// One information sheet is shared by local PhotoKit, cloud PhotoAsset and
/// backed-up Originals. It presents only metadata supplied by that source.
struct XDriveIOSNativeViewerInfoSheet: View {
    let details: XDriveIOSNativeViewerMediaDetails
    var onOpenLocation: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    private func sizeLabel(_ bytes: Int64?) -> String {
        guard let bytes, bytes >= 0 else { return "未提供" }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func durationLabel(_ seconds: TimeInterval?) -> String {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return "未提供" }
        let total = Int(seconds.rounded(.down))
        if total >= 3600 {
            return String(format: "%d:%02d:%02d",
                          total / 3600, (total / 60) % 60, total % 60)
        }
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func stagedSize(_ url: URL) -> Int64? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let value = attributes[.size] as? NSNumber else { return nil }
        return value.int64Value
    }

    var body: some View {
        NavigationStack {
            List {
                Section("媒体信息") {
                    LabeledContent("名称", value: details.fileName)
                    LabeledContent("类型", value: details.mediaKind)
                    LabeledContent(
                        "拍摄时间",
                        value: details.capturedAt?.formatted(
                            date: .long, time: .shortened
                        ) ?? "未提供"
                    )
                    if let duration = details.duration {
                        LabeledContent("时长", value: durationLabel(duration))
                    }
                    LabeledContent("原件大小", value: sizeLabel(details.originalBytes))
                    if let format = details.format, !format.isEmpty {
                        LabeledContent("格式", value: format)
                    }
                    if let source = details.source, !source.isEmpty {
                        LabeledContent("来源", value: source)
                    }
                    if let width = details.pixelWidth,
                       let height = details.pixelHeight, width > 0, height > 0 {
                        LabeledContent("当前解码分辨率", value: "\(width) × \(height)")
                    }
                }

                if !details.resources.isEmpty || details.liveFiles != nil {
                    Section("原始资源") {
                        ForEach(details.resources) { resource in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(resource.title)
                                if let name = resource.name, !name.isEmpty {
                                    Text(name).font(.caption).foregroundStyle(.secondary)
                                }
                                if let mime = resource.mimeType, !mime.isEmpty {
                                    Text(mime).font(.caption).foregroundStyle(.secondary)
                                }
                                if let size = resource.size {
                                    Text(sizeLabel(size)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        if let liveFiles = details.liveFiles {
                            LabeledContent(
                                "实况静态资源",
                                value: "\(liveFiles.stillURL.lastPathComponent) · \(sizeLabel(stagedSize(liveFiles.stillURL)))"
                            )
                            LabeledContent(
                                "实况动态资源",
                                value: "\(liveFiles.motionURL.lastPathComponent) · \(sizeLabel(stagedSize(liveFiles.motionURL)))"
                            )
                        }
                    }
                }

                if let coordinate = details.location {
                    Section("拍摄位置") {
                        XDriveIOSNativeViewerInfoMapPreview(coordinate: coordinate)
                            .frame(height: 190)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel("拍摄位置地图预览")
                        if let onOpenLocation {
                            Button {
                                onOpenLocation()
                            } label: {
                                Label("在地图中显示附近照片", systemImage: "map")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                    }
                } else if let status = details.locationStatus {
                    Section("拍摄位置") {
                        Text(status).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("照片信息")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct XDriveIOSNativeViewerInfoMapPreview: UIViewRepresentable {
    let coordinate: CLLocationCoordinate2D

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.showsUserLocation = false
        map.isUserInteractionEnabled = false
        map.pointOfInterestFilter = .excludingAll
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.setRegion(
            MKCoordinateRegion(
                center: coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)
            ),
            animated: false
        )
    }
}
