import Foundation

@main
struct PhotoBackupFilenamePolicyChecks {
    static func main() {
        typealias P = XDriveIOSOriginalBackupFilenamePolicy
        let hash = String(repeating: "a", count: 64)
        let tag = String(repeating: "b", count: 24)
        // Existing Server Node names and receipt evidence stay identical.
        let expected = "IMG_1001-xios-" + tag + "-" +
            String(hash.prefix(12)) + ".HEIC"
        precondition(P.destinationName(originalFilename: "IMG_1001.HEIC",
                                       destinationTag: tag, fullSHA256: hash) == expected)
        precondition(P.destinationName(originalFilename: "IMG_1001.HEIC",
                                       destinationTag: nil, fullSHA256: hash) == "IMG_1001.HEIC")
        for filename in [
            "CON.JPG", "LPT2.MOV", "a?b.heic", "a\\b.jpg", "../outside.jpg",
            "   .heic", String(repeating: "相", count: 100) + ".HEIC",
            String(repeating: "🖼️", count: 90) + ".heic"
        ] {
            guard let result = P.destinationName(
                originalFilename: filename, destinationTag: tag, fullSHA256: hash
            ) else { fatalError("Unable to map imported filename: \(filename)") }
            precondition(P.validServerFilename(result))
            precondition(result.utf8.count <= 255)
            precondition(!result.contains("/"))
            precondition(result == P.destinationName(
                originalFilename: filename, destinationTag: tag, fullSHA256: hash
            ))
        }
        precondition(P.destinationName(originalFilename: "invalid?name.jpg",
                                       destinationTag: nil, fullSHA256: hash) != nil)
        precondition(P.destinationName(originalFilename: "a.jpg",
                                       destinationTag: "bad", fullSHA256: hash) == nil)
        precondition(P.destinationName(originalFilename: "a.jpg",
                                       destinationTag: tag, fullSHA256: "bad") == nil)
        print("PASS: Photos backup original filename normalization")
    }
}
