package caddyhostidentity

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	privateCaddyPublishedPortTemplate = "{{.Id}}|{{.State.Pid}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{json .NetworkSettings.Ports}}"
	privatePublishedPortLimit         = 2048
	privateProcSocketTableLimit       = 256 << 10
)

type privateCaddyPortOwnership struct {
	digest      string
	instanceSHA string
}

type privateBoundedPortOutput struct{ data []byte }

func (o *privateBoundedPortOutput) Write(p []byte) (int, error) {
	if len(p) > privatePublishedPortLimit-len(o.data) {
		return 0, errUntrusted
	}
	o.data = append(o.data, p...)
	return len(p), nil
}

// The Docker daemon's published-port view is a *local routing claim*, not
// proof that a public client reached a specific process. Only an installed,
// fixed-name Caddy container and the fixed 443/tcp -> 8443 binding qualify.
func privateParseCaddyPublishedPorts(raw []byte, current privateHostEnabledTargets) (string, uint32, error) {
	fail := func() (string, uint32, error) { return "", 0, errUntrusted }
	if len(raw) == 0 || len(raw) > privatePublishedPortLimit || raw[len(raw)-1] != '\n' ||
		(current.domain == "" && current.lanIPv4 == "") ||
		(current.domain != "" && !validDomain(current.domain)) ||
		(current.lanIPv4 != "" && !validLANIP(current.lanIPv4)) {
		return fail()
	}
	pieces := strings.SplitN(strings.TrimSuffix(string(raw), "\n"), "|", 5)
	if len(pieces) != 5 || !validDigest(pieces[0]) || pieces[2] != "true" || pieces[3] != "healthy" {
		return fail()
	}
	pid64, err := strconv.ParseUint(pieces[1], 10, 32)
	if err != nil || pid64 == 0 || pid64 > 1<<22 || strconv.FormatUint(pid64, 10) != pieces[1] {
		return fail()
	}
	ports := []byte(pieces[4])
	if !privateHasUnambiguousCaddyJSON(ports) {
		return fail()
	}
	var mapping map[string]json.RawMessage
	if err := json.Unmarshal(ports, &mapping); err != nil || len(mapping) == 0 {
		return fail()
	}
	for name, binding := range mapping {
		switch name {
		case "80/tcp", "443/tcp":
			// Only fixed HTTPS is attested; existing HTTP is not a TLS proof.
		case "443/udp", "2019/tcp":
			// The official Caddy image EXPOSEs HTTP/3 and admin endpoints,
			// but the operator's Compose intentionally does not publish them.
			if !bytes.Equal(bytes.TrimSpace(binding), []byte("null")) {
				return fail()
			}
		default:
			return fail()
		}
	}
	rawHTTPS, ok := mapping["443/tcp"]
	if !ok || bytes.Equal(bytes.TrimSpace(rawHTTPS), []byte("null")) {
		return fail()
	}
	var listeners []json.RawMessage
	if json.Unmarshal(rawHTTPS, &listeners) != nil || len(listeners) == 0 || len(listeners) > 2 {
		return fail()
	}
	var ipv4Bindings, ipv6Bindings int
	for _, listener := range listeners {
		var fields map[string]json.RawMessage
		if json.Unmarshal(listener, &fields) != nil || len(fields) != 2 {
			return fail()
		}
		hostIPJSON, ipOK := fields["HostIp"]
		hostPortJSON, portOK := fields["HostPort"]
		if !ipOK || !portOK {
			return fail()
		}
		var hostIP, hostPort string
		if json.Unmarshal(hostIPJSON, &hostIP) != nil || json.Unmarshal(hostPortJSON, &hostPort) != nil {
			return fail()
		}
		if hostIP == "::" {
			ipv6Bindings++
			// Docker routed IPv6 may report an empty HostPort. It must never
			// substitute for the required, independently validated IPv4 path.
			if (hostPort != "" && hostPort != privateHostHTTPSPort) || ipv6Bindings != 1 {
				return fail()
			}
			continue
		}
		if hostPort != privateHostHTTPSPort {
			return fail()
		}
		ipv4Bindings++
		// Every production Ready probe targets IPv4 loopback for a DNS entry;
		// a LAN IP probe must ALSO be reachable through this published port.
		if current.domain != "" && hostIP != "0.0.0.0" && hostIP != "127.0.0.1" {
			return fail()
		}
		if current.lanIPv4 != "" && hostIP != "0.0.0.0" && hostIP != current.lanIPv4 {
			return fail()
		}
	}
	if ipv4Bindings != 1 {
		return fail()
	}
	return pieces[0], uint32(pid64), nil
}

