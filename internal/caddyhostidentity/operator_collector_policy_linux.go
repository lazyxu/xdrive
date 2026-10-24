//go:build linux

package caddyhostidentity

import (
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const (
	privateOperatorPolicyDomain   = "xdrive.caddy.collector.operator-policy.v1"
	privateOperatorPolicyMaxBytes = 384
	privateOperatorPolicyFile     = "operator-policy.v1"
	privateOperatorKeyDirectory   = "/var/lib/xdrive-caddy-collector"
)

// The root-owned local policy is deliberately public-data-only: it contains
// nonsecret UIDs and a public SPKI pin, NEVER private key bytes or credentials.
// Neither HTTP, Agent, Host .env, PostgreSQL, CLI args nor environment
// variables can change these production locations.
var privateOperatorPolicyComponents = [...]string{"etc", "xdrive", "collector", privateOperatorPolicyFile}

type privateOperatorCollectorPolicy struct {
	collectorUID uint32
	serverUID    uint32
	publicDERPin string
}

func privateParseOperatorCollectorPolicy(raw []byte) (privateOperatorCollectorPolicy, error) {
	fail := func() (privateOperatorCollectorPolicy, error) { return privateOperatorCollectorPolicy{}, errUntrusted }
	if len(raw) == 0 || len(raw) > privateOperatorPolicyMaxBytes {
		return fail()
	}
	lines := strings.Split(string(raw), "\n")
	if len(lines) != 5 || lines[0] != privateOperatorPolicyDomain || lines[4] != "" {
		return fail()
	}
	if !strings.HasPrefix(lines[1], "collector_uid=") ||
		!strings.HasPrefix(lines[2], "server_uid=") ||
		!strings.HasPrefix(lines[3], "public_spki_sha256=") {
		return fail()
	}
	cUIDString := strings.TrimPrefix(lines[1], "collector_uid=")
	sUIDString := strings.TrimPrefix(lines[2], "server_uid=")
	pin := strings.TrimPrefix(lines[3], "public_spki_sha256=")
	collectorUID, cErr := strconv.ParseUint(cUIDString, 10, 32)
	serverUID, sErr := strconv.ParseUint(sUIDString, 10, 32)
	if cErr != nil || sErr != nil || collectorUID == 0 || collectorUID == serverUID ||
		strconv.FormatUint(collectorUID, 10) != cUIDString ||
		strconv.FormatUint(serverUID, 10) != sUIDString || !validDigest(pin) {
		return fail()
	}
	return privateOperatorCollectorPolicy{
		collectorUID: uint32(collectorUID), serverUID: uint32(serverUID), publicDERPin: pin,
	}, nil
}

func privateOperatorPolicyTrustedStat(info os.FileInfo, ownerUID uint32, directory bool) bool {
	if info == nil || info.Mode()&(os.ModeSymlink|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != ownerUID {
		return false
	}
	if directory {
		return info.IsDir() && info.Mode().Perm()&0022 == 0
	}
	return info.Mode().IsRegular() && info.Mode().Perm() == 0644 &&
		stat.Nlink == 1 && info.Size() > 0 && info.Size() <= privateOperatorPolicyMaxBytes
}

// privateReadOperatorPolicyFrom is an unexported test seam. Production ALWAYS
// anchors at "/" and requires UID=0 for every opened ancestor and file.
// Every component is opened relative to the already verified directory FD,
// rejecting symlink swaps, writeable ancestors, FIFOs, hardlinks and odd modes.
func privateReadOperatorPolicyFrom(anchor string, components []string, ownerUID uint32) ([]byte, error) {
	fail := func() ([]byte, error) { return nil, errUntrusted }
	if anchor == "" || !filepath.IsAbs(anchor) || filepath.Clean(anchor) != anchor ||
		len(components) == 0 || len(components) > 8 {
		return fail()
	}
	for _, part := range components {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "/\\") {
			return fail()
		}
	}
	const dirFlags = syscall.O_RDONLY | syscall.O_DIRECTORY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
	rootFD, err := syscall.Open(anchor, dirFlags, 0)
	if err != nil {
		return fail()
	}
	current := os.NewFile(uintptr(rootFD), "operator-policy-root")
	if current == nil {
		syscall.Close(rootFD)
		return fail()
	}
	defer func() { _ = current.Close() }()
	rootStat, err := current.Stat()
	if err != nil || !privateOperatorPolicyTrustedStat(rootStat, ownerUID, true) {
		return fail()
	}
	for _, name := range components[:len(components)-1] {
		nextFD, err := syscall.Openat(int(current.Fd()), name, dirFlags, 0)
		if err != nil {
			return fail()
		}
		next := os.NewFile(uintptr(nextFD), name)
		if next == nil {
			syscall.Close(nextFD)
			return fail()
		}
		opened, statErr := next.Stat()
		if statErr != nil || !privateOperatorPolicyTrustedStat(opened, ownerUID, true) {
			next.Close()
			return fail()
		}
		current.Close()
		current = next
	}
	const fileFlags = syscall.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
	fd, err := syscall.Openat(int(current.Fd()), components[len(components)-1], fileFlags, 0)
	if err != nil {
		return fail()
	}
	file := os.NewFile(uintptr(fd), privateOperatorPolicyFile)
	if file == nil {
		syscall.Close(fd)
		return fail()
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !privateOperatorPolicyTrustedStat(before, ownerUID, false) {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(file, privateOperatorPolicyMaxBytes+1))
	if err != nil || len(raw) == 0 || len(raw) > privateOperatorPolicyMaxBytes {
		return fail()
	}
	after, err := file.Stat()
	if err != nil || !privateOperatorPolicyTrustedStat(after, ownerUID, false) ||
		!privateCollectorStatSame(before, after) {
		return fail()
	}
	return raw, nil
}

// CheckOperatorCollectorBootstrap is the ONLY exported capability. It checks
// the local root-owned pin and a separate UID's PKCS#8 key at a fixed path.
// Its result grants NO signing capability, Caddy Apply, HTTP listener, Docker
// access, PostgreSQL write, nonce use or public "Applied" assertion.
func CheckOperatorCollectorBootstrap() error {
	if os.Geteuid() == 0 {
		return errUntrusted
	}
	raw, err := privateReadOperatorPolicyFrom("/",
		privateOperatorPolicyComponents[:], 0)
	if err != nil {
		return errUntrusted
	}
	policy, err := privateParseOperatorCollectorPolicy(raw)
	if err != nil || policy.collectorUID != uint32(os.Geteuid()) {
		return errUntrusted
	}
	_, err = privatePreflightOperatorCollectorKey(
		privateOperatorKeyDirectory, policy.publicDERPin, policy.serverUID)
	if err != nil {
		return errUntrusted
	}
	return nil
}
