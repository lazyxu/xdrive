package caddyhostidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"math"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// The Caddy admin metrics endpoint exposes a timestamp of the last *successful*
// config start, even if the JSON bytes did not change on a forced reload.
// It is a read-only additional fail-closed witness, NOT a continuous mutation
// event counter: failed/in-flight reloads and publication after this window
// still require an independently controlled continuous fence.
const privateCaddyReloadMetricScript = "set -o pipefail; wget -q -T 2 -O - http://127.0.0.1:2019/metrics | awk '/^caddy_config_last_reload_success(ful|_timestamp_seconds)[[:space:]]/ { print; next } /^caddy_admin_http_requests_total/ { print; next } /^caddy_admin_http_request_errors_total/ { print }'"

type privateCaddyReloadEpoch struct {
	successAt   float64
	mutationSHA string
}

func privateParseCaddyReloadEpoch(raw []byte, now time.Time) (privateCaddyReloadEpoch, error) {
	fail := func() (privateCaddyReloadEpoch, error) { return privateCaddyReloadEpoch{}, errUntrusted }
	if now.IsZero() || len(raw) == 0 || len(raw) > privateMutationMetricsMax || raw[len(raw)-1] != '\n' {
		return fail()
	}
	seenSuccess, seenTimestamp := false, false
	var epoch privateCaddyReloadEpoch
	var mutationLines []string
	for _, line := range strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			return fail()
		}
		switch fields[0] {
		case "caddy_config_last_reload_successful":
			if seenSuccess || fields[1] != "1" {
				return fail()
			}
			seenSuccess = true
		case "caddy_config_last_reload_success_timestamp_seconds":
			if seenTimestamp {
				return fail()
			}
			stamp, err := strconv.ParseFloat(fields[1], 64)
			if err != nil || math.IsNaN(stamp) || math.IsInf(stamp, 0) ||
				stamp <= 0 || stamp > float64(now.UTC().Add(15*time.Second).UnixNano())/1e9 {
				return fail()
			}
			epoch.successAt = stamp
			seenTimestamp = true
		default:
			// The fixed sampler forwards all Admin request and error
			// counters. Unknown/malformed samples must never become zero.
			if !strings.HasPrefix(fields[0], "caddy_admin_http_requests_total{") &&
				!strings.HasPrefix(fields[0], "caddy_admin_http_request_errors_total{") {
				return fail()
			}
			mutationLines = append(mutationLines, line)
		}
	}
	if !seenSuccess || !seenTimestamp {
		return fail()
	}
	fingerprint, err := privateCaddyAdminMutationDigest(mutationLines)
	if err != nil || !validDigest(fingerprint) {
		return fail()
	}
	epoch.mutationSHA = fingerprint
	return epoch, nil
}

type privateCaddyReloadEpochReader func(context.Context) (privateCaddyReloadEpoch, error)

type privateLimitedMutationOutput struct{ bytes []byte }

func (o *privateLimitedMutationOutput) Write(data []byte) (int, error) {
	if len(data) > privateMutationMetricsMax-len(o.bytes) {
		return 0, errUntrusted
	}
	o.bytes = append(o.bytes, data...)
	return len(data), nil
}

// No custom Docker executable, network destination, Host path or command is
// admitted. Only Caddy reload gauges and bounded Admin request/error metrics
// enter the strict verifier; unknown series fail closed.
func privateReadCurrentCaddyReloadEpoch(ctx context.Context) (privateCaddyReloadEpoch, error) {
	fail := func() (privateCaddyReloadEpoch, error) { return privateCaddyReloadEpoch{}, errUntrusted }
	if runtime.GOOS != "linux" || ctx == nil || ctx.Err() != nil {
		return fail()
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, privateDockerExecutable,
		"exec", "xdrive-caddy", "/bin/sh", "-ec", privateCaddyReloadMetricScript)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "HOME=/nonexistent"}
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	out := &privateLimitedMutationOutput{}
	cmd.Stdout = out
	defer clear(out.bytes)
	if err := cmd.Run(); err != nil || bounded.Err() != nil {
		return fail()
	}
	return privateParseCaddyReloadEpoch(out.bytes, time.Now().UTC())
}

// Bracket an existing original-Operation/Host/Docker/TLS/route observation
// with independent measurements of the *running Caddy process* reload gauge.
// A->B->A or same-JSON forced successful reload changes the gauge even when
// the final config SHA and Docker instance match the first read. This is not
// proof that NO reload was in flight or completed after publication.
func privateObserveWithCaddyReloadCheckpoint(ctx context.Context,
	read privateCaddyReloadEpochReader,
	observe func(context.Context) (privateIngressTransportCandidates, error),
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || read == nil || observe == nil {
		return fail()
	}
	before, err := read(ctx)
	if err != nil || before.successAt <= 0 || !validDigest(before.mutationSHA) || ctx.Err() != nil {
		return fail()
	}
	candidate, err := observe(ctx)
	if err != nil || ctx.Err() != nil || !validDigest(candidate.routeDigest) ||
		!validDigest(candidate.runtime.hostLocalGenerationSHA) {
		return fail()
	}
	after, err := read(ctx)
	if err != nil || after.successAt != before.successAt ||
		after.mutationSHA != before.mutationSHA || ctx.Err() != nil {
		return fail()
	}
	bound := sha256.Sum256([]byte("xdrive.caddy.reload-observation.v1\n" +
		strconv.FormatFloat(before.successAt, 'g', -1, 64) + "\n" + before.mutationSHA + "\n"))
	candidate.reloadCheckpointDigest = hex.EncodeToString(bound[:])
	return candidate, nil
}
