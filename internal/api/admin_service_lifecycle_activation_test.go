package api

import (
	"strings"
	"testing"
)

func TestPostgresPoolLifecycleActivationEvidence(t *testing.T) {
	values := postgresPoolValues{MaxOpenConnections: 16, MaxIdleConnections: 4}
	desired := postgresPoolDesired{Values: values, Revision: 5}
	matching := &postgresPoolRuntime{Values: values, Revision: 5}
	for _, tc := range []struct {
		name    string
		want    string
		config  postgresPoolDesired
		applied *postgresPoolRuntime
		maxOpen int
	}{
		{name: "unmanaged defaults are not an admin revision", config: postgresPoolDesired{Values: values}, applied: matching, maxOpen: 16, want: "unknown"},
		{name: "saved but not applied", config: desired, maxOpen: 16, want: "pending"},
		{name: "saved revision and observed open limit agree", config: desired, applied: matching, maxOpen: 16, want: "verified"},
		{name: "old applied revision", config: desired, applied: &postgresPoolRuntime{Values: values, Revision: 4}, maxOpen: 16, want: "pending"},
		{name: "different saved idle budget", config: desired, applied: &postgresPoolRuntime{Values: postgresPoolValues{MaxOpenConnections: 16, MaxIdleConnections: 2}, Revision: 5}, maxOpen: 16, want: "pending"},
		{name: "observed limit drift", config: desired, applied: matching, maxOpen: 32, want: "pending"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := postgresPoolLifecycleActivationState(tc.config, tc.applied, tc.maxOpen); got != tc.want {
				t.Fatalf("activation = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGeoNamesLifecycleActivationEvidence(t *testing.T) {
	fingerprint := strings.Repeat("a", 64)
	desired := geoNamesDesiredConfig{Revision: 3, MaxDistanceKM: 8, Fingerprint: fingerprint}
	for _, tc := range []struct {
		name        string
		config      geoNamesDesiredConfig
		loaded      bool
		radius      float64
		revision    uint64
		fingerprint string
		want        string
	}{
		{name: "unmanaged revision is never verified", config: geoNamesDesiredConfig{MaxDistanceKM: 8}, loaded: true, radius: 8, fingerprint: "", want: "unknown"},
		{name: "actual immutable resolver matches", config: desired, loaded: true, radius: 8, revision: 3, fingerprint: fingerprint, want: "verified"},
		{name: "no loaded resolver", config: desired, radius: 8, revision: 3, fingerprint: fingerprint, want: "pending"},
		{name: "older effective revision", config: desired, loaded: true, radius: 8, revision: 2, fingerprint: fingerprint, want: "pending"},
		{name: "previous matching radius is not enough", config: desired, loaded: true, radius: 5, revision: 3, fingerprint: fingerprint, want: "pending"},
		{name: "older dataset despite revision", config: desired, loaded: true, radius: 8, revision: 3, fingerprint: "", want: "pending"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := geoNamesLifecycleActivationState(tc.config, tc.loaded, tc.radius, tc.revision, tc.fingerprint); got != tc.want {
				t.Fatalf("activation = %q, want %q", got, tc.want)
			}
		})
	}
}
