#!/usr/bin/env bash
# Invoked by the local-only Node TLS fixture while its HTTPS peers are alive.
# All generated files remain inside the temporary CI worker.
set -euo pipefail

if [[ $# -ne 3 || ! $2 =~ ^[0-9]{1,5}$ || ! $3 =~ ^[0-9]{1,5}$ ]]; then
  echo "usage: run-native-lan-simulator.sh <fixture-directory> <valid-port> <wrong-ip-port>" >&2
  exit 2
fi
fixture="$1"
valid_port="$2"
wrong_port="$3"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -s "$fixture/local-root.pem" && -s "$fixture/other-root.pem" ]] || exit 2
command -v xcodegen >/dev/null
command -v xcodebuild >/dev/null
command -v xcrun >/dev/null

work="$(mktemp -d /tmp/xdrive-ios-lan-simulator.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/Host" "$work/Tests"
cp "$repo/ios/XDriveIOS/NativeLANTrust.swift" "$work/Tests/"
cp "$repo/ios/tests/NativeLANSimulatorTrustTests.swift" "$work/Tests/"

python3 - "$fixture" "$valid_port" "$wrong_port" "$work/Tests/NativeLANSimulatorConfig.swift" <<'PY'
import base64
from pathlib import Path
import sys
root, valid, invalid, destination = sys.argv[1:]
ca = Path(root)
def pem64(filename):
    data = (ca / filename).read_bytes()
    assert b"-----BEGIN CERTIFICATE-----" in data
    return base64.b64encode(data).decode("ascii")
Path(destination).write_text(
    "enum NativeLANSimulatorConfig {\n"
    f"    static let validPort = {int(valid)}\n"
    f"    static let wrongIPPort = {int(invalid)}\n"
    f"    static let trustedRootPEMBase64 = \"{pem64('local-root.pem')}\"\n"
    f"    static let otherRootPEMBase64 = \"{pem64('other-root.pem')}\"\n"
    "}\n"
)
PY

cat > "$work/Host/App.swift" <<'SWIFT'
import SwiftUI
@main
struct NativeLANTrustTestHost: App {
    var body: some Scene { WindowGroup { Text("Local TLS test host") } }
}
SWIFT

cat > "$work/Host/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
"http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSLocalNetworkUsageDescription</key><string>CI-only local TLS certificate regression</string>
</dict></plist>
PLIST

cat > "$work/project.yml" <<'YAML'
name: NativeLANTrustSimulator
options:
  bundleIdPrefix: com.lazyxu.xdrive.lantest
settings:
  base:
    SWIFT_VERSION: "5.0"
    IPHONEOS_DEPLOYMENT_TARGET: "16.0"
    CODE_SIGNING_ALLOWED: "NO"
targets:
  NativeLANHost:
    type: application
    platform: iOS
    sources:
      - path: Host
    info:
      path: Host/Info.plist
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.lazyxu.xdrive.lantest.host
  NativeLANTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - path: Tests
    dependencies:
      - target: NativeLANHost
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.lazyxu.xdrive.lantest.tests
schemes:
  NativeLANHost:
    build:
      targets:
        NativeLANHost: all
        NativeLANTests: [test]
    test:
      targets:
        - NativeLANTests
YAML

(
  cd "$work"
  xcodegen generate --spec project.yml
)

# An actual iPhone Simulator runtime is mandatory: never fall back to macOS.
sim_id="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
data=json.load(sys.stdin)
phones=[]
for platform,devices in data["devices"].items():
    for device in devices:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            phones.append((platform,device["udid"],device["name"]))
if not phones:
    raise SystemExit("No available iPhone simulator runtime")
phones.sort(reverse=True)
print(phones[0][1])
')"
echo "xDrive LAN trust simulator selected: $sim_id"
xcrun simctl boot "$sim_id" 2>/dev/null || true
xcrun simctl bootstatus "$sim_id" -b
xcodebuild test -project "$work/NativeLANTrustSimulator.xcodeproj" \
  -scheme NativeLANHost -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$sim_id" \
  -only-testing:NativeLANTests/NativeLANSimulatorTrustTests \
  -derivedDataPath "$work/DerivedData" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
