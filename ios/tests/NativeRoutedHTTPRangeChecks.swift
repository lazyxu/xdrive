import Foundation

@main
struct XDriveIOSRoutedHTTPRangeChecks {
    static func main() {
        let valid = "bytes 10-19/100"
        let range = XDriveIOSRoutedHTTPRange.bounded(
            valid, first: 10, maximumEnd: 19)
        precondition(range == XDriveIOSRoutedHTTPRange(
            first: 10, last: 19, total: 100))
        precondition(XDriveIOSRoutedHTTPRange.bounded(
            "bytes 99-99/100", first: 99, maximumEnd: 100) != nil)
        precondition(XDriveIOSRoutedHTTPRange.bounded(
            "bytes 0-262143/262144", first: 0, maximumEnd: 262143) != nil)
        for bad in [
            nil, "", "bytes */100", "bytes 0-0/*",
            "bytes 0-10/10", "bytes 9-0/10", "bytes -1-4/10",
            "bytes 0-999/0", "bytes 0-999/100", "bytes 0-0/-10",
            "bytes 99999999999999999999999-9/10",
            "bytes 0-0/9223372036854775808", "Bytes 0-0/10",
            "bytes 0-0/10 extra", "bytes 0-262144/262145"
        ] as [String?] {
            precondition(XDriveIOSRoutedHTTPRange.bounded(
                bad, first: 0, maximumEnd: 262144) == nil,
                "invalid or oversized segment was accepted: \(bad ?? "nil")")
        }
        precondition(XDriveIOSRoutedHTTPRange.bounded(
            valid, first: 11, maximumEnd: 19) == nil)
        precondition(XDriveIOSRoutedHTTPRange.bounded(
            valid, first: 10, maximumEnd: 18) == nil)
        print("iOS AV routed media: bounded 206 Content-Range, seek and EOF passed")
    }
}
