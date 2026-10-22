package caddyhostidentity

import (
	"context"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Host-private fixed read-only Docker operation. No request-supplied
// executable, container, URL, shell script, Docker API method or arguments.
type privateHostSampleKind uint8

const (
	privateHostDockerGeneration privateHostSampleKind = iota + 1
	privateHostCaddyLiveConfig
)
const (
	privateDockerExecutable = "/usr/bin/docker"
	privateInspectTemplate  = "{{.Id}}|{{.State.StartedAt}}|{{.State.Pid}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}"
	privateLiveHashScript   = "set -o pipefail; wget -q -T 2 -O - http://127.0.0.1:2019/config/ | sha256sum"
	privateSampleBytesMax   = 256
)

type privateHostSampleRunner func(context.Context, privateHostSampleKind) ([]byte, error)

func privateDockerReadOnlyArguments(kind privateHostSampleKind) ([]string, bool) {
	switch kind {
	case privateHostDockerGeneration:
		return []string{"inspect", "--format", privateInspectTemplate, "xdrive-caddy"}, true
	case privateHostCaddyLiveConfig:
		return []string{"exec", "xdrive-caddy", "/bin/sh", "-ec", privateLiveHashScript}, true
	default:
		return nil, false
	}
}

type privateLimitedDockerOutput struct{ bytes []byte }

func (o *privateLimitedDockerOutput) Write(chunk []byte) (int, error) {
	if len(chunk) > privateSampleBytesMax-len(o.bytes) {
		return 0, errUntrusted
	}
	o.bytes = append(o.bytes, chunk...)
	return len(chunk), nil
}

// This unexported Linux Host-only runner is never an HTTP/IPC handler. It
// cannot use ambient Docker contexts, caller paths or a configurable script.
// Nonstandard/rootless locations remain unsupported until securely wired.
func runPrivateFixedDockerSample(ctx context.Context, kind privateHostSampleKind) ([]byte, error) {
	args, allowed := privateDockerReadOnlyArguments(kind)
	if !allowed || runtime.GOOS != "linux" || ctx == nil || ctx.Err() != nil {
		return nil, errUntrusted
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, privateDockerExecutable, args...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "HOME=/nonexistent"}
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	output := &privateLimitedDockerOutput{}
	cmd.Stdout = output
	defer clear(output.bytes)
	if err := cmd.Run(); err != nil || bounded.Err() != nil || len(output.bytes) == 0 || len(output.bytes) > privateSampleBytesMax {
		return nil, errUntrusted
	}
	return append([]byte(nil), output.bytes...), nil
}

func privateReadCaddyRuntimeSample(ctx context.Context, runner privateHostSampleRunner) (privateCaddyRuntimeSample, error) {
	fail := func() (privateCaddyRuntimeSample, error) { return privateCaddyRuntimeSample{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || runner == nil {
		return fail()
	}
	inspected, err := runner(ctx, privateHostDockerGeneration)
	if err != nil {
		return fail()
	}
	defer clear(inspected)
	if len(inspected) == 0 || len(inspected) > 200 || inspected[len(inspected)-1] != '\n' || strings.Count(string(inspected), "\n") != 1 {
		return fail()
	}
	inspect := string(inspected[:len(inspected)-1])
	fields := strings.Split(inspect, "|")
	if len(fields) != 5 || !validDigest(fields[0]) || fields[3] != "true" || fields[4] != "healthy" || !strings.HasSuffix(fields[1], "Z") {
		return fail()
	}
	if _, err := time.Parse(time.RFC3339Nano, fields[1]); err != nil {
		return fail()
	}
	pid, err := strconv.ParseUint(fields[2], 10, 32)
	if err != nil || pid == 0 || len(fields[2]) > 8 || strconv.FormatUint(pid, 10) != fields[2] {
		return fail()
	}
	hashed, err := runner(ctx, privateHostCaddyLiveConfig)
	if err != nil {
		return fail()
	}
	defer clear(hashed)
	// sha256sum of the in-memory Caddy admin JSON, not Caddyfile or env.
	if len(hashed) != 68 || string(hashed[64:]) != "  -\n" {
		return fail()
	}
	digest := string(hashed[:64])
	if !validDigest(digest) || digest == emptySHA256 || ctx.Err() != nil {
		return fail()
	}
	return privateCaddyRuntimeSample{dockerInspection: inspect, activeConfigSHA: digest}, nil
}

// Bracket a caller-owned read-only probe. Probe callback success is NOT
// independently verified positive/negative ingress evidence. A-B-A reloads
// and untrusted sampler substitution still require external Host fences.
func privateObserveStableCaddyWindow(ctx context.Context, runner privateHostSampleRunner, probe func(context.Context) error, now time.Time) (boundPrivateCaddyRuntime, error) {
	fail := func() (boundPrivateCaddyRuntime, error) { return boundPrivateCaddyRuntime{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || runner == nil || probe == nil {
		return fail()
	}
	bounded, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	before, err := privateReadCaddyRuntimeSample(bounded, runner)
	if err != nil {
		return fail()
	}
	if err := probe(bounded); err != nil || bounded.Err() != nil {
		return fail()
	}
	after, err := privateReadCaddyRuntimeSample(bounded, runner)
	if err != nil || bounded.Err() != nil {
		return fail()
	}
	return bindPrivateCaddyRuntimeWindow(before, after, now)
}
