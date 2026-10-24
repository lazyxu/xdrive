package caddyhostidentity

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestHostSnapshotMustRemainIdenticalAcrossRuntimeEvidence(t *testing.T) {
	initial := privateHostAuthoritySnapshot{domain: "current.example.test", envSHA: strings.Repeat("a", 64), fileEpoch: strings.Repeat("e", 64)}
	old := privateRetiredTargets{domain: "former.example.test"}
	for _, tc := range []struct {
		name         string
		changed      bool
		epochChanged bool
		broken       bool
	}{
		{"unchanged", false, false, false},
		{"different fingerprint", true, false, false},
		{"same SHA but changed Host file epoch", false, true, false},
		{"snapshot error", false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			collectCalls := 0
			read := func(context.Context) (privateHostAuthoritySnapshot, error) {
				calls++
				if tc.broken && calls == 2 {
					return privateHostAuthoritySnapshot{}, errors.New("host source unavailable")
				}
				if calls == 2 && (tc.changed || tc.epochChanged) {
					copy := initial
					if tc.changed {
						copy.envSHA = strings.Repeat("b", 64)
					}
					if tc.epochChanged {
						copy.fileEpoch = strings.Repeat("f", 64)
					}
					return copy, nil
				}
				return initial, nil
			}
			runner := func(_ context.Context, current privateHostEnabledTargets, retired privateRetiredTargets) (privateIngressTransportCandidates, error) {
				collectCalls++
				if current.domain != initial.domain || retired.domain != old.domain {
					t.Fatal("host target mismatch")
				}
				return privateIngressTransportCandidates{routeDigest: strings.Repeat("c", 64)}, nil
			}
			got, err := privateObserveHostBoundIngressWith(context.Background(), old, nil, read, runner)
			if tc.changed || tc.epochChanged || tc.broken {
				if err == nil || got != (privateIngressTransportCandidates{}) {
					t.Fatal("drifted Host source admitted")
				}
			} else if err != nil || got.routeDigest != strings.Repeat("c", 64) {
				t.Fatalf("good Host-sourced pair rejected: %v", err)
			}
			if calls != 2 || collectCalls != 1 {
				t.Fatalf("unexpected checks %d %d", calls, collectCalls)
			}
		})
	}
}
