#!/usr/bin/env python3
"""Execute the production Swift stage-3 classification function in isolation.

This is a RED/GREEN regression for a *specific code path*: URLSession returns
a certificate error with no observed server-trust rejection. It does NOT
pretend to reproduce the user's private NAS's actual certificate or iPhone.
"""
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]


def extract_swift_block(source: str, marker: str) -> str:
    start = source.index(marker)
    first = source.index("{", start)
    depth = 0
    for pos in range(first, len(source)):
        if source[pos] == "{":
            depth += 1
        elif source[pos] == "}":
            depth -= 1
            if depth == 0:
                return source[start:pos + 1]
    raise AssertionError(f"Unclosed Swift production block: {marker}")


trust = (ROOT / "ios/XDriveIOS/NativeLANTrust.swift").read_text()
route = (ROOT / "ios/XDriveIOS/NativeLANLoginRoute.swift").read_text()
production_enum = extract_swift_block(trust, "enum XDriveIOSLANPairingFailure: Error {")
production_classifier = extract_swift_block(
    route,
    "static func pairingProbeFailure(_ error: Error) -> XDriveIOSLANPairingFailure {",
)

# Evidence on the fixed branch is orthogonal to this test. Only its public
# summary property is needed to typecheck the original enum unchanged.
runner = r'''import Foundation

struct XDriveIOSLANTrustEvidence {
    var safeSummary: String { "test-only-redacted-evidence" }
}
enum AuthFailure: Error {
    case redirectRefused, invalidLANProbe, other
}
''' + production_enum + "\n\nenum XDriveIOSNativeLANLoginRoute {\n" + production_classifier + r'''
}

@main struct XDriveNoChallengeClassifierCheck {
    static func main() {
        let inputs: [URLError.Code] = [
            .serverCertificateUntrusted,
            .serverCertificateHasBadDate,
            .serverCertificateNotYetValid,
            .serverCertificateHasUnknownRoot,
        ]
        for input in inputs {
            let failure = XDriveIOSNativeLANLoginRoute.pairingProbeFailure(URLError(input))
            let message = failure.message
            guard message.contains("NO_TRUST_CHALLENGE"),
                  message.contains("第 3 步失败"),
                  !message.contains("请检查服务端 Caddy 内网证书。") else {
                print("RED REPRODUCED: unobserved ServerTrust challenge incorrectly " +
                      "reported as CA/IP identity failure; URLSession OS code=" +
                      String(input.rawValue))
                exit(1)
            }
        }
        print("GREEN: no ServerTrust rejection recorded, so no invented CA/IP identity verdict")
    }
}
'''

with tempfile.TemporaryDirectory(prefix="xdrive-ios-lan-classifier-") as temp:
    swift = Path(temp, "runner.swift")
    executable = Path(temp, "runner")
    swift.write_text(runner)
    subprocess.run(["swiftc", "-swift-version", "5", "-parse-as-library",
                    str(swift), "-o", str(executable)], check=True)
    result = subprocess.run([str(executable)], check=False)
    raise SystemExit(result.returncode)
