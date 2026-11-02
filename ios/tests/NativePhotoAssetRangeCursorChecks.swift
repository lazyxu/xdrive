import Foundation

@main
struct NativePhotoAssetRangeCursorChecks {
    static func main() {
        typealias P = XDriveIOSNativePhotoAssetRangeCursorPolicy
        precondition(!P.validPage(offset: 0, count: 0, total: 0))
        precondition(P.validPage(offset: 0, count: 48, total: 97))
        precondition(P.validPage(offset: 48, count: 48, total: 97))
        precondition(P.validPage(offset: 96, count: 1, total: 97))
        precondition(P.validPage(offset: 0, count: 47, total: 47))
        precondition(!P.validPage(offset: 0, count: 47, total: 48))
        precondition(!P.validPage(offset: 1, count: 48, total: 96))
        precondition(!P.validPage(offset: 48, count: 0, total: 96))
        precondition(!P.validPage(offset: 48, count: 49, total: 97))
        precondition(!P.validPage(offset: 96, count: 2, total: 97))
        precondition(!P.validPage(offset: 0, count: 48, total: Int.max))
        precondition(P.adjacentOffset(
            current: 0, count: 48, total: 97, selectedIndex: 47, direction: 1
        ) == 48)
        precondition(P.adjacentOffset(
            current: 48, count: 48, total: 97, selectedIndex: 47, direction: 1
        ) == 96)
        precondition(P.adjacentOffset(
            current: 96, count: 1, total: 97, selectedIndex: 0, direction: -1
        ) == 48)
        precondition(P.adjacentOffset(
            current: 48, count: 48, total: 97, selectedIndex: 0, direction: -1
        ) == 0)
        precondition(P.adjacentOffset(
            current: 0, count: 48, total: 97, selectedIndex: 0, direction: -1
        ) == nil)
        precondition(P.adjacentOffset(
            current: 96, count: 1, total: 97, selectedIndex: 0, direction: 1
        ) == nil)
        precondition(P.adjacentOffset(
            current: 0, count: 48, total: 97, selectedIndex: 46, direction: 1
        ) == nil)
        precondition(P.adjacentOffset(
            current: 48, count: 48, total: 97, selectedIndex: 1, direction: -1
        ) == nil)
        precondition(P.adjacentOffset(
            current: 48, count: 48, total: 97, selectedIndex: 47, direction: 2
        ) == nil)
        precondition(P.adjacentOffset(
            current: 0, count: 48, total: 97, selectedIndex: -1, direction: 1
        ) == nil)
        precondition(P.adjacentOffset(
            current: 0, count: 48, total: 97, selectedIndex: 48, direction: 1
        ) == nil)
        print("native cloud PhotoAsset adjacent-range numeric cursor PASS")
    }
}
