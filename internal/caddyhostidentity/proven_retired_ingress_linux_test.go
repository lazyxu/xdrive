//go:build linux

package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func privateProvenTestRuntime() boundPrivateCaddyRuntime {
	return boundPrivateCaddyRuntime{
		instanceSHA:            strings.Repeat("1", 64),
		generationSHA:          strings.Repeat("2", 64),
		hostLocalGenerationSHA: strings.Repeat("3", 64),
		liveConfigSHA:          strings.Repeat("4", 64),
	}
}

func TestOriginalHostRetirementActuallyBindsSourceAndRuntime(t *testing.T) {
	ctx := context.Background()
	original := privateHostAuthoritySnapshot{
		domain: "current.example.test", envSHA: strings.Repeat("a", 64),
		fileEpoch: strings.Repeat("b", 64),
	}
	id := strings.Repeat("c", 24)
	pinned := privateProvenTestRuntime()
	var order []string
	snapshot := func(context.Context) (privateHostAuthoritySnapshot, error) {
		order = append(order, "snapshot")
		return original, nil
	}
	runtime := func(context.Context) (boundPrivateCaddyRuntime, error) {
		order = append(order, "runtime")
		return pinned, nil
	}
	readOriginal := func(_ context.Context, requestID string, source privateHostAuthoritySnapshot,
		active boundPrivateCaddyRuntime,
	) (privateRetiredTargets, error) {
		order = append(order, "original")
		if requestID != id || source != original || active != pinned {
			return privateRetiredTargets{}, errors.New("Host origin or operation changed")
		}
		return privateRetiredTargets{domain: "retired.example.test"}, nil
	}
	collect := func(_ context.Context, current privateHostEnabledTargets,
		retired privateRetiredTargets,
	) (privateIngressTransportCandidates, error) {
		order = append(order, "collector")
		if current.domain != original.domain || current.lanIPv4 != "" ||
			retired.domain != "retired.example.test" || retired.lanRoots != nil {
			return privateIngressTransportCandidates{}, errors.New("untrusted old or current ingress")
		}
		return privateIngressTransportCandidates{
			runtime: pinned, domainReady: strings.Repeat("d", 64),
			retiredDomain: strings.Repeat("e", 64), routeDigest: strings.Repeat("f", 64),
		}, nil
	}
	got, err := privateObserveOriginalRetiredIngressWith(
		ctx, id, nil, nil, snapshot, runtime, readOriginal, collect,
	)
	if err != nil || got.runtime != pinned || !validDigest(got.routeDigest) {
		t.Fatalf("original Host-deploy provenance rejected: %v", err)
	}
	if joined := strings.Join(order, ","); joined !=
		"snapshot,runtime,original,snapshot,collector,snapshot,snapshot" {
		t.Fatalf("actual Collector path skipped source/recheck: %s", joined)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatal("private original Host operation, targets or TLS evidence escaped JSON")
	}
}

