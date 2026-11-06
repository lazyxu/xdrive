#!/usr/bin/env bash
set -euo pipefail
fixture="$(mktemp -d "$1/xdrive-ios-lan-trust.XXXXXX")"
trap 'rm -f -- "$fixture"/*; rmdir -- "$fixture"' EXIT
umask 077

cat > "$fixture/root.cnf" <<'EOF'
[ req ]
distinguished_name = name
x509_extensions = root
[ name ]
[ root ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF
for ca in ca other-ca; do
  openssl req -new -x509 -newkey rsa:2048 -nodes -sha256 -days 7 \
    -subj "/CN=xDrive offline TLS fixture $ca" -config "$fixture/root.cnf" \
    -keyout "$fixture/$ca.key" -out "$fixture/$ca.pem"
done

openssl req -new -newkey rsa:2048 -nodes -sha256 -subj /CN=192.168.2.4 \
  -config "$fixture/root.cnf" -keyout "$fixture/leaf.key" -out "$fixture/leaf.csr"
for identity in ip dns; do
  case "$identity" in ip) san='IP:192.168.2.4' ;; dns) san='DNS:192.168.2.4' ;; esac
  cat > "$fixture/leaf.cnf" <<EOF
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $san
EOF
  openssl x509 -req -in "$fixture/leaf.csr" -CA "$fixture/ca.pem" -CAkey "$fixture/ca.key" \
    -CAcreateserial -days 1 -sha256 -extfile "$fixture/leaf.cnf" -out "$fixture/$identity.pem"
  openssl x509 -in "$fixture/$identity.pem" -outform DER -out "$fixture/$identity.der"
done

swiftc -swift-version 5 -parse-as-library \
  ios/XDriveIOS/NativeLANTrust.swift ios/XDriveIOS/NativeLANCertificateBootstrap.swift \
  ios/tests/NativeLANTrustChecks.swift \
  -o "$fixture/check"
"$fixture/check" "$fixture"
