import Foundation

/// RED/GREEN regression for the precise pre-login stage-3 classification
/// branch. It is intentionally not evidence of the real iPhone TLS peer.
/// A URLSession certificate error WITHOUT a recorded ServerTrust challenge
/// cannot be described as a confirmed pinned CA or IP SAN mismatch.
@main
struct NativeLANStage3NoChallengeRepro {
    static func main() {
        let codes: [URLError.Code] = [
            .serverCertificateUntrusted,
            .serverCertificateHasBadDate,
            .serverCertificateNotYetValid,
            .serverCertificateHasUnknownRoot
        ]
        for code in codes {
            let message = XDriveIOSNativeLANLoginRoute
                .pairingProbeFailure(URLError(code)).message
            guard message.contains("NO_TRUST_CHALLENGE"),
                  !message.contains("请检查服务端 Caddy 内网证书。") else {
                print("RED REPRODUCED: a URLSession certificate error with no recorded " +
                    "ServerTrust rejection is classified as invalid CA/IP SAN; code=" +
                    String(code.rawValue))
                exit(1)
            }
        }
        let afterTrust = XDriveIOSLANPairingFailure
            .ipCertificatePostTrustFailure(-1202).message
        guard afterTrust.contains("POST_TRUST_SYSTEM_REJECTION"),
              !afterTrust.contains("NO_TRUST_CHALLENGE") else {
            print("RED: strict trust acceptance and later CFNetwork failure are conflated")
            exit(1)
        }
        print("GREEN: URLSession certificate errors without a challenge are " +
              "distinguished from confirmed pinned CA/IP SAN rejection")
    }
}