func TestOriginalHostRetirementFailsClosedOnDriftReplayAndUntrustedSources(t *testing.T) {
	source := privateHostAuthoritySnapshot{
		domain: "current.example.test", envSHA: strings.Repeat("a", 64),
		fileEpoch: strings.Repeat("b", 64),
	}
	id := strings.Repeat("c", 24)
	baseline := privateProvenTestRuntime()
	for _, test := range []struct {
		name            string
		operation       string
		updatedEpoch    bool
		wrongGeneration bool
		changedCurrent  bool
		badRetired      bool
		failedOriginal  bool
		failedRuntime   bool
		missingReady    bool
		missingRetired  bool
	}{
		{name: "saved Host A-B-A epoch", updatedEpoch: true},
		{name: "old generation despite same live config", wrongGeneration: true},
		{name: "current Host changed", changedCurrent: true},
		{name: "old target still current", badRetired: true},
		{name: "Host original missing", failedOriginal: true},
		{name: "Docker runtime unavailable", failedRuntime: true},
		{name: "missing current TLS positive proof", missingReady: true},
		{name: "missing old ingress candidate proof", missingRetired: true},
		{name: "wrong operation identifier", operation: "not-an-operation"},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			snapshot := func(context.Context) (privateHostAuthoritySnapshot, error) {
				calls++
				next := source
				if test.updatedEpoch && calls == 4 {
					next.fileEpoch = strings.Repeat("f", 64)
				}
				if test.changedCurrent && calls == 4 {
					next.domain = "new.example.test"
				}
				return next, nil
			}
			running := func(context.Context) (boundPrivateCaddyRuntime, error) {
				if test.failedRuntime {
					return boundPrivateCaddyRuntime{}, errors.New("missing current Docker")
				}
				return baseline, nil
			}
			original := func(context.Context, string, privateHostAuthoritySnapshot,
				boundPrivateCaddyRuntime,
			) (privateRetiredTargets, error) {
				if test.failedOriginal {
					return privateRetiredTargets{}, errors.New("no trusted original")
				}
				if test.badRetired {
					return privateRetiredTargets{domain: source.domain}, nil
				}
				return privateRetiredTargets{domain: "former.example.test"}, nil
			}
			collect := func(context.Context, privateHostEnabledTargets,
				privateRetiredTargets,
			) (privateIngressTransportCandidates, error) {
				result := privateIngressTransportCandidates{
					runtime: baseline, routeDigest: strings.Repeat("e", 64),
					domainReady:   strings.Repeat("d", 64),
					retiredDomain: strings.Repeat("f", 64),
				}
				if test.missingReady {
					result.domainReady = ""
				}
				if test.missingRetired {
					result.retiredDomain = ""
				}
				if test.wrongGeneration {
					result.runtime.hostLocalGenerationSHA = strings.Repeat("9", 64)
				}
				return result, nil
			}
			requestID := id
			if test.operation != "" {
				requestID = test.operation
			}
			got, err := privateObserveOriginalRetiredIngressWith(
				context.Background(), requestID, nil, nil, snapshot, running, original, collect,
			)
			if err == nil || got != (privateIngressTransportCandidates{}) {
				t.Fatal("untrusted source/reloaded original was accepted")
			}
		})
	}
}

func TestOriginalHostRetirementRequiresIndependentLANRoots(t *testing.T) {
	host := privateHostAuthoritySnapshot{
		lanIPv4: "192.168.2.4", envSHA: strings.Repeat("a", 64),
		fileEpoch: strings.Repeat("b", 64),
	}
	id := strings.Repeat("c", 24)
	root := x509.NewCertPool()
	runtime := privateProvenTestRuntime()
	read := func(context.Context) (privateHostAuthoritySnapshot, error) {
		return host, nil
	}
	running := func(context.Context) (boundPrivateCaddyRuntime, error) {
		return runtime, nil
	}
	original := func(context.Context, string, privateHostAuthoritySnapshot,
		boundPrivateCaddyRuntime,
	) (privateRetiredTargets, error) {
		return privateRetiredTargets{lanIPv4: "192.168.2.5"}, nil
	}
	collect := func(_ context.Context, current privateHostEnabledTargets,
		retired privateRetiredTargets,
	) (privateIngressTransportCandidates, error) {
		if current.lanRoots != root || retired.lanRoots != root {
			return privateIngressTransportCandidates{}, errors.New("lost independent trusted CA")
		}
		return privateIngressTransportCandidates{
			runtime: runtime, routeDigest: strings.Repeat("e", 64),
			lanReady: strings.Repeat("d", 64), retiredLAN: strings.Repeat("f", 64),
		}, nil
	}
	for _, pair := range [][2]*x509.CertPool{
		{nil, nil}, {root, nil}, {nil, root},
	} {
		if got, err := privateObserveOriginalRetiredIngressWith(
			context.Background(), id, pair[0], pair[1], read, running, original, collect,
		); err == nil || got != (privateIngressTransportCandidates{}) {
			t.Fatal("retired LAN without both trusted CA roots was admitted")
		}
	}
	if _, err := privateObserveOriginalRetiredIngressWith(
		context.Background(), id, root, root, read, running, original, collect,
	); err != nil {
		t.Fatalf("two independently supplied local roots rejected: %v", err)
	}
}
