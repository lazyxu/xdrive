import Foundation

@main
struct NativeLocalPhotoSharePolicyChecks {
    static func main() {
        typealias Policy = XDriveIOSNativeLocalPhotoSharePolicy
        precondition(Policy.maximumItems == 8)
        precondition(Policy.fileName(item: 0, resource: 0,
                                     original: "IMG_0312.HEIC") == "xdrive-photo-0-0.heic")
        precondition(Policy.fileName(item: 0, resource: 1,
                                     original: "IMG_0312.MOV") == "xdrive-photo-0-1.mov")
        precondition(Policy.fileName(item: 7, resource: 0,
                                     original: "folder/IMG_1.DNG") == "xdrive-photo-7-0.dng")
        precondition(Policy.fileName(item: 8, resource: 0,
                                     original: "a.jpg") == nil)
        precondition(Policy.fileName(item: -1, resource: 0,
                                     original: "a.jpg") == nil)
        precondition(Policy.fileName(item: 0, resource: 2,
                                     original: "a.mov") == nil)
        precondition(Policy.fileName(item: 0, resource: 0,
                                     original: "no-extension") == nil)
        precondition(Policy.fileName(item: 0, resource: 0,
                                     original: "photo.🍎") == nil)
        precondition(Policy.fileName(item: 0, resource: 0,
                                     original: "a.\(String(repeating: "x", count: 13))") == nil)
        precondition(Policy.fileName(item: 0, resource: 0,
                                     original: String(repeating: "x", count: 1025) + ".jpg") == nil)
        precondition(Policy.fitsBudget(existing: 0, additional: 1))
        precondition(Policy.fitsBudget(existing: 0, additional: Policy.maximumTotalBytes))
        precondition(!Policy.fitsBudget(existing: 0, additional: 0))
        precondition(!Policy.fitsBudget(existing: -1, additional: 1))
        precondition(!Policy.fitsBudget(existing: Policy.maximumTotalBytes, additional: 1))
        precondition(!Policy.fitsBudget(existing: Int64.max, additional: Int64.max))
        print("Native local PhotoKit original Share Sheet policy: PASS")
    }
}