// Require an actual 443 LISTEN inode in the container init process network
// namespace, and require its file descriptor to belong to that exact Caddy
// process. This excludes unrelated processes that happen to share a netns.
// procRoot is always "/proc" in production; test-only callers use a fixture.
func privateReadCaddyListenerInode(procRoot string, pid uint32) (uint64, error) {
	fail := func() (uint64, error) { return 0, errUntrusted }
	if pid == 0 || pid > 1<<22 {
		return fail()
	}
	base := filepath.Join(procRoot, strconv.FormatUint(uint64(pid), 10))
	comm, err := os.ReadFile(filepath.Join(base, "comm"))
	if err != nil || !bytes.Equal(comm, []byte("caddy\n")) {
		return fail()
	}
	exe, err := os.Readlink(filepath.Join(base, "exe"))
	if err != nil || exe != "/usr/bin/caddy" {
		return fail()
	}
	sockets := map[uint64]struct{}{}
	for _, protocol := range []string{"tcp", "tcp6"} {
		f, err := os.Open(filepath.Join(base, "net", protocol))
		if err != nil {
			continue
		}
		raw, readErr := io.ReadAll(io.LimitReader(f, privateProcSocketTableLimit+1))
		closeErr := f.Close()
		if readErr != nil || closeErr != nil || len(raw) > privateProcSocketTableLimit {
			return fail()
		}
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 10 || fields[3] != "0A" {
				continue
			}
			addr := strings.Split(fields[1], ":")
			if len(addr) != 2 || addr[1] != "01BB" {
				continue
			}
			// An unrelated process in this network namespace may listen on
			// loopback:443 while Docker publishes container:443 on its external
			// interface. An FD-held *loopback-only* socket is therefore NOT
			// evidence that this Caddy process owns the published listener.
			// The shipped Caddyfiles bind :443 (wildcard) on IPv4/IPv6.
			if (protocol == "tcp" && addr[0] != "00000000") ||
				(protocol == "tcp6" && addr[0] != "00000000000000000000000000000000") {
				continue
			}
			inode, err := strconv.ParseUint(fields[9], 10, 64)
			if err != nil || inode == 0 {
				return fail()
			}
			sockets[inode] = struct{}{}
		}
	}
	if len(sockets) == 0 {
		return fail()
	}
	entries, err := os.ReadDir(filepath.Join(base, "fd"))
	if err != nil || len(entries) > 2048 {
		return fail()
	}
	var found uint64
	for _, entry := range entries {
		_, err := strconv.ParseUint(entry.Name(), 10, 32)
		if err != nil {
			return fail()
		}
		target, err := os.Readlink(filepath.Join(base, "fd", entry.Name()))
		if err != nil {
			continue
		}
		if !strings.HasPrefix(target, "socket:[") || !strings.HasSuffix(target, "]") {
			continue
		}
		inode, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]"), 10, 64)
		if err != nil {
			continue
		}
		if _, ok := sockets[inode]; ok {
			if found != 0 && found != inode {
				return fail()
			}
			found = inode
		}
	}
	if found == 0 {
		return fail()
	}
	return found, nil
}

// Linux Host only. No caller-provided executable, container, port, proc root,
// network destination, token, or Docker context is allowed by production.
func privateReadFixedCaddyPublishedOwner(ctx context.Context, current privateHostEnabledTargets) (privateCaddyPortOwnership, error) {
	fail := func() (privateCaddyPortOwnership, error) { return privateCaddyPortOwnership{}, errUntrusted }
	if runtime.GOOS != "linux" || ctx == nil || ctx.Err() != nil {
		return fail()
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, privateDockerExecutable, "inspect", "--format", privateCaddyPublishedPortTemplate, "xdrive-caddy")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "HOME=/nonexistent"}
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	out := &privateBoundedPortOutput{}
	cmd.Stdout = out
	defer clear(out.data)
	if err := cmd.Run(); err != nil || bounded.Err() != nil {
		return fail()
	}
	containerID, pid, err := privateParseCaddyPublishedPorts(out.data, current)
	if err != nil {
		return fail()
	}
	inode, err := privateReadCaddyListenerInode("/proc", pid)
	if err != nil || bounded.Err() != nil {
		return fail()
	}
	sum := sha256.New()
	_, _ = io.WriteString(sum, "xdrive.caddy.host.published-owner.v1\n")
	_, _ = io.WriteString(sum, containerID+"\n"+strconv.FormatUint(uint64(pid), 10)+"\n")
	_, _ = sum.Write(out.data)
	_, _ = io.WriteString(sum, strconv.FormatUint(inode, 10)+"\n")
	instance := sha256.Sum256([]byte("xdrive.caddy.host.instance.v1\n" + containerID + "\n"))
	return privateCaddyPortOwnership{
		digest:      hex.EncodeToString(sum.Sum(nil)),
		instanceSHA: hex.EncodeToString(instance[:]),
	}, nil
}

type privatePublishedOwnerReader func(context.Context, privateHostEnabledTargets) (privateCaddyPortOwnership, error)

// Snapshot both published Docker port ownership and the actual Caddy FD
// around the existing full TLS/route/generation check. A changed listener,
// inode or container generation fails closed; this is not proof against
// out-of-band NAT rewrites or post-observation reloads.
func privateObservePublishedOwnerWith(ctx context.Context, current privateHostEnabledTargets,
	read privatePublishedOwnerReader, observe func(context.Context) (privateIngressTransportCandidates, error),
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || read == nil || observe == nil {
		return fail()
	}
	first, err := read(ctx, current)
	if err != nil || !validDigest(first.digest) || !validDigest(first.instanceSHA) || ctx.Err() != nil {
		return fail()
	}
	result, err := observe(ctx)
	if err != nil || !validDigest(result.routeDigest) || !validDigest(result.runtime.instanceSHA) ||
		result.runtime.instanceSHA != first.instanceSHA || ctx.Err() != nil {
		return fail()
	}
	last, err := read(ctx, current)
	if err != nil || last != first || ctx.Err() != nil {
		return fail()
	}
	result.publishedOwnerDigest = first.digest
	return result, nil
}
