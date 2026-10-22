package caddyhostidentity

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// privateCaddyRuntimeSample is a HOST-PRIVATE pair of observations from a
// fixed-name Docker inspect and the running Caddy admin /config/ digest.
// It is NOT trusted merely because these two strings were supplied. The
// future privileged collector must acquire them independently and bound the
// positive/negative ingress checks between its before/after measurements.
// Never accept one from a browser, an administrative desired revision, or a
// Server-provided Host Control status snapshot.
type privateCaddyRuntimeSample struct {
	dockerInspection string
	activeConfigSHA  string
}

// boundPrivateCaddyRuntime contains only derived identities and digests. It
// grants no adoption, deployment, signing or applied-receipt authority.
type boundPrivateCaddyRuntime struct {
	instanceSHA   string
	generationSHA string
	liveConfigSHA string
}

const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// bindPrivateCaddyRuntimeWindow rejects a mixed Docker process generation or
// an in-place live Caddy config reload. All input is host-private and bounded;
// this helper deliberately DOES NOT collect/attest the input's provenance.
// A-B-A reloads and untrusted sampler substitution need a future independent
// collector fence; in particular this is NOT a negative-ingress observation.
func bindPrivateCaddyRuntimeWindow(before, after privateCaddyRuntimeSample, now time.Time) (boundPrivateCaddyRuntime, error) {
	fail := func() (boundPrivateCaddyRuntime, error) { return boundPrivateCaddyRuntime{}, errUntrusted }
	if now.IsZero() || before != after ||
		len(before.dockerInspection) == 0 || len(before.dockerInspection) > 200 ||
		!validDigest(before.activeConfigSHA) || before.activeConfigSHA == emptySHA256 {
		return fail()
	}
	// This is exactly the five-field output of the fixed-name Host-only
	// docker inspect in server-control.sh, never a complete Docker JSON object.
	fields := strings.Split(before.dockerInspection, "|")
	if len(fields) != 5 || !validDigest(fields[0]) ||
		fields[3] != "true" || fields[4] != "healthy" {
		return fail()
	}
	if !strings.HasSuffix(fields[1], "Z") {
		return fail()
	}
	started, err := time.Parse(time.RFC3339Nano, fields[1])
	if err != nil || started.IsZero() || started.After(now.UTC().Add(maxFutureSkew)) {
		return fail()
	}
	pid, err := strconv.ParseUint(fields[2], 10, 32)
	if err != nil || pid == 0 || len(fields[2]) > 8 ||
		strconv.FormatUint(pid, 10) != fields[2] {
		return fail()
	}
	digest := func(scope string, parts ...string) string {
		source := scope + "\n" + strings.Join(parts, "\n") + "\n"
		sum := sha256.Sum256([]byte(source))
		return hex.EncodeToString(sum[:])
	}
	return boundPrivateCaddyRuntime{
		instanceSHA: digest("xdrive.caddy.host.instance.v1", fields[0]),
		generationSHA: digest("xdrive.caddy.host.start-generation.v1",
			fields[0], fields[1], fields[2]),
		liveConfigSHA: before.activeConfigSHA,
	}, nil
}
