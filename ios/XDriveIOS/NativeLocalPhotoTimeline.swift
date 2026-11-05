import SwiftUI

/// Compatibility entry for routes that previously opened the old
/// year/month/day screen. There is one canonical native PhotoKit wall:
/// no separate 64-photo page UI, parallel reader, or Previous/Next controls.
struct XDriveIOSNativeLocalPhotoTimelineScreen: View {
    @State private var savedOffset = 0
    @State private var mediaFilter: XDriveIOSNativePhotoMediaFilter = .all

    var body: some View {
        XDriveIOSNativeLocalPhotoTimelineContainer(
            savedOffset: $savedOffset,
            mediaFilter: $mediaFilter
        )
    }
}
