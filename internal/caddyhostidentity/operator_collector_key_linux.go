//go:build linux

package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// The provisioner must create this fixed, single-linked 0600 PKCS#8 Ed25519
// file in a 0700 directory owned by a dedicated, non-root Collector UID.
// Neither this path nor any signing key is accepted from a request or a DB.
const privateCollectorKeyName = "collector-ed25519.v1.pk8"
const privateCollectorKeyMaxBytes = 256

// O_NONBLOCK prevents a swapped-in FIFO from blocking the isolated Collector
// between Lstat and the directory-relative openat. The subsequent fstat still
// requires the descriptor to be the same regular 0600 single-linked inode.
const privateCollectorKeyOpenFlags = syscall.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK

// This package-private witness intentionally has no exported fields and never
// carries the private key, its raw bytes, an absolute path or a signing method.
// Key preflight is not a Caddy observation, a mutation lease or an Applied
// receipt issuer. The future isolated issuer requires its own stricter gate.
type privateCollectorKeyWitness struct {
	publicDERPin string
	fileEpochSHA string
}

func privateCollectorStatTrusted(info os.FileInfo, uid uint32, isDir bool) bool {
	if info == nil || info.Mode()&(os.ModeSymlink|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return false
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uid {
		return false
	}
	if isDir {
		return info.IsDir() && info.Mode().Perm() == 0700
	}
	return info.Mode().IsRegular() && info.Mode().Perm() == 0600 && st.Nlink == 1 &&
		info.Size() > 0 && info.Size() <= privateCollectorKeyMaxBytes
}

func privateCollectorStatSame(before, after os.FileInfo) bool {
	if before == nil || after == nil || !os.SameFile(before, after) || before.Mode() != after.Mode() ||
		before.Size() != after.Size() {
		return false
	}
	b, bOK := before.Sys().(*syscall.Stat_t)
	a, aOK := after.Sys().(*syscall.Stat_t)
	return bOK && aOK && b.Dev == a.Dev && b.Ino == a.Ino && b.Uid == a.Uid &&
		b.Gid == a.Gid && b.Nlink == a.Nlink && b.Mode == a.Mode && b.Size == a.Size &&
		b.Mtim == a.Mtim && b.Ctim == a.Ctim
}

// privateOpenCollectorDirNoSymlinks opens EVERY pathname component from the
// root through an already-open directory with O_DIRECTORY|O_NOFOLLOW.
// EvalSymlinks/Lstat alone are not a safe admission gate: an untrusted parent
// could swap a symlink into the path between that check and os.Open.
func privateOpenCollectorDirNoSymlinks(dir string) (*os.File, error) {
	const flags = syscall.O_RDONLY | syscall.O_DIRECTORY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
	rootFD, err := syscall.Open("/", flags, 0)
	if err != nil {
		return nil, errUntrusted
	}
	current := os.NewFile(uintptr(rootFD), "/")
	if current == nil {
		syscall.Close(rootFD)
		return nil, errUntrusted
	}
	for _, name := range strings.Split(strings.TrimPrefix(dir, "/"), "/") {
		if name == "" || name == "." || name == ".." {
			current.Close()
			return nil, errUntrusted
		}
		nextFD, err := syscall.Openat(int(current.Fd()), name, flags, 0)
		current.Close()
		if err != nil {
			return nil, errUntrusted
		}
		current = os.NewFile(uintptr(nextFD), name)
		if current == nil {
			syscall.Close(nextFD)
			return nil, errUntrusted
		}
	}
	return current, nil
}

// privatePreflightOperatorCollectorKey ONLY verifies operator-provisioned key
// identity and stable storage. Its arguments MUST come from trusted local
// operator configuration (never HTTP, Agent, Host .env, or PostgreSQL Desired).
// It deliberately cannot sign any payload and must not authorize Applied.
//
// A dedicated Collector must run under its own unprivileged UID, distinct
// from the Server UID. Windows/Rootless layouts without this exact security
// model stay unverified; there is no TLS/secret-permission bypass fallback.
func privatePreflightOperatorCollectorKey(dir, expectedPublicDERPin string, serverUID uint32) (privateCollectorKeyWitness, error) {
	fail := func() (privateCollectorKeyWitness, error) { return privateCollectorKeyWitness{}, errUntrusted }
	uid := uint32(os.Geteuid())
	if uid == 0 || uid == serverUID || !validDigest(expectedPublicDERPin) ||
		dir == "" || !filepath.IsAbs(dir) || filepath.Clean(dir) != dir || dir == "/" {
		return fail()
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil || resolved != dir {
		return fail()
	}
	dirBefore, err := os.Lstat(dir)
	if err != nil || !privateCollectorStatTrusted(dirBefore, uid, true) {
		return fail()
	}
	folder, err := privateOpenCollectorDirNoSymlinks(dir)
	if err != nil {
		return fail()
	}
	defer folder.Close()
	dirOpened, err := folder.Stat()
	if err != nil || !privateCollectorStatTrusted(dirOpened, uid, true) ||
		!privateCollectorStatSame(dirBefore, dirOpened) {
		return fail()
	}

	keyPath := filepath.Join(dir, privateCollectorKeyName)
	keyBefore, err := os.Lstat(keyPath)
	if err != nil || !privateCollectorStatTrusted(keyBefore, uid, false) {
		return fail()
	}
	fd, err := syscall.Openat(int(folder.Fd()), privateCollectorKeyName,
		privateCollectorKeyOpenFlags, 0)
	if err != nil {
		return fail()
	}
	keyFile := os.NewFile(uintptr(fd), privateCollectorKeyName)
	if keyFile == nil {
		syscall.Close(fd)
		return fail()
	}
	defer keyFile.Close()
	opened, err := keyFile.Stat()
	if err != nil || !privateCollectorStatTrusted(opened, uid, false) ||
		!privateCollectorStatSame(keyBefore, opened) {
		return fail()
	}

	raw, err := io.ReadAll(io.LimitReader(keyFile, privateCollectorKeyMaxBytes+1))
	if err != nil || len(raw) == 0 || len(raw) > privateCollectorKeyMaxBytes {
		clear(raw)
		return fail()
	}
	defer clear(raw)
	key, err := x509.ParsePKCS8PrivateKey(raw)
	if err != nil {
		return fail()
	}
	privateKey, ok := key.(ed25519.PrivateKey)
	if !ok || len(privateKey) != ed25519.PrivateKeySize {
		return fail()
	}
	defer clear(privateKey)
	canonical, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil || !bytes.Equal(raw, canonical) {
		clear(canonical)
		return fail()
	}
	clear(canonical)
	publicKey, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok || len(publicKey) != ed25519.PublicKeySize {
		return fail()
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil || len(publicDER) != 44 {
		return fail()
	}
	pin := sha256.Sum256(publicDER)
	actual := hex.EncodeToString(pin[:])
	if subtle.ConstantTimeCompare([]byte(actual), []byte(expectedPublicDERPin)) != 1 {
		return fail()
	}

	keyAfter, err := os.Lstat(keyPath)
	if err != nil || !privateCollectorStatTrusted(keyAfter, uid, false) ||
		!privateCollectorStatSame(opened, keyAfter) {
		return fail()
	}
	dirAfter, err := os.Lstat(dir)
	if err != nil || !privateCollectorStatTrusted(dirAfter, uid, true) ||
		!privateCollectorStatSame(dirOpened, dirAfter) {
		return fail()
	}
	st, ok := keyAfter.Sys().(*syscall.Stat_t)
	if !ok {
		return fail()
	}
	// Detect same-key-byte atomic replace A->B->A during successive preflights;
	// no raw paths, private key bytes, PEM or certificate material are stored.
	stamp := fmt.Sprintf("xdrive.caddy.operator-collector-key-file.v1\n%d:%d:%d:%d:%d:%d:%d:%d\n",
		st.Dev, st.Ino, st.Size, st.Ctim.Sec, st.Ctim.Nsec,
		st.Mtim.Sec, st.Mtim.Nsec, st.Mode)
	sum := sha256.Sum256([]byte(stamp))
	return privateCollectorKeyWitness{publicDERPin: actual, fileEpochSHA: hex.EncodeToString(sum[:])}, nil
}
