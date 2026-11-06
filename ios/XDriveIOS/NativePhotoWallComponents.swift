import SwiftUI

/// Shared presentation-only photo wall for PhotoKit albums, GPS place sheets,
/// and authorized Owner PhotoAsset ranges. The caller keeps its own bounded
/// cursor, membership proof, thumbnail request and Viewer admission.
struct XDriveIOSNativePhotoWallGrid<Content: View>: View {
    let density: XDriveIOSNativePhotoWallDensity
    let spacing: CGFloat
    private let content: Content

    init(density: XDriveIOSNativePhotoWallDensity,
         spacing: CGFloat = 2,
         @ViewBuilder content: () -> Content) {
        self.density = density
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(
            minimum: density.minimumCellWidth,
            maximum: density.maximumCellWidth
        ), spacing: spacing)], spacing: spacing) {
            content
        }
    }
}
