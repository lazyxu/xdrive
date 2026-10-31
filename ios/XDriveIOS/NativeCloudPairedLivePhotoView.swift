import Photos
import PhotosUI
import SwiftUI
import UIKit

/// Restores Apple's synchronized Live Photo from the two already verified
/// xDrive original resources. The read-only, private files stay owned by the
/// presenting Viewer; this representable never writes to the Photos library.
struct XDriveIOSNativeCloudPairedLivePhotoView: UIViewRepresentable {
    let files: XDriveIOSLivePreviewFiles
    let placeholder: UIImage
    let playbackRequest: UUID?
    let onResult: (Bool) -> Void

    final class Coordinator {
        weak var view: PHLivePhotoView?
        var requestID: PHLivePhotoRequestID?
        var active = true
        var fullyLoaded = false
        var requestedPlayback: UUID?
        var lastPlayed: UUID?

        func retire() {
            active = false
            if let requestID { PHLivePhoto.cancelRequest(withRequestID: requestID) }
            requestID = nil
            view?.stopPlayback()
            view?.livePhoto = nil
            view = nil
            fullyLoaded = false
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PHLivePhotoView {
        let view = PHLivePhotoView()
        view.backgroundColor = .clear
        let coordinator = context.coordinator
        coordinator.active = true
        coordinator.view = view
        coordinator.requestedPlayback = playbackRequest
        // Photos pairs the original still and MOV by their real capture
        // metadata. A CRC-valid but mismatched pair must NOT be described as
        // a native Live Photo; the Viewer retains the original video fallback.
        coordinator.requestID = PHLivePhoto.request(
            withResourceFileURLs: [files.stillURL, files.motionURL],
            placeholderImage: placeholder,
            targetSize: CGSize(width: 1800, height: 1800),
            contentMode: .aspectFit
        ) { [weak coordinator] photo, info in
            Task { @MainActor in
                guard let coordinator, coordinator.active,
                      let view = coordinator.view,
                      (info[PHLivePhotoInfoCancelledKey] as? NSNumber)?.boolValue != true
                else { return }
                let degraded =
                    (info[PHLivePhotoInfoIsDegradedKey] as? NSNumber)?.boolValue == true
                if let photo {
                    view.livePhoto = photo
                    if !degraded {
                        coordinator.fullyLoaded = true
                        if let token = coordinator.requestedPlayback,
                           token != coordinator.lastPlayed {
                            coordinator.lastPlayed = token
                            view.startPlayback(with: .full)
                        }
                        onResult(true)
                    }
                } else if !degraded && info[PHLivePhotoInfoErrorKey] != nil {
                    onResult(false)
                }
            }
        }
        return view
    }

    func updateUIView(_ view: PHLivePhotoView, context: Context) {
        let coordinator = context.coordinator
        guard coordinator.active else { return }
        coordinator.requestedPlayback = playbackRequest
        if let token = playbackRequest, coordinator.fullyLoaded,
           token != coordinator.lastPlayed {
            coordinator.lastPlayed = token
            view.startPlayback(with: .full)
        }
    }

    static func dismantleUIView(_ view: PHLivePhotoView, coordinator: Coordinator) {
        coordinator.retire()
    }
}
